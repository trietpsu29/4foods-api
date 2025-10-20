const mongoose = require("mongoose");

const voucherSchema = new mongoose.Schema(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    code: { type: String, unique: true, required: true },
    discount: { type: Number, required: true },
    minOrder: { type: Number, default: 0 },
    expiryDate: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Voucher", voucherSchema);
