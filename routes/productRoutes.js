const express = require("express");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Shop = require("../models/Shop");
const auth = require("../middleware/auth");

const router = express.Router();

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

    const product = new Product({
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

    await product.save();
    res.status(201).json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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
    if (keyword) {
      const normalizedKeyword = keyword
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D")
        .toLowerCase();
      filter.nameNormalized = { $regex: normalizedKeyword, $options: "i" };
    }
    if (shopId) filter.shopId = shopId;

    if (req.user.role !== "admin") {
      if (!shopId || (req.user.shop && req.user.shop.toString() !== shopId)) {
        const openShops = await Shop.find({ isOpen: true }).select("_id");
        filter.shopId = { $in: openShops.map((s) => s._id) };
        filter.status = "displayed";
      }
    }

    let sortOption;

    if (sort === "rate") {
      sortOption = { rating: -1, createdAt: -1 };
    } else if (sort === "price") {
      sortOption = { price: 1, discountPercent: -1 };
    } else if (sort === "recent") {
      sortOption = { createdAt: -1 };
    }

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
      product.status = "pending";
    }

    await product.save();
    res.json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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

router.put("/:id/status", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Admin only" });
    const { status } = req.body;

    if (!["displayed", "hidden", "pending", "violated"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!product) return res.status(404).json({ error: "Product not found" });

    res.json({ message: `Status updated to ${status}`, product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

router.post("/:id/comment", auth, async (req, res) => {
  try {
    const { content, rating } = req.body;
    if (!content)
      return res.status(400).json({ error: "Comment content required" });

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const comment = {
      user: req.user._id,
      content,
      rating: rating || 0,
      images: images || [],
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
