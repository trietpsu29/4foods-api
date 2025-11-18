const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const User = require("../models/User");
const auth = require("../middleware/auth");

router.get("/me", auth, async (req, res) => {
  const { type, targetType } = req.query;
  const filter = { user: req.user._id };

  if (type) filter.type = type;
  if (targetType) filter.targetType = targetType;

  const notifications = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .populate("shop", "avatar name");

  const result = notifications.map((n) => {
    let imageUrl = null;

    if (["promo", "order"].includes(n.type) && n.shop) {
      imageUrl = n.shop.avatar;
    }

    return {
      _id: n._id,
      message: n.message,
      type: n.type,
      targetType: n.targetType,
      read: n.read,
      createdAt: n.createdAt,
      metadata: n.metadata,
      imageUrl,
    };
  });

  res.json(result);
});

router.post("/", auth, async (req, res) => {
  const {
    userId,
    message,
    type = "system",
    metadata = {},
    targetType = "user",
    shop,
  } = req.body;

  try {
    if (userId) {
      const noti = await Notification.create({
        user: userId,
        message,
        type,
        metadata,
        targetType,
        shop,
      });
      return res.json(noti);
    } else {
      const users = await mongoose.model("User").find({}, "_id");
      const notifications = users.map((u) => ({
        user: u._id,
        message,
        type,
        metadata,
        targetType,
        shop,
      }));

      await Notification.insertMany(notifications);
      return res.json({ message: "Notification sent to all users" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/", auth, async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });
  const notifications = await Notification.find().populate(
    "user",
    "name email"
  );
  res.json(notifications);
});

router.put("/:id/read", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const noti = await Notification.findOneAndUpdate(
      { _id: id, user: req.user._id },
      { read: true },
      { new: true }
    );

    if (!noti) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.json(noti);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
