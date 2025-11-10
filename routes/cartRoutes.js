const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const Product = require("../models/Product");
const Cart = require("../models/Cart");

router.get("/", auth, async (req, res) => {
  try {
    let cart = await Cart.findOne({ user: req.user._id }).populate({
      path: "items.product",
      select: "name description price stock imageUrl prepTime shop",
      populate: { path: "shopId", select: "name" },
    });

    if (!cart) {
      cart = await Cart.create({ user: req.user._id, items: [] });
    }

    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/add", auth, async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: "Product not found" });
    if (quantity > product.stock)
      return res.status(400).json({ error: "Not enough stock" });

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) cart = await Cart.create({ user: req.user._id, items: [] });

    const existingItem = cart.items.find(
      (item) => item.product.toString() === productId
    );

    if (existingItem) {
      existingItem.quantity = Math.min(
        product.stock,
        existingItem.quantity + quantity
      );
    } else {
      cart.items.push({ product: productId, quantity });
    }

    await Product.findByIdAndUpdate(productId, {
      $inc: { addToCartCount: quantity },
    });

    cart.updatedAt = new Date();
    await cart.save();

    await cart.populate({
      path: "items.product",
      select: "name price stock imageUrl prepTime shop",
      populate: { path: "shopId", select: "name" },
    });

    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/update", auth, async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return res.status(404).json({ error: "Cart not found" });

    const item = cart.items.find((i) => i.product.toString() === productId);
    if (!item) return res.status(404).json({ error: "Product not in cart" });

    if (quantity <= 0) {
      return res.status(400).json({
        message: "Quantity is 0. Do you want to remove this product from cart?",
      });
    } else if (quantity > product.stock) {
      return res.status(400).json({ error: "Not enough stock" });
    } else {
      item.quantity = quantity;
    }

    cart.updatedAt = new Date();
    await cart.save();

    await cart.populate({
      path: "items.product",
      select: "name price stock imageUrl prepTime shop",
      populate: { path: "shopId", select: "name" },
    });

    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/remove/:productId", auth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return res.status(404).json({ error: "Cart not found" });

    cart.items = cart.items.filter(
      (item) => item.product.toString() !== req.params.productId
    );

    cart.updatedAt = new Date();
    await cart.save();

    await cart.populate({
      path: "items.product",
      select: "name price stock imageUrl prepTime shop",
      populate: { path: "shopId", select: "name" },
    });

    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/clear", auth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return res.status(404).json({ error: "Cart not found" });

    cart.items = [];
    cart.updatedAt = new Date();
    await cart.save();

    res.json({ message: "Cart cleared" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
