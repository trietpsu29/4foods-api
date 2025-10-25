const express = require("express");
const Product = require("../models/Product");
const Category = require("../models/Category");
const auth = require("../middleware/auth");

const router = express.Router();

router.post("/", auth, async (req, res) => {
  try {
    if (req.user.role !== "seller" && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Only sellers or admins can add products" });
    }

    const { name, price, description, categoryId, imageUrl, videoUrl } =
      req.body;

    if (!name || !price || !categoryId) {
      return res
        .status(400)
        .json({ error: "Name, price, and category are required" });
    }

    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(400).json({
        error: "Invalid category ID. Please choose from existing categories.",
      });
    }

    const newProduct = new Product({
      name,
      price,
      description,
      category: categoryId,
      imageUrl,
      videoUrl,
      sellerId: req.user._id,
    });

    await newProduct.save();
    res.status(201).json(newProduct);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const {
      keyword,
      categoryId,
      shopId,
      minPrice,
      maxPrice,
      sort,
      order = "asc",
      page = 1,
      limit = 10,
    } = req.query;

    const filter = {};

    if (keyword) filter.name = { $regex: keyword, $options: "i" };

    if (categoryId) filter.category = categoryId;

    if (shopId) filter.sellerId = shopId;

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = parseFloat(minPrice);
      if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
    }

    filter.stock = { $gt: 0 };

    const sortOption = {};
    if (sort === "price") sortOption.price = order === "desc" ? -1 : 1;
    else if (sort === "rating") sortOption.rating = order === "desc" ? -1 : 1;
    else if (sort === "time") sortOption.createdAt = order === "desc" ? -1 : 1;
    else sortOption.createdAt = -1;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const products = await Product.find(filter)
      .populate("category", "name")
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Product.countDocuments(filter);

    res.json({
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
      totalProducts: total,
      products,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate(
      "category",
      "name"
    );
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id/availability", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const available = product.stock > 0;
    res.json({ available, stock: product.stock });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    if (
      req.user.role === "seller" &&
      product.sellerId.toString() !== req.user._id.toString()
    ) {
      return res
        .status(403)
        .json({ error: "You can only update your own products" });
    }

    if (req.body.categoryId) {
      const category = await Category.findById(req.body.categoryId);
      if (!category) {
        return res.status(400).json({ error: "Invalid category ID" });
      }
      product.category = req.body.categoryId;
    }

    if (req.body.name) product.name = req.body.name;
    if (req.body.price) product.price = req.body.price;
    if (req.body.description) product.description = req.body.description;
    if (req.body.imageUrl) product.imageUrl = req.body.imageUrl;
    if (req.body.videoUrl) product.videoUrl = req.body.videoUrl;

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

    if (
      req.user.role === "seller" &&
      product.sellerId.toString() !== req.user._id.toString()
    ) {
      return res
        .status(403)
        .json({ error: "You can only delete your own products" });
    }

    await product.deleteOne();
    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
