const express = require("express");
const router = express.Router();

const Order = require("../models/Order");
const User = require("../models/User");
const Product = require("../models/Product");

const auth = require("../middleware/auth");
const admin = require("../middleware/admin");

router.get("/stats", auth, admin, async (req, res) => {
  try {
    const { range } = req.query;

    let startDate = new Date();
    let prevStartDate = new Date();

    // ============================
    // RANGE SELECT
    // ============================
    if (range === "daily") {
      startDate.setHours(0, 0, 0, 0);

      prevStartDate.setDate(prevStartDate.getDate() - 1);
      prevStartDate.setHours(0, 0, 0, 0);
    } else if (range === "weekly") {
      const day = startDate.getDay();
      const diff = startDate.getDate() - day + (day === 0 ? -6 : 1);
      startDate = new Date(startDate.setDate(diff));
      startDate.setHours(0, 0, 0, 0);

      // previous week
      prevStartDate = new Date(startDate);
      prevStartDate.setDate(prevStartDate.getDate() - 7);
    } else if (range === "monthly") {
      startDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

      // previous month
      prevStartDate = new Date(startDate);
      prevStartDate.setMonth(prevStartDate.getMonth() - 1);
    }

    const deliveredMatch = { status: "delivered" };

    // ========== CURRENT RANGE FILTER ==========
    if (range) deliveredMatch.createdAt = { $gte: startDate };

    // ========== PREVIOUS RANGE FILTER ==========
    let prevMatch = { status: "delivered" };
    if (range) prevMatch.createdAt = { $gte: prevStartDate, $lt: startDate };

    // ============================
    // CURRENT REVENUE
    // ============================
    const current = await Order.aggregate([
      { $match: deliveredMatch },
      {
        $group: { _id: null, revenue: { $sum: "$total" }, orders: { $sum: 1 } },
      },
    ]);

    const prev = await Order.aggregate([
      { $match: prevMatch },
      {
        $group: { _id: null, revenue: { $sum: "$total" }, orders: { $sum: 1 } },
      },
    ]);

    const currentRv = current[0]?.revenue || 0;
    const currentOr = current[0]?.orders || 0;

    const prevRv = prev[0]?.revenue || 0;
    const prevOr = prev[0]?.orders || 0;

    // ============================
    // PERCENT CHANGE
    // ============================
    const percent = (cur, pre) => {
      if (pre === 0) return cur > 0 ? 100 : 0;
      return (((cur - pre) / pre) * 100).toFixed(2);
    };

    const revenueChange = percent(currentRv, prevRv);
    const orderChange = percent(currentOr, prevOr);

    // ============================
    // USER & PRODUCT COUNT
    // ============================
    const userCount = await User.countDocuments();
    const productCount = await Product.countDocuments();

    res.json({
      range,
      revenue: currentRv,
      previousRevenue: prevRv,
      revenueChange: Number(revenueChange),

      orderCount: currentOr,
      previousOrderCount: prevOr,
      orderChange: Number(orderChange),

      userCount,
      productCount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
