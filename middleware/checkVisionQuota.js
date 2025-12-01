const fs = require("fs");
const path = require("path");

// Path tới file quota JSON
const quotaFile = path.join(__dirname, "../visionQuota.json");

module.exports = function (limit = 900) {
  return (req, res, next) => {
    // Đọc quota
    let quota = JSON.parse(fs.readFileSync(quotaFile, "utf8"));

    const currentMonth = new Date().toISOString().slice(0, 7);

    // Nếu tháng mới → reset
    if (quota.month !== currentMonth) {
      quota = { month: currentMonth, count: 0 };
      fs.writeFileSync(quotaFile, JSON.stringify(quota, null, 2));
    }

    // Nếu vượt hạn mức
    if (quota.count >= limit) {
      return res.status(429).json({
        error: "Vision API monthly limit reached (900/1000)",
      });
    }

    // Lưu lại để route tăng lên sau khi gọi Vision
    req.quota = quota;
    req.quotaFile = quotaFile;

    next();
  };
};
