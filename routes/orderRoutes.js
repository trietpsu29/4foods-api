const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Voucher = require("../models/Voucher");
const Shop = require("../models/Shop");

router.post("/", auth, async (req, res) => {
  try {
    const {
      items,
      addressId,
      paymentMethod,
      noteForShop,
      noteForShipper,
      voucherId,
    } = req.body;

    if (!items || !items.length)
      return res.status(400).json({ error: "Cart is empty" });

    const address = req.user.addresses[addressId];
    if (!address) return res.status(400).json({ error: "Invalid address" });

    let subtotal = 0;
    const validatedItems = [];
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product || product.stock < item.quantity)
        return res.status(400).json({
          error: `Product ${product?.name || "unknown"} out of stock`,
        });

      validatedItems.push({
        product: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
      });

      subtotal += product.price * item.quantity;
    }

    let discount = 0;
    let appliedVoucher = null;
    if (voucherId) {
      const voucher = await Voucher.findById(voucherId);
      if (
        voucher &&
        voucher.remaining > 0 &&
        new Date() >= voucher.startDate &&
        new Date() <= voucher.endDate
      ) {
        if (voucher.discountType === "percent") {
          discount = Math.min(
            (subtotal * voucher.discountValue) / 100,
            voucher.maxDiscount || subtotal
          );
        } else {
          discount = Math.min(voucher.discountValue, subtotal);
        }
        appliedVoucher = voucher._id;
      }
    }

    const deliveryFee = 15000;
    const total = subtotal + deliveryFee - discount;
    const maxPrepTime = Math.max(
      ...validatedItems.map((i) => i.product.prepTime || 10)
    );
    const now = new Date();
    const startTime = now;
    const endTime = new Date(now.getTime() + maxPrepTime * 60000);

    const order = await Order.create({
      user: req.user._id,
      items: validatedItems,
      subtotal,
      discount,
      deliveryFee,
      total,
      voucher: appliedVoucher,
      address,
      paymentMethod,
      noteForShop,
      noteForShipper,
      status: "pending",
      estimatedTime: {
        start: startTime.toTimeString().slice(0, 5),
        end: endTime.toTimeString().slice(0, 5),
      },
    });

    for (const item of validatedItems) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: -item.quantity, ordersCount: item.quantity },
      });
    }

    req.user.cart = [];
    await req.user.save();

    res.status(201).json({ message: "Order placed successfully", order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/all-tabs", auth, async (req, res) => {
  try {
    const now = new Date();
    const orders = await Order.find({ user: req.user._id })
      .populate("items.product", "name image prepTime comments")
      .populate("voucher", "code name discountType discountValue endDate")
      .sort({ createdAt: -1 });

    const ongoing = [];
    const history = [];
    const deals = [];
    const review = [];

    for (const order of orders) {
      if (["pending", "processing"].includes(order.status)) ongoing.push(order);
      else history.push(order);

      if (order.voucher) {
        deals.push({
          voucherCode: order.voucher.code,
          name: order.voucher.name,
          discountType: order.voucher.discountType,
          discountValue: order.voucher.discountValue,
          used: true,
          expired: now > order.voucher.endDate,
          orderId: order._id,
          totalDiscount: order.discount,
        });
      }

      if (order.status === "delivered") {
        for (const item of order.items) {
          const hasReviewed = item.product.comments.some(
            (c) => c.user.toString() === req.user._id.toString()
          );
          if (!hasReviewed) {
            review.push({
              orderId: order._id,
              productId: item.product._id,
              name: item.product.name,
              image: item.product.image,
              quantity: item.quantity,
            });
          }
        }
      }
    }

    res.json({ ongoing, history, deals, review });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/all", auth, async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === "seller") {
      const shops = await Shop.find({ owner: req.user._id }).select("_id");
      filter["items.product.shopId"] = { $in: shops.map((s) => s._id) };
    }
    const orders = await Order.find(filter)
      .populate("user", "name email")
      .populate("items.product", "name image prepTime")
      .populate("voucher", "code name discountType discountValue endDate")
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:orderId/status", auth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!["pending", "processing", "delivered", "cancelled"].includes(status))
      return res.status(400).json({ error: "Invalid status" });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (req.user.role === "seller") {
      const shops = await Shop.find({ owner: req.user._id }).select("_id");
      const shopIds = shops.map((s) => s._id.toString());
      const hasItemFromShop = order.items.some((i) =>
        shopIds.includes(i.product.shopId.toString())
      );
      if (!hasItemFromShop) return res.status(403).json({ error: "Forbidden" });
    }

    order.status = status;
    await order.save();

    res.json({ message: "Order status updated", order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/stats", auth, async (req, res) => {
  try {
    const match = {};
    if (req.user.role === "seller") {
      const shops = await Shop.find({ owner: req.user._id }).select("_id");
      match["items.product.shopId"] = { $in: shops.map((s) => s._id) };
    }

    const stats = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: "$total" },
        },
      },
    ]);

    res.json(stats[0] || { totalOrders: 0, totalRevenue: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
