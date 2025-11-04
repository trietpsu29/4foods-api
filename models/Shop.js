const mongoose = require("mongoose");

const ShopSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },

    representative: {
      fullName: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String, required: true },
      otherPhone: { type: String },
      idNumber: { type: String, required: true },
      idIssuedDate: { type: String, required: true },
      idIssuedPlace: { type: String, required: true },
      idCardFront: { type: String, required: true },
      idCardBack: { type: String, required: true },
      businessLicenseFront: { type: String, required: true },
      businessLicenseBack: { type: String, required: true },
      taxCertificate: { type: String, required: true },
    },

    bank: {
      bankName: { type: String, required: true },
      accountNumber: { type: String, required: true },
      branch: { type: String, required: true },
      accountHolder: { type: String, required: true },
    },

    openHours: {
      sameAllWeek: { type: Boolean, default: true },
      monday: { open: String, close: String },
      tuesday: { open: String, close: String },
      wednesday: { open: String, close: String },
      thursday: { open: String, close: String },
      friday: { open: String, close: String },
      saturday: { open: String, close: String },
      sunday: { open: String, close: String },
    },

    avatar: { type: String, required: true },
    cover: { type: String, required: true },
    frontImage: { type: String, required: true },

    serviceCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    cuisineCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    productCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    isOpen: { type: Boolean, default: true },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Shop", ShopSchema);
