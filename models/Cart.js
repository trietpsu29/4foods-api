const mongoose = require("mongoose");

const cardSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    cardType: { type: String, enum: ["visa", "master", "momo", "zalo"], required: true },
    cardNumber: { type: String, required: true },
    expiryDate: { type: String, required: true }, // MM/YY
    cardHolder: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Card", cardSchema);
