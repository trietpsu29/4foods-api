const express = require("express");
const multer = require("multer");
const fs = require("fs");
const vision = require("@google-cloud/vision");
const axios = require("axios");
const checkVisionQuota = require("../middleware/checkVisionQuota");
const translate = require("google-translate-api-x");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const client = new vision.ImageAnnotatorClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

// DANH SÁCH TỪ KHÓA RÁC (Tiếng Anh) - Cần loại bỏ để search chính xác
const STOP_WORDS = [
    "food", "dish", "cuisine", "recipe", "ingredient", "meal", 
    "breakfast", "lunch", "dinner", "tableware", "plate", "serveware",
    "fast food", "junk food", "snack", "vegetable", "fruit", "produce"
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

      // 1. GỌI GOOGLE VISION
      // Gọi song song để tiết kiệm thời gian
      const [labelResult] = await client.labelDetection(buffer);
      const [textResult] = await client.textDetection(buffer);

      // 2. TRỪ QUOTA (Giữ nguyên logic của bạn)
      try {
          const quota = req.quota;
          quota.count += 2;
          fs.writeFileSync(req.quotaFile, JSON.stringify(quota, null, 2));
      } catch (qErr) {
          console.error("Quota error ignored:", qErr);
      }

      let finalKeyword = "";

      // --- LOGIC XỬ LÝ THÔNG MINH ---

      // ƯU TIÊN 1: OCR (Đọc chữ trên ảnh)
      // Nếu ảnh chụp menu hoặc bao bì có chữ, lấy chữ đó là chuẩn nhất
      const fullText = textResult.fullTextAnnotation?.text || "";
      if (fullText) {
          // Tách dòng, lọc bỏ các dòng rác (giá tiền, số đt, dòng quá ngắn)
          const validLines = fullText.split('\n').filter(line => {
              const trimmed = line.trim();
              // Bỏ dòng có kí hiệu tiền tệ hoặc toàn số
              if (trimmed.includes('000') || trimmed.match(/^\d+$/) || trimmed.length < 3) return false;
              return true;
          });

          // Nếu tìm thấy dòng chữ hợp lý, lấy dòng đầu tiên làm keyword
          if (validLines.length > 0) {
              finalKeyword = validLines[0]
                  .replace(/[^\w\s\u00C0-\u1EF9]/g, "") // Bỏ ký tự đặc biệt
                  .trim();
          }
      }

      // ƯU TIÊN 2: LABEL (Nếu không đọc được chữ)
      if (!finalKeyword) {
          // Lọc bỏ các label chung chung (Food, Dish...)
          const validLabels = labelResult.labelAnnotations
              .filter(l => l.score > 0.7) // Chỉ lấy độ tin cậy > 70%
              .map(l => l.description.toLowerCase())
              .filter(word => !STOP_WORDS.includes(word)); // Lọc từ rác

          if (validLabels.length > 0) {
              // Lấy từ khóa xịn nhất (cụ thể nhất)
              const bestLabel = validLabels[0];
              
              // Dịch sang tiếng Việt
              try {
                  const transRes = await translate(bestLabel, { to: "vi" });
                  finalKeyword = transRes.text;
              } catch (e) {
                  // Nếu lỗi dịch thì dùng tạm tiếng Anh
                  finalKeyword = bestLabel;
              }
          } else {
              // Trường hợp xui xẻo: Toàn từ rác -> Lấy đại cái đầu tiên
              finalKeyword = labelResult.labelAnnotations[0]?.description || "";
          }
      }

      console.log(">> Smart Keyword detected:", finalKeyword);

      // 3. GỌI API SEARCH SẢN PHẨM (Internal Call)
      // Lưu ý: App Android của bạn thực ra cần cái 'keyword' trả về để điền vào ô tìm kiếm
      // Nhưng ta vẫn gọi search để trả về kết quả ngay nếu cần
      let searchData = [];
      try {
          // Chuẩn hóa keyword trước khi gửi đi search
          // Gọi chính API products của mình
          const searchResponse = await axios.get(
            "https://api.4foods.app/products",
            {
              params: { keyword: finalKeyword, page: 1, limit: 10 },
              // Truyền lại token xác thực nếu có
              headers: { Authorization: req.headers.authorization },
            }
          );
          searchData = searchResponse.data;
      } catch (axiosErr) {
          console.error("Internal search API error:", axiosErr.message);
          // Không return lỗi, vẫn trả về keyword để App tự search lại
      }

      return res.json({
        keyword: finalKeyword, // App sẽ dùng cái này hiển thị lên ô search
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