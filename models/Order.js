const mongoose = require("mongoose");

// Item trong order (snapshot từ cart)
const OrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: "Shop" },
});

// Thời gian dự kiến
const EstimatedTimeSchema = new mongoose.Schema({
  start: String,
  end: String,
});

// Yêu cầu hoàn tiền
const RefundRequestSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ["pending", "accepted", "rejected"],
    default: "pending",
  },
  reason: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  respondedAt: { type: Date },
});

// NOTE RIÊNG CHO TỪNG SHOP
const ShopNoteSchema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
  note: { type: String, default: "" },
});

// Order chính
const OrderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: [OrderItemSchema],

    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 15000 },
    total: { type: Number, required: true },

    voucher: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher" },
    address: { type: Object, required: true },

    paymentMethod: { type: String, enum: ["cod", "momo"], required: true },

    // note riêng cho từng shop
    shopNotes: [ShopNoteSchema],

    status: {
      type: String,
      enum: [
        "processing",
        "shipping",
        "arrived",
        "delivered",
        "cancelled",
        "refund_pending",
        "refunded",
      ],
      default: "processing",
    },

    estimatedTime: EstimatedTimeSchema,
    refundRequest: RefundRequestSchema,

    cancelRequest: {
      status: {
        type: String,
        enum: ["pending", "accepted", "rejected"],
        default: null,
      },
      reason: String,
      createdAt: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", OrderSchema);
