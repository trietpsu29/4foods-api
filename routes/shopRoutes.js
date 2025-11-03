const express = require("express");
const router = express.Router();
const Shop = require("../models/Shop");
const User = require("../models/User");
const Notification = require("../models/Notification");
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");

router.post("/register", auth, async (req, res) => {
  try {
    const {
      name,
      phone,
      address,
      representative = {},
      bank = {},
      openHours = {},
      avatar,
      cover,
      frontImage,
      serviceCategory,
      cuisineCategory,
      productCategory,
    } = req.body;

    const existingShop = await Shop.findOne({
      owner: req.user.id,
      status: { $in: ["pending", "approved"] },
    });

    if (existingShop) {
      return res.status(400).json({
        message: "User can have only 1 shop",
      });
    }

    if (!name || !phone || !address)
      return res.status(400).json({ error: "Missing required shop fields" });

    const shop = await Shop.create({
      owner: req.user.id,
      name,
      phone,
      address,
      representative,
      bank,
      openHours,
      avatar,
      cover,
      frontImage,
      serviceCategory,
      cuisineCategory,
      productCategory,
      status: "pending",
    });

    const user = await User.findById(req.user.id);
    user.isSeller = true;
    user.shop = shop._id;
    await user.save();

    const admins = await User.find({ role: "admin" });
    const notis = admins.map((a) => ({
      user: a._id,
      message: `Shop mới "${shop.name}" đang chờ duyệt.`,
      type: "system",
      metadata: { shopId: shop._id },
    }));
    if (notis.length) await Notification.insertMany(notis);

    res
      .status(201)
      .json({ message: "Shop registered and pending approval", shop });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/", auth, async (req, res) => {
  try {
    let shops;
    if (req.user.role === "admin") {
      shops = await Shop.find()
        .populate("owner", "name email")
        .populate("serviceCategory cuisineCategory productCategory");
    } else {
      shops = await Shop.find({ owner: req.user.id }).populate(
        "serviceCategory cuisineCategory productCategory"
      );
    }
    res.json(shops);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", auth, async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id).populate(
      "owner",
      "name email"
    );
    if (!shop) return res.status(404).json({ error: "Shop not found" });
    res.json(shop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", auth, async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id);
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    if (shop.owner.toString() !== req.user.id && req.user.role !== "admin")
      return res.status(403).json({ error: "Forbidden" });
    if (shop.status === "approved" && req.user.role !== "admin")
      return res
        .status(400)
        .json({ error: "Approved shop can't be edited by owner" });

    Object.assign(shop, req.body);
    await shop.save();
    res.json(shop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", admin, async (req, res) => {
  try {
    const shop = await Shop.findByIdAndDelete(req.params.id);
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    await User.findByIdAndUpdate(shop.owner, {
      $unset: { shop: "" },
      $set: { isSeller: false },
    });
    res.json({ message: "Shop deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id/approve", admin, async (req, res) => {
  try {
    const { status, reason } = req.body;
    if (!["approved", "rejected", "pending"].includes(status))
      return res.status(400).json({ error: "Invalid status" });

    const shop = await Shop.findById(req.params.id);
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    shop.status = status;
    await shop.save();

    const user = await User.findById(shop.owner);
    if (user) {
      if (status === "approved") {
        user.isSeller = true;
      } else if (status === "rejected" || status === "pending") {
        user.isSeller = false;
      }
      await user.save();
    }

    const message =
      status === "approved"
        ? `Shop "${shop.name}" đã được duyệt.`
        : status === "rejected"
        ? `Shop "${shop.name}" bị từ chối. Lý do: ${reason || "Không rõ."}`
        : `Shop "${shop.name}" đang chờ duyệt lại.`;

    await Notification.create({
      user: shop.owner,
      sender: req.user.id,
      message,
      type: "system",
      targetType: "seller",
      metadata: { shopId: shop._id, status, reason },
    });

    res.json({ message: `Shop status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
