const express = require("express");
const router = express.Router();
const Voucher = require("../models/Voucher");
const auth = require("../middleware/auth");

router.post("/", auth, async (req, res) => {
  if (req.user.role !== "seller" && req.user.role !== "admin")
    return res.status(403).json({ error: "Only sellers can create vouchers" });

  const { code, discount, minOrder, expiryDate } = req.body;
  const voucher = await Voucher.create({
    shop: req.user._id,
    code,
    discount,
    minOrder,
    expiryDate,
  });
  res.json(voucher);
});

router.get("/mine", auth, async (req, res) => {
  if (req.user.role !== "seller" && req.user.role !== "admin")
    return res
      .status(403)
      .json({ error: "Only sellers can view their vouchers" });

  const vouchers = await Voucher.find({ shop: req.user._id });
  res.json(vouchers);
});

router.get("/shop/:shopId", async (req, res) => {
  const vouchers = await Voucher.find({
    shop: req.params.shopId,
    expiryDate: { $gte: new Date() },
  });
  res.json(vouchers);
});

router.post("/apply", auth, async (req, res) => {
  const { code, shopId, orderTotal } = req.body;
  const voucher = await Voucher.findOne({
    shop: shopId,
    code,
    expiryDate: { $gte: new Date() },
  });

  if (!voucher)
    return res.status(400).json({ error: "Invalid or expired voucher" });

  if (orderTotal < voucher.minOrder)
    return res
      .status(400)
      .json({ error: "Order not eligible for this voucher" });

  const discountAmount = (voucher.discount / 100) * orderTotal;
  res.json({ success: true, discountAmount });
});

router.get("/", auth, async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });
  const vouchers = await Voucher.find().populate("shop", "name email");
  res.json(vouchers);
});

router.delete("/:id", auth, async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });
  await Voucher.findByIdAndDelete(req.params.id);
  res.json({ message: "Voucher deleted" });
});

module.exports = router;
