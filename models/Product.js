const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: String,
    description: String,
    price: Number,
    imageUrl: String,
    stock: Number,
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    category: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);
