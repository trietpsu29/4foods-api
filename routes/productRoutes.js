const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Shop = require("../models/Shop");
const User = require("../models/User");
const Notification = require("../models/Notification");
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");

/* ============================================================
   Seller tạo sản phẩm → tự động gửi thông báo cho admin
   ============================================================ */
router.post("/", auth, async (req, res) => {
  try {
    const user = req.user;

    if (!user.isSeller && user.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Only sellers or admins can add products" });
    }

    if (user.isSeller && !user.shop) {
      return res.status(400).json({ error: "Seller has no shop assigned" });
    }

    const {
      name,
      price,
      description,
      categoryId,
      imageUrl,
      discountPercent,
      prepTime,
      stock,
    } = req.body;

    if (!name || !price || !categoryId || !imageUrl) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const category = await Category.findById(categoryId);
    if (!category)
      return res.status(400).json({ error: "Invalid category ID" });

    const product = await Product.create({
      name,
      price,
      description,
      category: categoryId,
      imageUrl,
      discountPercent,
      prepTime,
      stock,
      sellerId: user._id,
      shopId: user.role === "admin" ? req.body.shopId : user.shop,
      status: user.role === "admin" ? "displayed" : "pending",
    });

    /* Chỉ gửi thông báo tới admin nếu là seller */
    if (user.isSeller) {
      const admins = await User.find({ role: "admin" });
      const notis = admins.map((a) => ({
        user: a._id,
        message: `Sản phẩm mới "${product.name}" đang chờ duyệt.`,
        type: "system",
        metadata: { productId: product._id },
      }));
      if (notis.length) await Notification.insertMany(notis);
    }

    res.status(201).json({
      message:
        user.role === "admin"
          ? "Product created & displayed"
          : "Product created & pending approval",
      product,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id", auth, admin, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate("category", "name")
      .populate("shopId", "name address isOpen")
      .populate("sellerId", "name email")
      .populate("comments.user", "name avatar");

    if (!product) return res.status(404).json({ error: "Product not found" });

    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   GET products + Filter + Search + Sort
   ============================================================ */
router.get("/", auth, async (req, res) => {
  try {
    const {
      shopId,
      categoryId,
      keyword,
      page = 1,
      limit = 10,
      sort,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Normalize keyword
    let normalized = null;
    if (keyword) {
      normalized = keyword
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D")
        .toLowerCase();
    }

    const pipeline = [];

    // 1. BASE FILTER
    const matchStage = {};

    if (categoryId)
      matchStage.category = new mongoose.Types.ObjectId(categoryId);
    if (shopId) matchStage.shopId = new mongoose.Types.ObjectId(shopId);

    // Non-admin restrictions
    if (req.user.role !== "admin") {
      if (!shopId || (req.user.shop && req.user.shop.toString() !== shopId)) {
        const openShops = await Shop.find({ isOpen: true }).select("_id");
        matchStage.shopId = { $in: openShops.map((s) => s._id) };
        matchStage.status = "displayed";
      }
    }

    pipeline.push({ $match: matchStage });

    // 2. JOIN CATEGORY
    pipeline.push({
      $lookup: {
        from: "categories",
        localField: "category",
        foreignField: "_id",
        as: "categoryInfo",
      },
    });
    pipeline.push({ $unwind: "$categoryInfo" });

    // 3. JOIN SHOP
    pipeline.push({
      $lookup: {
        from: "shops",
        localField: "shopId",
        foreignField: "_id",
        as: "shopInfo",
      },
    });
    pipeline.push({ $unwind: "$shopInfo" });

    // 4. SMART SEARCH MATCH ANY
    if (normalized) {
      pipeline.push({
        $match: {
          $or: [
            { nameNormalized: { $regex: normalized, $options: "i" } },
            { descriptionNormalized: { $regex: normalized, $options: "i" } },
            {
              "categoryInfo.nameNormalized": {
                $regex: normalized,
                $options: "i",
              },
            },
            {
              "shopInfo.nameNormalized": { $regex: normalized, $options: "i" },
            },
            {
              "shopInfo.addressNormalized": {
                $regex: normalized,
                $options: "i",
              },
            },
          ],
        },
      });
    }

    // 5. SORTING
    let sortOption = {};
    if (sort === "rate") sortOption = { rating: -1, createdAt: -1 };
    if (sort === "price") sortOption = { price: 1, discountPercent: -1 };
    if (sort === "recent") sortOption = { createdAt: -1 };

    if (Object.keys(sortOption).length > 0) {
      pipeline.push({ $sort: sortOption });
    }

    // 6. PAGINATION
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parseInt(limit) });

    // 7. FIELDS
    pipeline.push({
      $project: {
        name: 1,
        imageUrl: 1,
        price: 1,
        stock: 1,
        rating: 1,
        discountPercent: 1,
        description: 1,
        createdAt: 1,
        category: "$categoryInfo.name",
        shop: "$shopInfo.name",
        shopAddress: "$shopInfo.address",
      },
    });

    const products = await Product.aggregate(pipeline);

    const totalPipeline = pipeline.filter(
      (p) => !p.$skip && !p.$limit && !p.$project
    );
    totalPipeline.push({ $count: "total" });

    const totalResult = await Product.aggregate(totalPipeline);
    const total = totalResult[0]?.total || 0;

    res.json({
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
      products,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   Seller update product → chuyển về pending
   ============================================================ */
router.put("/:id", auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const isOwnShop =
      req.user.shop && product.shopId.toString() === req.user.shop.toString();

    if (req.user.role !== "admin" && !isOwnShop) {
      return res
        .status(403)
        .json({ error: "You can only update your own products" });
    }

    if (req.user.role !== "admin" && product.status === "pending") {
      return res
        .status(400)
        .json({ error: "Pending product cannot be edited" });
    }

    const fields = [
      "name",
      "price",
      "description",
      "imageUrl",
      "discountPercent",
      "prepTime",
      "stock",
      "category",
    ];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) product[f] = req.body[f];
    });

    if (req.user.role !== "admin") {
      product.status = "pending"; // seller sửa → cần admin duyệt lại
      const admins = await User.find({ role: "admin" });
      const notis = admins.map((a) => ({
        user: a._id,
        message: `Sản phẩm mới "${product.name}" đang chờ duyệt.`,
        type: "system",
        metadata: { productId: product._id },
      }));
      if (notis.length) await Notification.insertMany(notis);
    }

    await product.save();
    res.json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ============================================================
   Delete product
   ============================================================ */
router.delete("/:id", auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const isOwnShop =
      req.user.shop && product.shopId.toString() === req.user.shop.toString();

    if (req.user.role !== "admin" && !isOwnShop) {
      return res
        .status(403)
        .json({ error: "You can only delete your own product" });
    }

    await product.deleteOne();
    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   Admin duyệt sản phẩm
   ============================================================ */
router.put("/:id/approve", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Admin only" });

    const { status, reason } = req.body;

    if (!["displayed", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    product.status = status;
    await product.save();

    const seller = await User.findById(product.sellerId);

    const message =
      status === "displayed"
        ? `Sản phẩm "${product.name}" đã được duyệt.`
        : status === "rejected"
        ? `Sản phẩm "${product.name}" bị từ chối. Lý do: ${
            reason || "Không rõ."
          }`
        : `Sản phẩm "${product.name}" đang chờ duyệt lại.`;

    await Notification.create({
      user: seller._id,
      sender: req.user.id,
      message,
      type: "system",
      targetType: "seller",
      metadata: { productId: product._id, status, reason },
    });

    res.json({ message: `Product status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   Seller toggle display/hidden
   ============================================================ */
router.put("/:id/toggle", auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const isOwnShop =
      req.user.shop && product.shopId.toString() === req.user.shop.toString();

    if (!isOwnShop) return res.status(403).json({ error: "Forbidden" });
    if (!["displayed", "hidden"].includes(product.status)) {
      return res
        .status(400)
        .json({ error: "Only approved products can be toggled" });
    }

    product.status = product.status === "displayed" ? "hidden" : "displayed";
    await product.save();

    res.json({ message: `Product is now ${product.status}`, product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   Comment
   ============================================================ */
router.post("/:id/comment", auth, async (req, res) => {
  try {
    const { content, rating, images = [] } = req.body;
    if (!content)
      return res.status(400).json({ error: "Comment content required" });

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const comment = {
      user: req.user._id,
      content,
      rating: rating || 0,
      images,
      createdAt: new Date(),
    };

    product.comments.push(comment);

    const totalRatings = product.comments.reduce(
      (sum, c) => sum + (c.rating || 0),
      0
    );
    const avgRating = totalRatings / product.comments.length;
    product.rating = Number(avgRating.toFixed(1));

    await product.save();
    res.json({ message: "Comment added", comment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   Get comments
   ============================================================ */
router.get("/:id/comments", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate(
      "comments.user",
      "name avatar"
    );
    if (!product) return res.status(404).json({ error: "Product not found" });

    res.json(product.comments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
