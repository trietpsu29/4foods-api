const mongoose = require('mongoose');
const removeAccents = require('remove-accents');
const Product = require('./models/Product'); 
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Kết nối DB
const mongoURI = process.env.MONGO_URI || "mongodb://mongo:27017/4foods"; 
mongoose.connect(mongoURI).then(() => console.log('✅ Connected')).catch(err => console.error(err));

const fixTags = async () => {
  const products = await Product.find({});
  console.log(`Đang xử lý ${products.length} sản phẩm...`);

  for (const p of products) {
      if (!p.name) continue;
      const nameNoAccent = removeAccents(p.name).toLowerCase();
      const words = nameNoAccent.split(" ").filter(w => w.length > 1);
      
      // TẠO TAG: Tên đầy đủ + Các từ lẻ
      p.searchTags = [nameNoAccent, ...words];
      p.nameNormalized = nameNoAccent; // Fix luôn cái này
      
      // Nếu có mô tả, chuẩn hóa mô tả luôn
      if (p.description) {
          p.descriptionNormalized = removeAccents(p.description).toLowerCase();
      }

      await p.save();
  }
  console.log('🎉 Đã cập nhật xong Search Tags!');
  process.exit();
};

fixTags();