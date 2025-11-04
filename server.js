const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const swaggerUi = require("swagger-ui-express");
const swaggerFile = require("./swagger_output.json");
const basicAuth = require("express-basic-auth");

dotenv.config();
const app = express();

app.use(express.json());

const swaggerAuth = basicAuth({
  users: { [process.env.SWAGGER_USER]: process.env.SWAGGER_PASS },
  challenge: true,
});

app.use("/docs", swaggerAuth, swaggerUi.serve, swaggerUi.setup(swaggerFile));

app.get("/", (req, res) => {
  res.send("4Foods API Server is running!");
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(err));

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/userRoutes");
const productRoutes = require("./routes/productRoutes");
const orderRoutes = require("./routes/orderRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const cardRoutes = require("./routes/cardRoutes");
const cartRoutes = require("./routes/cartRoutes");
const loyaltyRoutes = require("./routes/loyaltyRoutes");
const voucherRoutes = require("./routes/voucherRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/products", productRoutes);
app.use("/orders", orderRoutes);
app.use("/categories", categoryRoutes);
app.use("/cards", cardRoutes);
app.use("/carts", cartRoutes);
app.use("/loyalty", loyaltyRoutes);
app.use("/vouchers", voucherRoutes);
app.use("/notifications", notificationRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server running on ${PORT}`));
