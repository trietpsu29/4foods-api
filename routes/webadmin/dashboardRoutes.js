// routes/webadmin/dashboardRoutes.js
const express = require("express");
const router = express.Router();
const Order = require("../../models/Order");
const User = require("../../models/User");
const Shop = require("../../models/Shop");
const Product = require("../../models/Product");
const auth = require("../../middleware/auth");
const admin = require("../../middleware/admin");

// Tổng quan dashboard
router.get("/overview", auth, admin, async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [orderStats, todayOrders, todayRevenue, newUsers, newShops] = await Promise.all([
      Order.aggregate([{ $group: { _id: null, total: { $sum: "$total" }, count: { $sum: 1 } } }]),
      Order.countDocuments({ createdAt: { $gte: startOfDay } }),
      Order.aggregate([{ $match: { createdAt: { $gte: startOfDay } } }, { $group: { _id: null, revenue: { $sum: "$total" } } }]),
      User.countDocuments({ role: "user", createdAt: { $gte: startOfDay } }),
      Shop.countDocuments({ createdAt: { $gte: startOfDay } })
    ]);

    res.json({
      revenue: { current: todayRevenue[0]?.revenue || 0 },
      orders: { current: todayOrders },
      users: { current: newUsers },
      shops: { current: newShops },
      totalRevenueAllTime: orderStats[0]?.total || 0,
      totalOrdersAllTime: orderStats[0]?.count || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;