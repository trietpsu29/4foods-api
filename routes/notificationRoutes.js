const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const auth = require("../middleware/auth");

router.get("/me", auth, async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id }).sort({
    createdAt: -1,
  });
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
  const { userId, message } = req.body;
  const noti = await Notification.create({ user: userId, message });
  res.json(noti);
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
