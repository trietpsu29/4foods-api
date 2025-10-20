const express = require("express");
const User = require("../models/User");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const OtpVerification = require("../models/OtpVerification");
const router = express.Router();

router.post("/register/request-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ error: "Email already registered" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await OtpVerification.findOneAndUpdate(
      { email },
      { otp, expiresAt: Date.now() + 3 * 60 * 1000 },
      { upsert: true, new: true }
    );

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "4Foods Registration OTP",
      text: `Your OTP code is ${otp}. It expires in 3 minutes.`,
    });

    res.json({ message: "OTP sent to your email" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/register/verify-otp", async (req, res) => {
  try {
    const { name, email, password, role, otp } = req.body;
    if (!email || !password || !otp)
      return res.status(400).json({ error: "Missing fields" });

    const otpRecord = await OtpVerification.findOne({ email, otp });
    if (!otpRecord) return res.status(400).json({ error: "Invalid OTP" });

    if (otpRecord.expiresAt < Date.now())
      return res.status(400).json({ error: "OTP expired" });

    await OtpVerification.deleteOne({ email });

    const hashed = await bcrypt.hash(password, 10);
    const newUser = await User.create({ name, email, password: hashed, role });

    res.json({
      message: "Account created successfully",
      user: { id: newUser._id, email: newUser.email },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "30m" }
    );
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: "User not found" });

  const token = crypto.randomBytes(3).toString("hex"); // 6-char code
  user.resetPasswordToken = token;
  user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15m
  await user.save();

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Password Reset Code",
    text: `Your reset code is ${token}`,
  });

  res.json({ message: "Reset code sent" });
});

router.post("/reset-password", async (req, res) => {
  const { email, code, newPassword } = req.body;
  const user = await User.findOne({
    email,
    resetPasswordToken: code,
    resetPasswordExpires: { $gt: Date.now() },
  });
  if (!user) return res.status(400).json({ error: "Invalid or expired code" });

  user.password = await bcrypt.hash(newPassword, 10);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  res.json({ message: "Password updated" });
});

module.exports = router;
