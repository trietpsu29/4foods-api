// routes/cart.js
const express = require("express");
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const router = express.Router();


//Helper: tính tổng tiền cart
async function calcCartTotal(cart) {
  let itemsTotal = 0;

  for (const item of cart.products) {
    const prod = await Product.findById(item.product);
    if (prod) itemsTotal += prod.price * item.quantity;
  }

  cart.total = itemsTotal + (cart.shippingFee || 0);
  return cart.total;
}

//Thêm sản phẩm vào giỏ
router.post("/", async (req, res) => {
  try {
    const { userId, productId, quantity } = req.body;
    if (!userId || !productId)
      return res.status(400).json({ error: "Missing required fields" });

    let cart = await Cart.findOne({ user: userId });

    // Nếu chưa có cart, tạo mới
    if (!cart) {
      cart = await Cart.create({
        user: userId,
        products: [{ product: productId, quantity: quantity || 1 }],
      });
    } else {
      // Tìm xem sản phẩm đã có trong giỏ chưa
      const index = cart.products.findIndex(
        (item) => item.product.toString() === productId
      );
      if (index !== -1) {
        cart.products[index].quantity += quantity || 1;
      } else {
        cart.products.push({ product: productId, quantity: quantity || 1 });
      }
    }

    await calcCartTotal(cart);
    await cart.save();

    res.status(201).json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


//Lấy giỏ hàng của user
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const cart = await Cart.findOne({ user: userId }).populate("products.product");
    if (!cart) return res.json({ products: [], total: 0 });

    await calcCartTotal(cart);
    await cart.save();

    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Cập nhật số lượng sản phẩm trong giỏ
router.put("/update", async (req, res) => {
  try {
    const { userId, productId, quantity } = req.body;
    if (!userId || !productId)
      return res.status(400).json({ error: "Missing required fields" });

    const cart = await Cart.findOne({ user: userId });
    if (!cart) return res.status(404).json({ error: "Cart not found" });

    const item = cart.products.find(
      (p) => p.product.toString() === productId
    );
    if (!item) return res.status(404).json({ error: "Product not in cart" });

    if (quantity <= 0) {
      // Nếu quantity = 0 thì xoá sản phẩm
      cart.products = cart.products.filter(
        (p) => p.product.toString() !== productId
      );
    } else {
      item.quantity = quantity;
    }

    await calcCartTotal(cart);
    await cart.save();

    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Xoá sản phẩm khỏi giỏ
router.delete("/:productId", async (req, res) => {
  try {
    const { userId } = req.query;
    const { productId } = req.params;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const cart = await Cart.findOne({ user: userId });
    if (!cart) return res.status(404).json({ error: "Cart not found" });

    cart.products = cart.products.filter(
      (p) => p.product.toString() !== productId
    );

    await calcCartTotal(cart);
    await cart.save();

    res.json({ message: "Product removed", cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Áp mã giảm giá (đơn giản)
router.post("/apply-voucher", async (req, res) => {
  try {
    const { userId, voucherCode } = req.body;
    if (!userId || !voucherCode)
      return res.status(400).json({ error: "Missing required fields" });

    const cart = await Cart.findOne({ user: userId });
    if (!cart) return res.status(404).json({ error: "Cart not found" });

    // Demo: Giả sử mã "SALE10" giảm 10%
    if (voucherCode === "SALE10") {
      await calcCartTotal(cart);
      const discount = Math.floor(cart.total * 0.1);
      cart.voucherCode = voucherCode;
      cart.total -= discount;
      await cart.save();
      return res.json({
        message: "Voucher applied (10%)",
        discount,
        total: cart.total,
      });
    }

    res.status(400).json({ error: "Invalid voucher" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Xoá toàn bộ giỏ hàng
router.delete("/clear/all", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const cart = await Cart.findOne({ user: userId });
    if (!cart) return res.status(404).json({ error: "Cart not found" });

    cart.products = [];
    cart.total = 0;
    await cart.save();

    res.json({ message: "Cart cleared", cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
