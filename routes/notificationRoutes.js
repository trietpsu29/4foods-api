const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const User = require("../models/User");
const auth = require("../middleware/auth");

router.get("/me", auth, async (req, res) => {
  const { type } = req.query;
  const filter = { user: req.user._id };
  if (type) filter.targetType = type;

  const notifications = await Notification.find(filter).sort({ createdAt: -1 });
  res.json(notifications);
});

router.put("/:id/read", auth, async (req, res) => {
  const noti = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { read: true },
    { new: true }
  );
  if (!noti) return res.status(404).json({ error: "Notification not found" });
  res.json(noti);
});

router.post("/", auth, async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  const { userId, message, type = "system", metadata = {} } = req.body;

  try {
    if (userId) {
      const noti = await Notification.create({
        user: userId,
        message,
        type,
        metadata,
      });
      return res.json(noti);
    } else {
      const users = await mongoose.model("User").find({}, "_id");
      const notifications = users.map((u) => ({
        user: u._id,
        message,
        type,
        metadata,
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

module.exports = router;
