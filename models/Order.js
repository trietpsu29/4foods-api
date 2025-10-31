const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    // Người mua (khách hàng)
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Nhà hàng nơi đặt món
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },

    // Danh sách món ăn trong đơn
    items: [
      {
        foodId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        price: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],

    // Tổng tiền
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Địa chỉ giao hàng
    deliveryAddress: {
      type: String,
      required: true,
    },

    // Phương thức thanh toán
    paymentMethod: {
      type: String,
      enum: ["cash", "momo", "vnpay", "zalo"],
      default: "cash",
    },

    // Trạng thái đơn hàng
    status: {
      type: String,
      enum: [
        "pending",     // người dùng vừa đặt
        "confirmed",   // nhà hàng xác nhận
        "preparing",   // đang chuẩn bị
        "delivering",  // đang giao
        "delivered",   // đã giao
        "cancelled",   // bị huỷ
      ],
      default: "pending",
    },

    // Ghi chú đơn hàng
    note: { type: String },

  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);
