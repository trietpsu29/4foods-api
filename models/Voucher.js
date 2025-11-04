const mongoose = require("mongoose");

const voucherSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },

    name: { type: String, required: true },

    description: { type: String, default: "" },

    discountType: {
      type: String,
      enum: ["percent", "fixed"],
      required: true,
    },

    discountValue: { type: Number, required: true },

    minOrder: { type: Number, default: 0 },

    maxDiscount: { type: Number, default: 0 },

    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },

    quantity: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },

    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      default: null,
    },

    paymentMethods: [{ type: String, default: "any" }],
    shippingMethods: [{ type: String, default: "any" }],
    applicableProducts: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    ],
    applicableUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    note: { type: String, default: "" },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Voucher", voucherSchema);
