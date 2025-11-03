const mongoose = require("mongoose");

const CategorySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["service", "cuisine", "product"],
      required: true,
    },
    name: { type: String, required: true, trim: true },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

CategorySchema.pre("findOneAndDelete", async function (next) {
  const category = await this.model.findOne(this.getFilter());
  if (category) {
    await this.model.deleteMany({ parent: category._id });
  }
  next();
});

module.exports = mongoose.model("Category", CategorySchema);
