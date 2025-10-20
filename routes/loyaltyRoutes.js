const express = require("express");
const router = express.Router();
const Loyalty = require("../models/Loyalty");
const auth = require("../middleware/auth");

router.get("/me", auth, async (req, res) => {
  const records = await Loyalty.find({ user: req.user._id }).populate(
    "shop",
    "name email"
  );
  res.json(records);
});

router.get("/", auth, async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });
  const records = await Loyalty.find().populate("user shop", "name email");
  res.json(records);
});

router.put("/:id", auth, async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });
  const record = await Loyalty.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  });
  res.json(record);
});

module.exports = router;
