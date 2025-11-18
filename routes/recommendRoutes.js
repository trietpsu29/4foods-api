const express = require("express");
const router = express.Router();

const Product = require("../models/Product");
const Shop = require("../models/Shop");
const Order = require("../models/Order");
const auth = require("../middleware/auth");

router.get("/top-products", async (req, res) => {
  try {
    const products = await Product.find({ status: "displayed" })
      .sort({
        ordersCount: -1,
        rating: -1,
        views: -1,
      })
      .limit(20);

    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/personalized", auth, async (req, res) => {
  try {
    const userId = req.user._id;

    const orders = await Order.find({ user: userId }).populate("items.product");

    if (!orders.length) {
      const fallback = await Product.find({ status: "displayed" })
        .sort({ ordersCount: -1 })
        .limit(10);
      return res.json(fallback);
    }

    const categoryCount = {};
    for (const order of orders) {
      for (const item of order.items) {
        const cat = item.product.category?.toString();
        if (!cat) continue;
        categoryCount[cat] = (categoryCount[cat] || 0) + item.quantity;
      }
    }

    const favCategories = Object.entries(categoryCount)
      .sort((a, b) => b[1] - a[1])
      .map((c) => c[0]);

    const recommended = await Product.find({
      category: { $in: favCategories },
      status: "displayed",
    })
      .sort({ rating: -1, ordersCount: -1 })
      .limit(20);

    res.json(recommended);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/shops-discount", async (req, res) => {
  try {
    const discountedProducts = await Product.aggregate([
      {
        $match: {
          discountPercent: { $gt: 0 },
          status: "displayed",
        },
      },
      {
        $group: {
          _id: "$shopId",
          discountCount: { $sum: 1 },
        },
      },
      { $sort: { discountCount: -1 } },
      { $limit: 20 },
    ]);

    const shopIds = discountedProducts.map((d) => d._id);

    const shops = await Shop.find({
      _id: { $in: shopIds },
      isOpen: true,
    }).select("name avatar cover address phone");

    const result = discountedProducts.map((d) => {
      const shop = shops.find((s) => s._id.toString() === d._id.toString());
      return {
        shop,
        discountCount: d.discountCount,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
