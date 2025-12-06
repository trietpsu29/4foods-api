const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", default: null },
    
    title: { type: String, default: "Thông báo" },

    message: { type: String, required: true, trim: true },

    detail: { type: String, default: "" },

    type: {
      type: String,
      enum: ["order", "promo", "system", "wallet"],
      default: "system",
    },
    targetType: {
      type: String,
      enum: ["user", "seller", "admin"],
      default: "user",
    },
    metadata: { type: Object, default: {} },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);