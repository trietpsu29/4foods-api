const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const swaggerUi = require("swagger-ui-express");
const swaggerFile = require("./swagger_output.json");
const basicAuth = require("express-basic-auth");
const http = require("http");
const { Server } = require("socket.io");
const socketUtil = require("./utils/socket");
const initChatSocket = require("./sockets/chatSocket");

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

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const productRoutes = require("./routes/productRoutes");
const orderRoutes = require("./routes/orderRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const cartRoutes = require("./routes/cartRoutes");
const loyaltyRoutes = require("./routes/loyaltyRoutes");
const voucherRoutes = require("./routes/voucherRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const shopRoutes = require("./routes/shopRoutes");
const chatRoutes = require("./routes/chatRoutes");

app.use("/auth", authRoutes);
app.use("/user", userRoutes);
app.use("/products", productRoutes);
app.use("/orders", orderRoutes);
app.use("/categories", categoryRoutes);
app.use("/cart", cartRoutes);
app.use("/loyalty", loyaltyRoutes);
app.use("/vouchers", voucherRoutes);
app.use("/notifications", notificationRoutes);
app.use("/upload", uploadRoutes);
app.use("/shops", shopRoutes);
app.use("/chat", chatRoutes);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

socketUtil.init(io);
initChatSocket(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => console.log(`Server running on ${PORT}`));
