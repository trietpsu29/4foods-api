const express = require("express");
const Card = require("../models/Card");
const router = express.Router();

// Thêm card mới
router.post("/", async (req, res) => {
  try {
    const { userId, cardType, cardNumber, expiryDate, cardHolder, isDefault } = req.body;
    if (!userId || !cardType || !cardNumber || !expiryDate || !cardHolder)
      return res.status(400).json({ error: "Missing required fields" });

    // Nếu card mới là default, reset default cũ
    if (isDefault) await Card.updateMany({ userId }, { isDefault: false });

    const card = await Card.create({ userId, cardType, cardNumber, expiryDate, cardHolder, isDefault });
    res.status(201).json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lấy danh sách card của user
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const cards = await Card.find({ userId });
    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cập nhật card
router.put("/:id", async (req, res) => {
  try {
    const card = await Card.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!card) return res.status(404).json({ error: "Card not found" });
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Xoá card
router.delete("/:id", async (req, res) => {
  try {
    const card = await Card.findByIdAndDelete(req.params.id);
    if (!card) return res.status(404).json({ error: "Card not found" });
    res.json({ message: "Card deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
 
