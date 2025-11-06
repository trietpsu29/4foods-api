const mongoose = require("mongoose");

const OrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
});

const AddressSchema = new mongoose.Schema({
  label: {
    type: String,
    enum: ["home", "work", "school", "other"],
    default: "home",
  },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  province: { type: String, required: true },
  district: { type: String, required: true },
  ward: { type: String, required: true },
  detail: { type: String, required: true },
  note: { type: String, default: "" },
});

const EstimatedTimeSchema = new mongoose.Schema({
  start: { type: String },
  end: { type: String },
});

const OrderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: [OrderItemSchema],
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 15000 },
    total: { type: Number, required: true },
    voucher: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher" },
    address: AddressSchema,
    paymentMethod: { type: String, enum: ["cod", "momo"], required: true },
    noteForShop: { type: String, default: "" },
    noteForShipper: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "processing", "delivered", "cancelled"],
      default: "pending",
    },
    estimatedTime: EstimatedTimeSchema,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", OrderSchema);
