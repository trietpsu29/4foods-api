const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    items: [
      {
        foodId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        quantity: Number,
        price: Number,
      },
    ],
    totalAmount: Number,
    status: { type: String, default: "pending" },
    paymentMethod: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);
