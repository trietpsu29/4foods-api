const express = require("express");
const Order = require("../models/Order");
const router = express.Router();


// Tạo đơn hàng mới
router.post("/", async (req, res) => {
  try {
    const { buyerId, restaurantId, items, deliveryAddress, paymentMethod, note } = req.body;

    if (!buyerId || !restaurantId || !items || items.length === 0)
      return res.status(400).json({ error: "Missing required fields" });

    // Tính tổng tiền
    const totalAmount = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const order = await Order.create({
      buyerId,
      restaurantId,
      items,
      totalAmount,
      deliveryAddress,
      paymentMethod,
      note,
    });

    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


//Lấy danh sách đơn hàng (lọc theo buyerId hoặc restaurantId nếu có)
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.buyerId) filter.buyerId = req.query.buyerId;
    if (req.query.restaurantId) filter.restaurantId = req.query.restaurantId;

    const orders = await Order.find(filter)
      .populate("buyerId", "name phone")
      .populate("restaurantId", "name address")
      .populate("items.foodId", "name image")
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lấy chi tiết một đơn hàng
router.get("/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("buyerId", "name phone")
      .populate("restaurantId", "name address")
      .populate("items.foodId", "name image");

    if (!order) return res.status(404).json({ error: "Order not found" });

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Cập nhật thông tin đơn hàng (ví dụ note, địa chỉ)
router.put("/:id", async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    })
      .populate("buyerId", "name phone")
      .populate("restaurantId", "name address")
      .populate("items.foodId", "name image");

    if (!order) return res.status(404).json({ error: "Order not found" });

    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Cập nhật trạng thái đơn hàng
// PATCH /orders/:id/status
// body: { status: "confirmed" }
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const validStatus = [
      "pending",
      "confirmed",
      "preparing",
      "delivering",
      "delivered",
      "cancelled",
    ];

    if (!validStatus.includes(status))
      return res.status(400).json({ error: "Invalid status" });

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    )
      .populate("buyerId", "name phone")
      .populate("restaurantId", "name address");

    if (!order) return res.status(404).json({ error: "Order not found" });

    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Xoá đơn hàng (chỉ khi còn pending)
router.delete("/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (order.status !== "pending")
      return res
        .status(400)
        .json({ error: "Cannot delete order after confirmation" });

    await order.deleteOne();
    res.json({ message: "Order deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
