const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    items: [
      {
        foodId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true, min: 0 },
      },
    ],
    totalAmount: { type: Number, required: true, min: 0 },
    deliveryFee: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    voucherIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Voucher" }],
    deliveryAddress: { type: String, required: true },
    paymentMethod: { type: String, enum: ["cash", "momo", "vnpay", "zalo", "card"], default: "cash" },
    cardId: { type: mongoose.Schema.Types.ObjectId, ref: "Card" },
    status: {
      type: String,
      enum: ["pending", "confirmed", "preparing", "delivering", "delivered", "cancelled"],
      default: "pending",
    },
    note: { type: String },
  },
  { timestamps: true }
);


module.exports = mongoose.model("Order", orderSchema);
