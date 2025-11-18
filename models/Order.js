const mongoose = require("mongoose");

// Item trong order (snapshot từ cart)
const OrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  name: { type: String, required: true }, // lưu tên sản phẩm tại thời điểm đặt
  price: { type: Number, required: true }, // lưu giá tại thời điểm đặt
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

// Order chính
const OrderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: [OrderItemSchema], // lấy từ cart rồi copy sang đây
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 15000 },
    total: { type: Number, required: true },
    voucher: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher" },
    address: { type: Object, required: true }, // hoặc dùng AddressSchema nếu muốn
    paymentMethod: { type: String, enum: ["cod", "momo"], required: true },
    noteForShop: { type: String, default: "" },
    noteForShipper: { type: String, default: "" },
    status: {
      type: String,
      enum: ["processing", "delivered", "cancelled"],
      default: "processing",
    },
    estimatedTime: EstimatedTimeSchema,
    refundRequest: RefundRequestSchema,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", OrderSchema);
