const express = require("express");
const router = express.Router();
const User = require("../models/User");
const bcrypt = require("bcrypt");
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");

router.get("/me", auth, async (req, res) => {
  const u = await User.findById(req.user.id).select(
    "-password -resetPasswordToken -resetPasswordExpires"
  );
  res.json(u);
});

router.put("/me", auth, async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      idCardNumber,
      permanentAddress,
      dob,
      paymentMethods,
      avatar,
    } = req.body;

    if (email && email.toLowerCase() !== req.user.email) {
      const exists = await User.findOne({ email: email.toLowerCase() });
      if (exists)
        return res.status(400).json({ error: "Email already in use" });
      req.user.email = email.toLowerCase();
    }

    if (paymentMethods) req.user.paymentMethods = paymentMethods;
    if (typeof coin !== "undefined") req.user.coin = coin;
    if (dob) req.user.dob = new Date(dob);
    if (name) req.user.name = name;
    if (phone) req.user.phone = phone;
    if (idCardNumber) req.user.idCardNumber = idCardNumber;
    if (permanentAddress) req.user.permanentAddress = permanentAddress;
    if (avatar) req.user.avatar = avatar;

    await req.user.save();
    res.json(await User.findById(req.user.id).select("-password"));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/me/change-password", auth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword)
      return res.status(400).json({ error: "Missing fields" });

    if (!req.user.password)
      return res
        .status(400)
        .json({ error: "Social login account; use reset password flow" });

    const match = await bcrypt.compare(oldPassword, req.user.password);
    if (!match)
      return res.status(400).json({ error: "Old password incorrect" });

    const same = await bcrypt.compare(newPassword, req.user.password);
    if (same)
      return res.status(400).json({ error: "New password must be different" });

    req.user.password = await bcrypt.hash(newPassword, 10);
    await req.user.save();
    res.json({ message: "Password changed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/me/addresses", auth, async (req, res) => {
  try {
    const {
      label,
      name,
      phone,
      province,
      district,
      ward,
      detail,
      note,
      isPrimary,
    } = req.body;

    if (!name || !phone || !province || !district || !ward || !detail)
      return res.status(400).json({ error: "Missing required address fields" });

    const addr = {
      label,
      name,
      phone,
      province,
      district,
      ward,
      detail,
      note: note || "",
      isPrimary: !!isPrimary,
    };

    if (addr.isPrimary) {
      req.user.addresses.forEach((a) => (a.isPrimary = false));
    } else if (!req.user.addresses?.length) {
      addr.isPrimary = true;
    }

    req.user.addresses.unshift(addr);
    await req.user.save();
    res.status(201).json(req.user.addresses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/me/addresses/:idx", auth, async (req, res) => {
  try {
    const idx = parseInt(req.params.idx);
    if (isNaN(idx)) return res.status(400).json({ error: "Invalid index" });

    const addr = req.user.addresses[idx];
    if (!addr) return res.status(404).json({ error: "Address not found" });

    Object.assign(addr, req.body);
    if (req.body.isPrimary) {
      req.user.addresses.forEach((a) => (a.isPrimary = false));
      addr.isPrimary = true;
    }

    await req.user.save();
    res.json(req.user.addresses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/me/addresses/:idx", auth, async (req, res) => {
  try {
    const idx = parseInt(req.params.idx);
    if (isNaN(idx)) return res.status(400).json({ error: "Invalid index" });

    if (!req.user.addresses[idx])
      return res.status(404).json({ error: "Address not found" });

    req.user.addresses.splice(idx, 1);
    if (
      req.user.addresses.length > 0 &&
      !req.user.addresses.some((a) => a.isPrimary)
    ) {
      req.user.addresses[0].isPrimary = true;
    }
    await req.user.save();
    res.json(req.user.addresses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/me/delete-request", auth, async (req, res) => {
  try {
    const { reason } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Gửi thông báo tới admin
    const admins = await User.find({ role: "admin" });
    const notis = admins.map((a) => ({
      user: a._id,
      message: `Người dùng "${user.name}" yêu cầu xóa tài khoản.`,
      type: "system",
      metadata: { userId: user._id, reason },
    }));
    if (notis.length) await Notification.insertMany(notis);

    res.json({ message: "Yêu cầu xóa tài khoản đã được gửi đến admin" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/", auth, admin, async (req, res) => {
  const users = await User.find().select("-password");
  res.json(users);
});

router.get("/:id", auth, admin, async (req, res) => {
  const user = await User.findById(req.params.id).select("-password");
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

router.put("/:id", auth, admin, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    ).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ message: "User updated", user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", auth, admin, async (req, res) => {
  try {
    const { reason } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!reason) {
      return res
        .status(400)
        .json({ error: "Reason is required to delete account" });
    }

    // Gửi email trước
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Tài khoản của bạn đã bị xóa",
      text: `
Xin chào ${user.name || "bạn"},

Tài khoản của bạn đã bị admin xóa khỏi hệ thống.

Lý do: ${reason}.
      `,
    });

    // Nếu gửi mail thành công thì mới xóa
    await User.findByIdAndDelete(req.params.id);

    return res.json({ message: "User deleted and email sent" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/follow/:shopId", auth, async (req, res) => {
  try {
    const { shopId } = req.params;
    const shop = await Shop.findById(shopId);
    if (!shop || shop.status !== "approved" || !shop.isOpen)
      return res.status(404).json({ error: "Shop not found or unavailable" });

    if (req.user.followedShops?.includes(shopId))
      return res.status(400).json({ error: "Already following this shop" });

    req.user.followedShops.push(shopId);
    shop.followers.push(req.user.id);

    await req.user.save();
    await shop.save();

    res.json({ message: "Shop followed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/unfollow/:shopId", auth, async (req, res) => {
  try {
    const { shopId } = req.params;
    const shop = await Shop.findById(shopId);
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    req.user.followedShops = req.user.followedShops.filter(
      (id) => id.toString() !== shopId
    );
    shop.followers = shop.followers.filter(
      (id) => id.toString() !== req.user.id
    );

    await req.user.save();
    await shop.save();

    res.json({ message: "Unfollowed shop successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/me/followed-shops", auth, async (req, res) => {
  try {
    await req.user.populate("followedShops", "name avatar isOpen");
    res.json(req.user.followedShops);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
