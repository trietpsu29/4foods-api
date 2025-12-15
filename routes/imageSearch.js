const express = require("express");
const multer = require("multer");
const fs = require("fs");
const vision = require("@google-cloud/vision");
const axios = require("axios");
const checkVisionQuota = require("../middleware/checkVisionQuota");
const translate = require("google-translate-api-x");
const { cleanKeyword } = require("../utils/searchHelper"); // Import hàm làm sạch từ khóa

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const client = new vision.ImageAnnotatorClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

// DANH SÁCH TỪ CẤM (BLACKLIST)
// Những từ này quá chung chung, nếu Google Vision trả về thì mình VỨT NGAY, không dùng để search.
const BLACKLIST_KEYWORDS = [
    // Tiếng Việt không dấu & có dấu
    "thit", "thit heo", "thit bo", "thit ga", "do an", "mon an", "thuc pham", "dia", "to", "ban", "nia", "muong", "dua",
    "thịt", "thịt heo", "thịt bò", "thịt gà", "đồ ăn", "món ăn", "thực phẩm", "đĩa", "tô", "bàn", "nĩa", "muỗng", "đũa",
    "com", "cơm", "rau", "nuoc", "nước",
    
    // Tiếng Anh
    "food", "dish", "cuisine", "recipe", "ingredient", "meal", 
    "breakfast", "lunch", "dinner", "tableware", "plate", "serveware",
    "fast food", "junk food", "snack", "vegetable", "fruit", "produce", 
    "meat", "pork", "beef", "chicken", "rice", "soup"
];

router.post(
  "/search-by-image",
  upload.single("image"),
  checkVisionQuota(900),
  async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No image uploaded" });

      const buffer = req.file.buffer;

      // 1. GỌI GOOGLE VISION (Gọi song song Label và Text để tiết kiệm thời gian)
      const [labelResult] = await client.labelDetection(buffer);
      const [textResult] = await client.textDetection(buffer);

      // 2. TRỪ QUOTA (Logic cũ giữ nguyên)
      try {
          const quota = req.quota;
          quota.count += 2;
          fs.writeFileSync(req.quotaFile, JSON.stringify(quota, null, 2));
      } catch (qErr) {
          console.error("Quota error ignored:", qErr);
      }

      let finalKeyword = "";

      // --- CHIẾN THUẬT 1: ƯU TIÊN ĐỌC CHỮ (OCR) ---
      // Nếu chụp menu, biển hiệu, bao bì có chữ -> Lấy chữ là chuẩn nhất
      const fullText = textResult.fullTextAnnotation?.text || "";
      if (fullText) {
          const lines = fullText.split('\n');
          // Lọc dòng rác:
          // 1. Phải dài hơn 3 ký tự
          // 2. Không chứa '000' (giá tiền)
          // 3. Không phải toàn số (số điện thoại)
          const validLine = lines.find(line => {
              const l = line.trim();
              return l.length > 3 && !l.includes('000') && isNaN(l);
          });

          if (validLine) {
              finalKeyword = validLine
                  .replace(/[^\w\s\u00C0-\u1EF9]/g, "") // Bỏ ký tự đặc biệt
                  .trim();
          }
      }

      // --- CHIẾN THUẬT 2: DÙNG LABEL NHƯNG LỌC KỸ (Nếu không có chữ) ---
      if (!finalKeyword) {
          // Chỉ lấy những label Google rất tự tin (score > 0.75)
          const bestLabels = labelResult.labelAnnotations
              .filter(l => l.score > 0.75)
              .map(l => l.description); // Lấy tiếng Anh gốc trước

          // Duyệt qua từng label, dịch và kiểm tra Blacklist
          for (const label of bestLabels) {
              try {
                  // Dịch sang tiếng Việt
                  const trans = await translate(label, { to: "vi" });
                  const vnText = trans.text;
                  const vnTextClean = cleanKeyword(vnText); // Chuyển về không dấu để check blacklist

                  // KIỂM TRA: Nếu từ này KHÔNG nằm trong danh sách cấm
                  if (!BLACKLIST_KEYWORDS.includes(vnTextClean) && !BLACKLIST_KEYWORDS.includes(label.toLowerCase())) {
                      finalKeyword = vnText; // Chọn từ này!
                      break; // Tìm thấy 1 cái ngon là dừng ngay, không cần tìm tiếp
                  }
              } catch (e) {
                  console.error("Translate error:", e.message);
              }
          }
      }

      // --- CHIẾN THUẬT 3: PHÒNG HỘ (FALLBACK) ---
      // Nếu lọc hết mà không ra gì (hoặc toàn từ cấm), trả về rỗng.
      // Thà không tìm thấy còn hơn trả về "Thịt" rồi ra kết quả tào lao.
      if (!finalKeyword) {
          console.log(">> Image search: No valid keyword found after filtering.");
          return res.json({ 
              keyword: "", 
              quotaUsed: req.quota?.count || 0,
              result: [] // Trả về danh sách rỗng
          });
      }

      console.log(">> Smart Keyword detected:", finalKeyword);

      // 3. GỌI API SEARCH SẢN PHẨM (Internal Call)
      // Gọi chính API /products của mình để lấy danh sách sản phẩm
      let searchData = {};
      try {
          const searchResponse = await axios.get(
            "https://api.4foods.app/products", // Đảm bảo domain này đúng với server bạn
            {
              params: { keyword: finalKeyword, page: 1, limit: 10 },
              headers: { Authorization: req.headers.authorization }, // Truyền token nếu có
            }
          );
          searchData = searchResponse.data;
      } catch (axiosErr) {
          console.error("Internal search API error:", axiosErr.message);
          // Vẫn trả về keyword để App hiển thị, dù API search lỗi
      }

      return res.json({
        keyword: finalKeyword, // App sẽ điền từ này vào ô tìm kiếm
        quotaUsed: req.quota?.count || 0,
        result: searchData,    // Kết quả tìm kiếm thực tế
      });

    } catch (err) {
      console.error("Image search error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;