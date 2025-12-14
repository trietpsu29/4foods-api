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

// 1. API TÌM KIẾM TIN NHẮN (Giữ nguyên logic nhưng populate thêm shopId)
router.get("/search", auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim() === "") return res.json([]);

    const conversations = await Conversation.find({ participants: req.user._id }).select("_id shopId");
    const convIds = conversations.map((c) => c._id);

    const messages = await Message.find({
      conversationId: { $in: convIds },
      text: { $regex: q, $options: "i" },
    })
      .sort({ createdAt: -1 })
      .populate("sender", "name avatar")
      .lean();

    const result = await Promise.all(
      messages.map(async (msg) => {
        const conv = await Conversation.findById(msg.conversationId)
          .populate("participants", "name avatar isSeller shop")
          .populate("shopId", "name avatar"); // Populate Shop Info

        const partner = conv.participants.find(
          (p) => p._id.toString() !== req.user._id.toString()
        );

        // Logic hiển thị tên/avatar chuẩn
        let displayName = partner ? partner.name : "No name";
        let displayAvatar = partner ? partner.avatar : "";

        // Nếu người tìm kiếm là Khách (không phải chủ shop trong cuộc chat này)
        // Thì hiển thị thông tin Shop của đối phương
        const amIOwner = conv.shopId && req.user.shop && conv.shopId._id.toString() === req.user.shop.toString();
        
        if (!amIOwner && conv.shopId) {
             displayName = conv.shopId.name;
             displayAvatar = conv.shopId.avatar;
        }

        return {
          _id: msg._id,
          conversationId: msg.conversationId,
          text: msg.text,
          createdAt: msg.createdAt,
          sender: msg.sender,
          partner: {
            id: partner ? partner._id : "",
            name: displayName,
            avatar: displayAvatar,
          },
        };
      })
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. API TẠO HOẶC LẤY CUỘC TRÒ CHUYỆN (SỬA LOGIC QUAN TRỌNG)
router.post("/conversation", auth, async (req, res) => {
  try {
    // Client BẮT BUỘC gửi partnerId (người chat cùng) VÀ shopId (shop đang bàn tới)
    const { partnerId, shopId } = req.body;

    if (!partnerId || !shopId) 
        return res.status(400).json({ error: "Missing partnerId or shopId" });

    // Chặn tự chat với chính mình
    if (req.user._id.toString() === partnerId) {
        return res.status(400).json({ error: "Không thể tự chat với chính mình" });
    }

    // Tìm cuộc trò chuyện khớp cả 3 yếu tố: Participants + Shop Context
    let conv = await Conversation.findOne({
      participants: { $all: [req.user._id, partnerId] },
      shopId: shopId // 🔥 QUAN TRỌNG: Tách biệt các cuộc chat mua chéo
    });

    if (!conv) {
      conv = await Conversation.create({
        participants: [req.user._id, partnerId],
        shopId: shopId 
      });
    }

    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. API LẤY DANH SÁCH CHAT (SỬA LOGIC VIEW)
router.get("/conversation", auth, async (req, res) => {
  try {
    const { view } = req.query; // 'seller' hoặc 'user'

    let filter = {
      participants: { $in: [req.user._id] }
    };

    if (view === "seller") {
        // 🔥 Nếu xem với tư cách Shop: Chỉ lấy chat LIÊN QUAN ĐẾN SHOP MÌNH
        if (!req.user.shop) return res.json([]); 
        filter.shopId = req.user.shop; 
    } else {
        // 🔥 Nếu xem với tư cách Khách: Lấy chat MUA HÀNG (shopId KHÁC shop mình)
        if (req.user.shop) {
            filter.shopId = { $ne: req.user.shop };
        }
        // Nếu user không có shop thì mặc định lấy hết
    }

    const convs = await Conversation.find(filter)
      .sort({ updatedAt: -1 })
      .populate("participants", "name avatar isSeller shop")
      .populate("shopId", "name avatar") // Lấy thông tin Shop để hiển thị
      .lean();

    const result = await Promise.all(
      convs.map(async (conv) => {
        const partner = conv.participants.find(
          (p) => p._id.toString() !== req.user._id.toString()
        );

        const lastMsg = await Message.findOne({ conversationId: conv._id })
          .sort({ createdAt: -1 })
          .lean();

        // --- LOGIC HIỂN THỊ TÊN/AVATAR ---
        let displayName = "No name";
        let displayAvatar = "";

        if (view === "seller") {
            // Shop xem -> Hiện tên USER thật của khách
            displayName = partner ? partner.name : "Khách hàng";
            displayAvatar = partner ? partner.avatar : "";
        } else {
            // Khách xem -> Hiện tên SHOP (lấy từ shopId populate)
            if (conv.shopId) {
                displayName = conv.shopId.name;
                displayAvatar = conv.shopId.avatar;
            } else {
                // Fallback nếu dữ liệu cũ chưa có shopId
                displayName = partner ? partner.name : "Shop";
                displayAvatar = partner ? partner.avatar : "";
            }
        }

        return {
          _id: conv._id,
          updatedAt: conv.updatedAt,
          name: displayName,
          avatar: displayAvatar,
          lastMessage: lastMsg 
            ? lastMsg.text || (lastMsg.image ? "[Hình ảnh]" : "")
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

// 4. API LẤY CHI TIẾT TIN NHẮN (Giữ nguyên)
router.get("/messages/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const conv = await Conversation.findById(id);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    if (!conv.participants.map((p) => p.toString()).includes(req.user._id.toString())) {
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

// 5. API GỬI TIN NHẮN (Giữ nguyên, chỉ thêm log để debug)
router.post("/message", auth, upload.single("image"), async (req, res) => {
  try {
    const { conversationId, text = "" } = req.body;
    const hasText = text && text.trim() !== "";
    const hasImage = req.file != null;

    if (hasText && hasImage) return res.status(400).json({ error: "Chỉ text hoặc image" });
    if (!hasText && !hasImage) return res.status(400).json({ error: "Missing content" });

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
    await conv.save();

    await message.populate("sender", "name email avatar role");

    // Notification Logic (Giữ nguyên)
    const receiverData = await User.findById(other).lean();
    const targetType = receiverData.isSeller ? "seller" : "user";
    
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