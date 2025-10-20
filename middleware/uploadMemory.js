const multer = require("multer");

const storage = multer.memoryStorage();

const limits = {
  fileSize: 25 * 1024 * 1024,
};

const fileFilter = (req, file, cb) => {
  if (file.mimetype && file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed!"), false);
  }
};

const upload = multer({ storage, limits, fileFilter });

module.exports = upload;
