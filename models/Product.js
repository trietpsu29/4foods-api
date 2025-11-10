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
    description: { type: String, default: "" },
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
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
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

function removeVietnameseTones(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

productSchema.pre("save", function (next) {
  if (this.name) this.nameNormalized = removeVietnameseTones(this.name);
  next();
});

module.exports = mongoose.model("Product", productSchema);
