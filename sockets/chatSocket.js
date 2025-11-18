const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Shop = require("../models/Shop");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { uploadToCloudinary } = require("../utils/cloudinary");

const JWT_SECRET = process.env.JWT_SECRET || "secret";

function base64ToBuffer(dataURI) {
  if (!dataURI) return null;
  const matches = dataURI.match(/^data:(.+);base64,(.+)$/);
  if (!matches) return null;
  return Buffer.from(matches[2], "base64");
}

module.exports = (io) => {
  io.on("connection", async (socket) => {
    const token = socket.handshake.query?.token;

    if (!token) return socket.disconnect(true);

    let userId;
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      userId = payload.user || payload.id || payload._id || payload;
    } catch (err) {
      return socket.disconnect(true);
    }

    const user = await User.findById(userId).select(
      "-password -resetPasswordToken -resetPasswordExpires"
    );
    if (!user) return socket.disconnect(true);

    socket.user = user;

    socket.join(`u_${user._id.toString()}`);

    socket.on("sendMessage", async (payload, ack) => {
      try {
        let {
          conversationId,
          text = "",
          imageBase64,
          partnerId,
        } = payload || {};
        let conv;

        if (conversationId) {
          conv = await Conversation.findById(conversationId);
        }

        if (!conv && partnerId) {
          conv = await Conversation.findOne({
            participants: { $all: [user._id, partnerId] },
          });

          if (!conv) {
            conv = await Conversation.create({
              participants: [user._id, partnerId],
            });
          }
        }

        if (!conv) return ack?.({ error: "Conversation not found" });

        const other = conv.participants.find(
          (p) => p.toString() !== user._id.toString()
        );

        let imageUrl = "";
        if (imageBase64) {
          const buf = base64ToBuffer(imageBase64);
          const up = await uploadToCloudinary(buf, "messages");
          imageUrl = up.secure_url;
        }

        const message = await Message.create({
          conversationId: conv._id,
          sender: user._id,
          receiver: other,
          text,
          image: imageUrl,
        });

        await conv.updateOne({ updatedAt: new Date() });
        await message.populate("sender", "name email avatar role");

        io.to(`u_${other.toString()}`).emit("message", message);
        io.to(`u_${user._id.toString()}`).emit("message", message);

        ack?.({ ok: true, message, conversationId: conv._id });
      } catch (err) {
        ack?.({ error: err.message });
      }
    });

    socket.on("disconnect", () => {});
  });
};
