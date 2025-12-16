const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  content: { type: String, required: true },
  rating: { type: Number, default: 0, min: 0, max: 5 },
  images: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
});

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameNormalized: { type: String, index: true },
    
    // --- QUAN TRỌNG: Mới thêm trường này để lưu Tag ---
    searchTags: { type: [String], index: true, default: [] },
    // --------------------------------------------------

    description: { type: String, default: "" },
    descriptionNormalized: { type: String, index: true },
    
    price: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    imageUrl: { type: String, required: true },
    stock: { type: Number, default: 0 },
    rating: { type: Number, default: 0, min: 0, max: 5 },

    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    
    category: { type: String, required: true },
    categoryNormalized: { type: String, index: true },

    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
    },

    prepTime: { type: Number, default: 10 },
    status: {
      type: String,
      enum: ["pending", "displayed", "hidden", "violated"],
      default: "pending",
    },

    comments: [commentSchema],

    views: { type: Number, default: 0 },
    addToCartCount: { type: Number, default: 0 },
    ordersCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Hàm bỏ dấu tiếng Việt
function removeVietnameseTones(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

productSchema.pre("save", function (next) {
  // 1. Chuẩn hóa Tên
  if (this.name) {
      this.nameNormalized = removeVietnameseTones(this.name);
  }

  // 2. Chuẩn hóa Mô tả
  if (this.description) {
      this.descriptionNormalized = removeVietnameseTones(this.description);
  }

  // 3. Chuẩn hóa Category
  if (this.category) {
      this.categoryNormalized = removeVietnameseTones(this.category);
  }

  // 4. TỰ ĐỘNG TẠO SEARCH TAGS (Thay thế logic bên Controller)
  const nameStr = this.nameNormalized || "";
  const descStr = this.descriptionNormalized || "";

  // Tách từ trong tên
  const nameWords = nameStr.split(" ").filter(w => w.length > 0);

  // Tách từ trong mô tả (Dùng regex tách kỹ hơn: dấu phẩy, chấm, xuống dòng)
  const descWords = descStr.split(/[\s,.\-\n]+/).filter(w => w.length > 1);

  // Gộp lại và xóa trùng
  const uniqueTags = new Set([nameStr, ...nameWords, ...descWords]);
  
  // Gán vào field searchTags
  this.searchTags = Array.from(uniqueTags);

  next();
});

// Tạo index text search (Optional - giúp tìm nhanh hơn)
productSchema.index({ name: 'text', nameNormalized: 'text', searchTags: 'text' });

module.exports = mongoose.model("Product", productSchema);