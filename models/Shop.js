const mongoose = require("mongoose");

// Hàm normalize tiếng Việt
function removeVietnameseTones(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

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
      otherPhone: String,
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

    // NORMALIZED FIELDS
    nameNormalized: { type: String, index: true },
    addressNormalized: { type: String, index: true },

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

ShopSchema.pre("save", function (next) {
  if (this.name) this.nameNormalized = removeVietnameseTones(this.name);
  if (this.address)
    this.addressNormalized = removeVietnameseTones(this.address);
  next();
});

module.exports = mongoose.model("Shop", ShopSchema);
