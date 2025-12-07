const express = require("express");
const router = express.Router();
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const auth = require("../middleware/auth");
const upload = require("../middleware/uploadMemory");
const { uploadToCloudinary } = require("../utils/cloudinary");
const socketUtil = require("../utils/socket");
const Notification = require("../models/Notification");

router.get("/search", auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim() === "") {
      return res.json([]);
    }

    // Tìm tất cả conversation mà user đang tham gia
    const conversations = await Conversation.find({
      participants: req.user._id,
    }).select("_id");

    const convIds = conversations.map((c) => c._id);

    // Tìm tin nhắn chứa keyword trong text
    const messages = await Message.find({
      conversationId: { $in: convIds },
      text: { $regex: q, $options: "i" },
    })
      .sort({ createdAt: -1 })
      .populate("sender", "name avatar")
      .lean();

    // Trả thêm thông tin partner để UI hiển thị
    const result = await Promise.all(
      messages.map(async (msg) => {
        const conv = await Conversation.findById(msg.conversationId).populate(
          "participants",
          "name avatar"
        );

        const partner = conv.participants.find(
          (p) => p._id.toString() !== req.user._id.toString()
        );

        return {
          _id: msg._id,
          conversationId: msg.conversationId,
          text: msg.text,
          createdAt: msg.createdAt,
          sender: msg.sender,
          partner: {
            id: partner._id,
            name: partner.name,
            avatar: partner.avatar,
          },
        };
      })
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
      .populate("participants", "name avatar") // lấy thông tin user
      .lean();

    // map dữ liệu để thêm các field bổ sung
    const result = await Promise.all(
      convs.map(async (conv) => {
        // tìm partner (người còn lại)
        const partner = conv.participants.find(
          (p) => p._id.toString() !== req.user._id.toString()
        );

        // lấy message cuối cùng
        const lastMsg = await Message.findOne({ conversationId: conv._id })
          .sort({ createdAt: -1 })
          .lean();

        return {
          _id: conv._id,
          participants: conv.participants.map((p) => p._id.toString()),
          updatedAt: conv.updatedAt,
          // bổ sung cho frontend
          avatar: partner ? partner.avatar : "",
          name: partner ? partner.name : "No name",
          lastMessage: lastMsg
            ? lastMsg.text || (lastMsg.image ? "[image]" : "")
            : "",
          lastTime: lastMsg ? lastMsg.createdAt : conv.updatedAt,
        };
      })
    );

    res.json(result);
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
    const hasText = text && text.trim() !== "";
    const hasImage = req.file != null;

    // ❌ Không được gửi cả text và image
    if (hasText && hasImage) {
      return res
        .status(400)
        .json({ error: "Chỉ được gửi text hoặc image, không được cả hai." });
    }

    // ❌ Không được gửi rỗng cả hai
    if (!hasText && !hasImage) {
      return res
        .status(400)
        .json({ error: "Message phải có text hoặc image." });
    }

    const conv = await Conversation.findById(conversationId);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const other = conv.participants.find(
      (p) => p.toString() !== req.user._id.toString()
    );

    let imageUrl = "";
    if (hasImage) {
      const up = await uploadToCloudinary(req.file.buffer, "messages");
      imageUrl = up.secure_url;
    }

    const message = await Message.create({
      conversationId,
      sender: req.user._id,
      receiver: other,
      text: hasText ? text : "",
      image: imageUrl,
    });

    conv.updatedAt = new Date();

    const receiverData = await User.findById(other).lean();
    const targetType = receiverData.isSeller ? "seller" : "user";

    await conv.save();

    await message.populate("sender", "name email avatar role");

    await Notification.create({
      user: other,
      message: hasText
        ? `${req.user.name} đã gửi một tin nhắn mới: ${text}`
        : `${req.user.name} đã gửi một hình ảnh mới`,
      type: "system",
      targetType: targetType,
    });

    const io = socketUtil.getIO();
    io.to(`u_${other}`).emit("message", message);
    io.to(`u_${req.user._id}`).emit("message", message);

    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
