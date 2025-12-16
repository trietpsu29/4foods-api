const express = require("express");
const multer = require("multer");
const fs = require("fs");
const vision = require("@google-cloud/vision");
const axios = require("axios");
const checkVisionQuota = require("../middleware/checkVisionQuota");
const translate = require("google-translate-api-x");
const { cleanKeyword } = require("../utils/searchHelper");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const client = new vision.ImageAnnotatorClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

// DANH SÁCH TỪ CẤM (BLACKLIST) - Cập nhật thêm các nguyên liệu rác
const BLACKLIST_KEYWORDS = [
    // Tiếng Việt
    "thit", "thit heo", "thit bo", "thit ga", "do an", "mon an", "thuc pham", "dia", "to", "ban", "nia", "muong", "dua",
    "thịt", "thịt heo", "thịt bò", "thịt gà", "đồ ăn", "món ăn", "thực phẩm", "đĩa", "tô", "bàn", "nĩa", "muỗng", "đũa",
    "com", "cơm", "rau", "nuoc", "nước", "da", "đá", "ly", "coc", "cốc", "chai", "lo",
    "xa lach", "xà lách", "rau song", "rau sống", "bun", "bún", // Bún đứng một mình cũng ko nên, phải là bún đậu/bún bò
    
    // Tiếng Anh
    "food", "dish", "cuisine", "recipe", "ingredient", "meal", 
    "breakfast", "lunch", "dinner", "tableware", "plate", "serveware",
    "fast food", "junk food", "snack", "vegetable", "fruit", "produce", 
    "meat", "pork", "beef", "chicken", "rice", "soup", "drink", "beverage",
    "ice", "liquid", "glass", "bottle", "lettuce", "herb"
];

router.post(
  "/search-by-image",
  upload.single("image"),
  checkVisionQuota(900),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image uploaded" });

      const buffer = req.file.buffer;

      // 1. GỌI GOOGLE VISION - DÙNG WEB DETECTION (Thông minh hơn Label)
      // webDetection: Tìm xem ảnh này giống cái gì trên mạng nhất (Best Guess)
      // textDetection: Vẫn giữ để đọc menu
      const [result] = await client.annotateImage({
        image: { content: buffer },
        features: [
            { type: 'WEB_DETECTION', maxResults: 5 }, 
            { type: 'TEXT_DETECTION' }
        ]
      });

      const webDetection = result.webDetection;
      const textAnnotations = result.textAnnotations;

      // 2. TRỪ QUOTA
      try {
          const quota = req.quota;
          quota.count += 2;
          fs.writeFileSync(req.quotaFile, JSON.stringify(quota, null, 2));
      } catch (qErr) {
          console.error("Quota error ignored:", qErr);
      }

      let finalKeyword = "";

      // --- CHIẾN THUẬT 1: ƯU TIÊN WEB DETECTION (BEST GUESS) ---
      // Đây là cái giúp phân biệt "Bún đậu" vs "Xà lách"
      if (webDetection && webDetection.bestGuessLabels && webDetection.bestGuessLabels.length > 0) {
          const bestGuess = webDetection.bestGuessLabels[0].label; // Ví dụ: "bun dau mam tom"
          console.log(">> Google Best Guess:", bestGuess);
          
          if (bestGuess) {
              // Google thường trả về tiếng Anh hoặc tiếng Việt không dấu, dịch lại cho chắc
              try {
                  const trans = await translate(bestGuess, { to: "vi" });
                  finalKeyword = trans.text;
              } catch (e) {
                  finalKeyword = bestGuess;
              }
          }
      }

      // --- CHIẾN THUẬT 2: NẾU BEST GUESS KHÔNG RA, DÙNG WEB ENTITIES ---
      // Nếu không đoán được tên món, nó sẽ trả về các từ khóa liên quan nhất
      if (!finalKeyword && webDetection && webDetection.webEntities) {
          const entities = webDetection.webEntities;
          // Lọc các entity có điểm số cao
          for (const entity of entities) {
               if (entity.score < 0.7) continue; // Bỏ qua nếu không chắc chắn

               const desc = entity.description.toLowerCase();
               if (!BLACKLIST_KEYWORDS.includes(cleanKeyword(desc))) {
                   // Dịch sang tiếng Việt
                   try {
                       const trans = await translate(entity.description, { to: "vi" });
                       finalKeyword = trans.text;
                       break; // Lấy được 1 cái ngon là dừng
                   } catch (e) {}
               }
          }
      }

      // --- CHIẾN THUẬT 3: OCR (ĐỌC CHỮ) - DỰ PHÒNG ---
      // Chỉ dùng khi chụp Menu hoặc Web Detection thất bại
      if (!finalKeyword && textAnnotations && textAnnotations.length > 0) {
          const fullText = textAnnotations[0].description;
          const lines = fullText.split('\n');
          // Lọc dòng rác như code cũ
          const validLine = lines.find(line => {
              const l = line.trim();
              return l.length > 3 && !l.includes('000') && isNaN(l);
          });
          if (validLine) {
               finalKeyword = validLine.replace(/[^\w\s\u00C0-\u1EF9]/g, "").trim();
          }
      }

      // --- LỌC CUỐI CÙNG: CHECK BLACKLIST ---
      if (finalKeyword) {
          const cleanKey = cleanKeyword(finalKeyword);
          if (BLACKLIST_KEYWORDS.includes(cleanKey)) {
              console.log(`>> Keyword '${finalKeyword}' bị chặn bởi Blacklist.`);
              finalKeyword = ""; // Reset nếu dính từ cấm
          }
      }

      if (!finalKeyword) {
          return res.json({ keyword: "", result: [] });
      }

      console.log(">> FINAL SMART KEYWORD:", finalKeyword);

      // 3. GỌI API SEARCH
      let searchData = {};
      try {
          const searchResponse = await axios.get(
            "https://api.4foods.app/products",
            {
              params: { keyword: finalKeyword, page: 1, limit: 10 },
              headers: { Authorization: req.headers.authorization },
            }
          );
          searchData = searchResponse.data;
      } catch (axiosErr) {
          console.error("Internal search API error:", axiosErr.message);
      }

      return res.json({
        keyword: finalKeyword,
        quotaUsed: req.quota?.count || 0,
        result: searchData,
      });

    } catch (err) {
      console.error("Image search error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;