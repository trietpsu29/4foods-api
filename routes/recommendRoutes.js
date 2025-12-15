const express = require("express");
const router = express.Router();

const Product = require("../models/Product");
const Shop = require("../models/Shop");
const Order = require("../models/Order");
const auth = require("../middleware/auth");

async function getOpenShopIds() {
  const openShops = await Shop.find({
    status: "approved",
    isOpen: true,
  }).select("_id");
  return openShops.map((shop) => shop._id);
}

router.get("/top-products", async (req, res) => {
  try {
    const openShopIds = await getOpenShopIds();

    const products = await Product.find({
      status: "displayed",
      shopId: { $in: openShopIds }, 
    })
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

    const openShopIds = await getOpenShopIds();

    const orders = await Order.find({ user: userId }).populate("items.product");

    if (!orders.length) {
      const fallback = await Product.find({
        status: "displayed",
        shopId: { $in: openShopIds }, 
      })
        .sort({ ordersCount: -1 })
        .limit(10);
      return res.json(fallback);
    }

    const categoryCount = {};
    for (const order of orders) {
      for (const item of order.items) {
        if (item.product && item.product.category) {
          const cat = item.product.category.toString();
          categoryCount[cat] = (categoryCount[cat] || 0) + item.quantity;
        }
      }
    }

    const favCategories = Object.entries(categoryCount)
      .sort((a, b) => b[1] - a[1])
      .map((c) => c[0]);

    const recommended = await Product.find({
      category: { $in: favCategories },
      status: "displayed",
      shopId: { $in: openShopIds }, 
    })
      .populate("shopId", "name")
      .sort({ rating: -1, ordersCount: -1 })
      .limit(20);

    res.json(recommended);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/shops-discount", async (req, res) => {
  try {
    const openShopIds = await getOpenShopIds();

    const discountedProducts = await Product.aggregate([
      {
        $match: {
          discountPercent: { $gt: 0 },
          status: "displayed",
          shopId: { $in: openShopIds }, 
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
    }).select("name avatar cover address phone");

    const result = discountedProducts
      .map((d) => {
        const shop = shops.find((s) => s._id.toString() === d._id.toString());
        if (!shop) return null; 
        return {
          shop,
          discountCount: d.discountCount,
        };
      })
      .filter((item) => item !== null);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;