const express = require("express");
const router = express.Router();
const Voucher = require("../models/Voucher");
const User = require("../models/User");
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");
const seller = require("../middleware/seller");

router.post("/system", auth, admin, async (req, res) => {
  try {
    const {
      code,
      name,
      description,
      type,
      scope,
      discountType,
      discountValue,
      minOrder,
      maxDiscount,
      startDate,
      endDate,
      quantity,
      paymentMethods,
      shippingMethods,
      applicableProducts,
      applicableUsers,
      note,
    } = req.body;

    const voucher = await Voucher.create({
      code,
      name,
      description,
      type: type || "order",
      scope: scope || "public", // Mặc định là public
      applicableUsers: applicableUsers || [], // Mảng user được chỉ định
      discountType,
      discountValue,
      minOrder,
      maxDiscount,
      startDate,
      endDate,
      quantity,
      remaining: quantity,
      shop: null,
      paymentMethods,
      shippingMethods,
      applicableProducts,
      applicableUsers,
      note,
    });

    res.json({ success: true, voucher });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/:id", auth, admin, async (req, res) => {
  try {
    const updatedVoucher = await Voucher.findByIdAndUpdate(
      req.params.id,
      { ...req.body },
      { new: true }
    );

    if (!updatedVoucher)
      return res
        .status(404)
        .json({ success: false, message: "Voucher not found" });

    res.json({
      success: true,
      message: "Voucher updated successfully",
      voucher: updatedVoucher,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete("/:id", auth, admin, async (req, res) => {
  try {
    await Voucher.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Voucher deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/shop", auth, seller, async (req, res) => {
  try {
    const {
      code,
      name,
      description,
      type,
      scope,
      discountType,
      discountValue,
      minOrder,
      maxDiscount,
      startDate,
      endDate,
      quantity,
      paymentMethods,
      shippingMethods,
      applicableProducts,
      note,
    } = req.body;

    const voucher = await Voucher.create({
      code,
      name,
      description,
      type: type || "order",
      scope: scope || "public", // Mặc định là public
      applicableUsers: applicableUsers || [], // Mảng user được chỉ định
      discountType,
      discountValue,
      minOrder,
      maxDiscount,
      startDate,
      endDate,
      quantity,
      remaining: quantity,
      shop: req.user.shop,
      paymentMethods,
      shippingMethods,
      applicableProducts,
      note,
    });

    res.json({ success: true, voucher });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/shop/:shopId", auth, async (req, res) => {
  try {
    const vouchers = await Voucher.find({
      shop: req.params.shopId,
      isActive: true,
      endDate: { $gte: new Date() },
    });

    res.json({ success: true, vouchers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/mine", auth, seller, async (req, res) => {
  try {
    const vouchers = await Voucher.find({ shop: req.user.shop });
    res.json({ success: true, vouchers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/collect/:voucherId", auth, async (req, res) => {
  try {
    const voucher = await Voucher.findById(req.params.voucherId);
    if (!voucher || !voucher.isActive)
      return res
        .status(404)
        .json({ success: false, message: "Voucher not found or inactive" });

    if (voucher.remaining <= 0)
      return res
        .status(400)
        .json({ success: false, message: "Voucher is out of stock" });

    const user = await User.findById(req.user._id);
    const alreadyCollected = user.vouchers.some(
      (v) => v.voucher.toString() === voucher._id.toString()
    );
    if (alreadyCollected)
      return res.status(400).json({
        success: false,
        message: "You already collected this voucher",
      });

    user.vouchers.push({ voucher: voucher._id });
    voucher.remaining = Math.max(0, voucher.remaining - 1);

    await voucher.save();
    await user.save();

    res.json({ success: true, message: "Voucher added to your wallet" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/wallet", auth, async (req, res) => {
  try {
    const now = new Date();
    const currentUserId = req.user._id.toString();

    const currentUser = await User.findById(req.user._id).select("vouchers");
    const usedVoucherIds = new Set(
        currentUser.vouchers
            .filter(v => v.used === true)
            .map(v => v.voucher.toString())
    );

    const allVouchers = await Voucher.find({
      isActive: true,
      endDate: { $gte: now },
      remaining: { $gt: 0 },
    }).populate("shop");

    const validVouchers = allVouchers.filter((v) => {
      // Nếu user đã dùng rồi -> Ẩn ngay lập tức
      if (usedVoucherIds.has(v._id.toString())) return false;

      if (v.scope === "public") return true;
      if (v.scope === "private") {
         if (v.applicableUsers && v.applicableUsers.length > 0) {
            const allowedUsers = v.applicableUsers.map(id => id.toString());
            return allowedUsers.includes(currentUserId);
         }
         return false;
      }
      return false;
    });

    const systemVouchers = validVouchers.filter((v) => !v.shop);
    const shopVouchers = validVouchers.filter((v) => v.shop);

    res.json({ success: true, systemVouchers, shopVouchers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
