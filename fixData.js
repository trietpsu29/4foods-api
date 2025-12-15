const mongoose = require('mongoose');
const removeAccents = require('remove-accents');
const Product = require('./models/Product'); 
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Kết nối DB
const mongoURI = process.env.MONGO_URI || "mongodb://mongo:27017/4foods"; 

mongoose.connect(mongoURI)
  .then(() => console.log('✅ Connected to DB for Fixing Data (V2)...'))
  .catch(err => {
      console.error('❌ DB Connection Error:', err);
      process.exit(1);
  });

const fixTags = async () => {
  try {
    const products = await Product.find({});
    console.log(`🔍 Tìm thấy ${products.length} sản phẩm. Đang cập nhật lại toàn bộ Tag & Mô tả...`);

    let count = 0;
    for (const p of products) {
        if (!p.name) continue;

        // 1. XỬ LÝ TÊN
        const nameNoAccent = removeAccents(p.name).toLowerCase();
        const nameWords = nameNoAccent.split(" ").filter(w => w.length > 0);
        
        // 2. XỬ LÝ MÔ TẢ (Logic mới: Lấy hết từ vựng trong mô tả)
        let descWords = [];
        let descNoAccent = "";
        
        if (p.description) {
            descNoAccent = removeAccents(p.description).toLowerCase();
            // Tách từ thông minh: Tách theo dấu cách, phẩy, chấm, xuống dòng
            descWords = descNoAccent.split(/[\s,.\-\n]+/).filter(w => w.length > 1);
        }

        // 3. GỘP TAG VÀ XÓA TRÙNG (Dùng Set)
        // Tag = Tên không dấu + Từ trong tên + Từ trong mô tả
        const uniqueTags = new Set([nameNoAccent, ...nameWords, ...descWords]);
        
        // Cập nhật lại vào DB
        p.searchTags = Array.from(uniqueTags);
        p.nameNormalized = nameNoAccent;
        p.descriptionNormalized = descNoAccent;

        await p.save();
        
        count++;
        // Log tiến độ cho đỡ sốt ruột
        if (count % 10 === 0) process.stdout.write(`.`); 
    }

    console.log(`\n🎉 XONG! Đã fix lại toàn bộ ${count} sản phẩm.`);
    console.log(`👉 Kiểm tra lại DB, trường 'searchTags' giờ sẽ rất dài và đầy đủ.`);
    process.exit();
  } catch (error) {
    console.error("\n❌ Lỗi:", error);
    process.exit(1);
  }
};

fixTags();