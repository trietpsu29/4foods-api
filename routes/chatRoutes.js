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
    // Client phải gửi partnerId (chủ shop) VÀ shopId (ID của shop đang xem)
    const { partnerId, shopId } = req.body; 

    if (!partnerId || !shopId) 
        return res.status(400).json({ error: "Missing partnerId or shopId" });

    // Tìm cuộc trò chuyện khớp cả 3 yếu tố: Tôi, Bạn, và Shop này
    let conv = await Conversation.findOne({
      participants: { $all: [req.user._id, partnerId] },
      shopId: shopId // 🔥 QUAN TRỌNG: Phân biệt các cuộc chat chéo
    });

    if (!conv) {
      conv = await Conversation.create({
        participants: [req.user._id, partnerId],
        shopId: shopId // Lưu shop context vào
      });
    }

    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/conversation", auth, async (req, res) => {
  try {
    const { view } = req.query; // 'seller' hoặc 'user'

    // Lọc cuộc trò chuyện theo vai trò
    let filter = {
      participants: { $in: [req.user._id] }
    };

    if (view === "seller") {
        // 🔥 NẾU LÀ SELLER: Chỉ lấy các cuộc chat có shopId LÀ SHOP CỦA MÌNH
        // (Giả sử req.user.shop lưu ID shop của user hiện tại)
        if (!req.user.shop) return res.json([]); 
        filter.shopId = req.user.shop; 
    } else {
        // 🔥 NẾU LÀ USER (BUYER): Lấy cuộc chat mà shopId KHÔNG PHẢI LÀ SHOP CỦA MÌNH
        // (Tức là mình đang đi nhắn tin cho shop khác)
        if (req.user.shop) {
            filter.shopId = { $ne: req.user.shop };
        }
        // Nếu user không có shop thì mặc định lấy hết (vì tất cả đều là đi mua)
    }

    const convs = await Conversation.find(filter)
      .sort({ updatedAt: -1 })
      .populate("participants", "name avatar isSeller shop")
      .populate("shopId", "name avatar") // Populate thêm thông tin Shop
      .lean();

    const result = await Promise.all(
      convs.map(async (conv) => {
        // Tìm đối phương
        const partner = conv.participants.find(
          (p) => p._id.toString() !== req.user._id.toString()
        );

        const lastMsg = await Message.findOne({ conversationId: conv._id })
          .sort({ createdAt: -1 })
          .lean();

        // LOGIC HIỂN THỊ TÊN/AVATAR
        let displayName = "No name";
        let displayAvatar = "";

        if (view === "seller") {
            // Mình là Shop -> Đang xem khách hàng -> Hiện tên User thật của họ
            displayName = partner ? partner.name : "Khách hàng";
            displayAvatar = partner ? partner.avatar : "";
        } else {
            // Mình là Khách -> Đang xem Shop -> Hiện tên Shop và Avatar Shop (Lấy từ shopId)
            if (conv.shopId) {
                displayName = conv.shopId.name;
                displayAvatar = conv.shopId.avatar;
            }
        }

        return {
          _id: conv._id,
          participants: conv.participants.map((p) => p._id.toString()),
          updatedAt: conv.updatedAt,
          name: displayName,
          avatar: displayAvatar,
          lastMessage: lastMsg ? (lastMsg.text || "[Hình ảnh]") : "",
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
