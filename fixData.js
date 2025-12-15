const mongoose = require('mongoose');
const removeAccents = require('remove-accents');
const Product = require('./models/Product'); // Sửa đường dẫn nếu file model nằm chỗ khác
require('dotenv').config();

// Kết nối DB (Copy chuỗi connection string trong .env vào đây hoặc để code tự đọc .env)
mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/4foods")
  .then(() => console.log('✅ Connected to DB'))
  .catch(err => console.error('❌ DB Error:', err));

const fixTags = async () => {
  try {
    const products = await Product.find({});
    console.log(`🔍 Tìm thấy ${products.length} sản phẩm. Đang cập nhật tag...`);

    for (const p of products) {
        if (!p.name) continue;

        // 1. Chuẩn hóa tên: "Bún Đậu Mắm Tôm" -> "bun dau mam tom"
        const nameNoAccent = removeAccents(p.name).toLowerCase();
        
        // 2. Tách từ: -> ["bun", "dau", "mam", "tom"]
        const words = nameNoAccent.split(" ").filter(w => w.length > 1);

        // 3. Gộp lại thành mảng tags
        // Tag bao gồm: Tên đầy đủ không dấu + Các từ lẻ
        const newTags = [nameNoAccent, ...words];

        // 4. Update vào DB
        p.searchTags = newTags;
        
        // Bonus: Tự động update luôn nameNormalized nếu chưa chuẩn
        p.nameNormalized = nameNoAccent; 

        await p.save();
        console.log(`   Processed: ${p.name} -> Tags: [${newTags.join(", ")}]`);
    }

    console.log('🎉 XONG! Đã cập nhật tag cho toàn bộ sản phẩm.');
    process.exit();
  } catch (error) {
    console.error("Lỗi:", error);
    process.exit(1);
  }
};

// Chạy hàm
fixTags();