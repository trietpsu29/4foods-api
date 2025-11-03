const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMemory");
const { uploadToCloudinary } = require("../utils/cloudinary");
const auth = require("../middleware/auth");

router.post("/:type", auth, upload.single("image"), async (req, res) => {
  try {
    const { type } = req.params;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const result = await uploadToCloudinary(req.file.buffer, type);

    res.json({
      message: "Upload successful",
      url: result.secure_url,
      public_id: result.public_id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
