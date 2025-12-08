// routes/webadmin/dashboardRoutes.js
const express = require("express");
const router = express.Router();
const User = require("../../models/User");
const Shop = require("../../models/Shop");
const Product = require("../../models/Product");
const Order = require("../../models/Order");

const bypassAuth = (req, res, next) => next();

router.get("/users", bypassAuth, async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json({ users });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get("/shops", bypassAuth, async (req, res) => {
  try {
    const shops = await Shop.find().sort({ createdAt: -1 });
    res.json({ shops });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get("/products", bypassAuth, async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json({ products });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get("/orders", bypassAuth, async (req, res) => {
  try {
    const orders = await Order.find().populate("user", "name").sort({ createdAt: -1 });
    res.json({ orders });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get("/orders/stats", bypassAuth, async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [current, previous] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: "$total" } } }
      ]),
      Order.aggregate([
        { $match: { createdAt: { $lt: thirtyDaysAgo } } },
        { $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: "$total" } } }
      ])
    ]);

    const c = current[0] || { totalOrders: 0, totalRevenue: 0 };
    const p = previous[0] || { totalOrders: 0, totalRevenue: 0 };

    res.json({
      totalOrders: c.totalOrders,
      totalRevenue: c.totalRevenue,
      previousOrders: p.totalOrders,
      previousRevenue: p.totalRevenue
    });
  } catch (err) {
    console.error("Lỗi /api/orders/stats:", err);
    res.status(500).json({ 
      totalOrders: 0, 
      totalRevenue: 0, 
      previousOrders: 0, 
      previousRevenue: 0 
    });
  }
});

module.exports = router;