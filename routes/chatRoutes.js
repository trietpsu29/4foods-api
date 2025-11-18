const express = require("express");
const router = express.Router();
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const auth = require("../middleware/auth");
const upload = require("../middleware/uploadMemory");
const { uploadToCloudinary } = require("../utils/cloudinary");
const socketUtil = require("../utils/socket");

router.post("/conversation", auth, async (req, res) => {
  try {
    const { partnerId } = req.body;
    if (!partnerId) return res.status(400).json({ error: "Missing partnerId" });

    let partner = await User.findById(partnerId);
    if (!partner) return res.status(404).json({ error: "Partner not found" });

    let conv = await Conversation.findOne({
      participants: { $all: [req.user._id, partnerId] },
    });

    if (!conv) {
      conv = await Conversation.create({
        participants: [req.user._id, partnerId],
      });
    }

    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/conversation", auth, async (req, res) => {
  try {
    const convs = await Conversation.find({
      participants: { $in: [req.user._id] },
    })
      .sort({ updatedAt: -1 })
      .lean();

    res.json(convs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/messages/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const conv = await Conversation.findById(id);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    if (
      !conv.participants
        .map((p) => p.toString())
        .includes(req.user._id.toString())
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const msgs = await Message.find({ conversationId: id })
      .sort({ createdAt: 1 })
      .populate("sender", "name email avatar role")
      .lean();

    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/message", auth, upload.single("image"), async (req, res) => {
  try {
    const { conversationId, text = "" } = req.body;

    const conv = await Conversation.findById(conversationId);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const other = conv.participants.find(
      (p) => p.toString() !== req.user._id.toString()
    );

    let imageUrl = "";
    if (req.file) {
      const up = await uploadToCloudinary(req.file.buffer, "messages");
      imageUrl = up.secure_url;
    }

    const message = await Message.create({
      conversationId,
      sender: req.user._id,
      receiver: other,
      text,
      image: imageUrl,
    });

    conv.updatedAt = new Date();
    await conv.save();

    await message.populate("sender", "name email avatar role");

    const io = socketUtil.getIO();
    io.to(`u_${other.toString()}`).emit("message", message);
    io.to(`u_${req.user._id.toString()}`).emit("message", message);

    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
