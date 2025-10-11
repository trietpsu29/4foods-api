const express = require("express");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const router = express.Router();
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");

router.get("/me", auth, async (req, res) => {
  res.json(req.user);
});

router.put("/me", auth, async (req, res) => {
  const { name, email, phone, avatar } = req.body;
  req.user.name = name || req.user.name;
  req.user.email = email || req.user.email;
  req.user.phone = phone || req.user.phone;
  req.user.avatar = avatar || req.user.avatar;
  await req.user.save();
  res.json(req.user);
});

router.put("/change-password", auth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword)
      return res.status(400).json({ error: "Missing old or new password" });

    const match = await bcrypt.compare(oldPassword, req.user.password);
    if (!match)
      return res.status(400).json({ error: "Old password incorrect" });

    req.user.password = await bcrypt.hash(newPassword, 10);
    await req.user.save();

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/", auth, admin, async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", auth, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", auth, admin, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", auth, admin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
