const mongoose = require("mongoose");

const CalendarEventSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
    required: true
  },
  title: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ["event", "meeting", "task", "reminder", "deadline"],
    default: "event"
  },
  date: {
    type: Date,
    required: true
  },
  time: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ""
  },
  duration: {
    type: Number,
    default: 60
  },
  recurring: {
    type: Boolean,
    default: false
  },
  recurrence: {
    type: String,
    enum: ["none", "daily", "weekly", "monthly", "yearly"],
    default: "none"
  },
  priority: {
    type: String,
    enum: ["low", "medium", "high"],
    default: "medium"
  },
  reminders: [{
    type: Number,
    default: [15] // minutes before
  }],
  attendees: [{
    type: String // email addresses
  }],
  location: {
    type: String,
    default: ""
  },
  read: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("CalendarEvent", CalendarEventSchema);