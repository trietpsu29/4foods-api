const express = require("express");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Shop = require("../models/Shop");
const User = require("../models/User");
const Notification = require("../models/Notification");
const auth = require("../middleware/auth");

const router = express.Router();

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

    const filter = {};

    if (categoryId) filter.category = categoryId;
    if (shopId) filter.shopId = shopId;

    if (keyword) {
      const normalizedKeyword = keyword
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D")
        .toLowerCase();
      filter.nameNormalized = { $regex: normalizedKeyword, $options: "i" };
    }

    if (req.user.role !== "admin") {
      if (!shopId || (req.user.shop && req.user.shop.toString() !== shopId)) {
        const openShops = await Shop.find({ isOpen: true }).select("_id");
        filter.shopId = { $in: openShops.map((s) => s._id) };
        filter.status = "displayed";
      }
    }

    let sortOption = {};
    if (sort === "rate") sortOption = { rating: -1, createdAt: -1 };
    if (sort === "price") sortOption = { price: 1, discountPercent: -1 };
    if (sort === "recent") sortOption = { createdAt: -1 };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const products = await Product.find(filter)
      .populate("category", "name")
      .populate("shopId", "name")
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Product.countDocuments(filter);

    res.json({
      total,
      page: parseInt(page),
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
