const express = require("express");
const router = express.Router();
const CalendarEvent = require("../models/CalendarEvent"); // Cần tạo model
const auth = require("../middleware/auth");

// Lấy tất cả sự kiện
router.get("/", auth, async (req, res) => {
  try {
    const events = await CalendarEvent.find({
      user: req.user.id,
      $or: [
        { date: { $gte: new Date() } },
        { recurring: true }
      ]
    }).sort({ date: 1 });
    
    res.json(events);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Lấy sự kiện theo ngày
router.get("/date/:date", auth, async (req, res) => {
  try {
    const date = new Date(req.params.date);
    const events = await CalendarEvent.find({
      user: req.user.id,
      date: {
        $gte: new Date(date.setHours(0, 0, 0)),
        $lt: new Date(date.setHours(23, 59, 59))
      }
    }).sort({ time: 1 });
    
    res.json(events);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Tạo sự kiện mới
router.post("/", auth, async (req, res) => {
  try {
    const {
      title,
      type,
      date,
      time,
      description,
      duration,
      recurring,
      recurrence,
      priority,
      reminders,
      attendees,
      location
    } = req.body;

    const newEvent = new CalendarEvent({
      user: req.user.id,
      title,
      type,
      date,
      time,
      description,
      duration: duration || 60,
      recurring: recurring || false,
      recurrence: recurrence || "none",
      priority: priority || "medium",
      reminders: reminders || [],
      attendees: attendees ? attendees.split(",").map(email => email.trim()) : [],
      location
    });

    const event = await newEvent.save();
    res.json(event);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Cập nhật sự kiện
router.put("/:id", auth, async (req, res) => {
  try {
    let event = await CalendarEvent.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ msg: "Event not found" });
    }

    // Kiểm tra quyền sở hữu
    if (event.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: "Not authorized" });
    }

    event = await CalendarEvent.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );

    res.json(event);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Xóa sự kiện
router.delete("/:id", auth, async (req, res) => {
  try {
    const event = await CalendarEvent.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ msg: "Event not found" });
    }

    // Kiểm tra quyền sở hữu
    if (event.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: "Not authorized" });
    }

    await CalendarEvent.findByIdAndDelete(req.params.id);
    res.json({ msg: "Event removed" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

module.exports = router;