const mongoose = require("mongoose");

const AddressSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      enum: ["home", "work", "school", "other"],
      default: "home",
    },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    province: { type: String, required: true },
    district: { type: String, required: true },
    ward: { type: String, required: true },
    detail: { type: String, required: true },
    note: { type: String, default: "" },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: true }
);

const PaymentMethodSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["momo", "zalopay"], required: true },
    detail: { type: String, default: "" },
  },
  { _id: true }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, default: "" },
    password: { type: String },
    avatar: { type: String, default: "" },

    role: { type: String, enum: ["user", "admin"], default: "user" },

    isSeller: { type: Boolean, default: false },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", default: null },

    idCardNumber: { type: String, default: "" },
    idCardFront: { type: String, default: "" },
    idCardBack: { type: String, default: "" },
    permanentAddress: { type: String, default: "" },
    dob: { type: Date, default: null },

    paymentMethods: [PaymentMethodSchema],
    coin: { type: Number, default: 0 },

    addresses: [AddressSchema],

    resetPasswordToken: String,
    resetPasswordExpires: Date,

    loginMethod: {
      type: String,
      enum: ["local", "google", "facebook"],
      default: "local",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
