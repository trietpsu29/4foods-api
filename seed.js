// seed.js
const mongoose = require("mongoose");
require("dotenv").config();

mongoose.connect(process.env.MONGO_URI);

const User = require("./models/User");
const Shop = require("./models/Shop");
const Product = require("./models/Product");
const Order = require("./models/Order");

async function seed() {
  await User.deleteMany({});
  await Shop.deleteMany({});
  await Product.deleteMany({});
  await Order.deleteMany({});

  const admin = await User.create({
    name: "Admin",
    email: "admin@4foods.com",
    password: "123456",
    role: "admin"
  });

  const shop = await Shop.create({ name: "4Foods Quận 1" });

  const product = await Product.create({
    name: "Cơm tấm sườn bì chả",
    price: 55000,
    shop: shop._id,
    image: "https://picsum.photos/300/200"
  });

  // Tạo 50 đơn hàng giả
  for(let i = 0; i < 50; i++) {
    await Order.create({
      user: admin._id,
      items: [{ product: product._id, quantity: 1, price: 55000 }],
      total: 55000,
      status: i % 3 === 0 ? "delivered" : "pending",
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000)
    });
  }

  console.log("Đã tạo dữ liệu test thành công!");
  process.exit();
}

seed();