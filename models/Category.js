const mongoose = require("mongoose");

function removeVietnameseTones(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

const CategorySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["service", "cuisine", "product"],
      required: true,
    },
    name: { type: String, required: true, trim: true },
    nameNormalized: { type: String, index: true },

    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },

    description: { type: String, default: "" },
  },
  { timestamps: true }
);

// Auto-delete children category
CategorySchema.pre("findOneAndDelete", async function (next) {
  const category = await this.model.findOne(this.getFilter());
  if (category) {
    await this.model.deleteMany({ parent: category._id });
  }
  next();
});

CategorySchema.pre("save", function (next) {
  if (this.name) this.nameNormalized = removeVietnameseTones(this.name);
  next();
});

module.exports = mongoose.model("Category", CategorySchema);
