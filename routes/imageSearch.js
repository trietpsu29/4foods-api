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

router.post(
  "/search-by-image",
  upload.single("image"),
  checkVisionQuota(900),
  async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No image uploaded" });

      const buffer = req.file.buffer;

      // 1. CALL GOOGLE VISION
      const [labelResult] = await client.labelDetection(buffer);
      const [textResult] = await client.textDetection(buffer);

      // 2. UPDATE QUOTA
      const quota = req.quota;
      quota.count += 2;
      fs.writeFileSync(req.quotaFile, JSON.stringify(quota, null, 2));

      // 3. EXTRACT LABELS
      const labels = labelResult.labelAnnotations
        .map((l) => l.description.toLowerCase())
        .slice(0, 6);

      // 3b. TRANSLATE LABELS TO VIETNAMESE
      let translatedLabels = [];
      try {
        translatedLabels = await Promise.all(
          labels.map(async (l) => {
            const res = await translate(l, { to: "vi" });
            return res.text.toLowerCase();
          })
        );
      } catch (err) {
        console.error("Translate error:", err);
      }

      // 4. EXTRACT OCR TEXT
      const ocrText =
        textResult.fullTextAnnotation?.text ||
        textResult.textAnnotations[0]?.description ||
        "";

      const ocrKeywords = ocrText
        .split(/\s+/)
        .filter((t) => t.length > 1)
        .map((t) => t.toLowerCase());

      // 5. FINAL KEYWORD
      const finalKeyword = [
        ...new Set([...labels, ...translatedLabels, ...ocrKeywords]),
      ].join(" ");
      console.log(">> Final keyword:", finalKeyword);

      // 6. SEARCH PRODUCT API
      const searchResponse = await axios.get(
        "https://api.4foods.app/products",
        {
          params: { keyword: finalKeyword, page: 1, limit: 10 },
          headers: { Authorization: req.headers.authorization },
        }
      );

      return res.json({
        keyword: finalKeyword,
        quotaUsed: quota.count,
        result: searchResponse.data,
      });
    } catch (err) {
      console.error("Image search error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
