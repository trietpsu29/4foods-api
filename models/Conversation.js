const mongoose = require("mongoose");

const ConversationSchema = new mongoose.Schema(
  {
    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ],
    shopId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Shop", 
      required: true 
    },
    isAI: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Conversation", ConversationSchema);