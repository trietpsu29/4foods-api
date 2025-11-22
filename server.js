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

app.use("/auth", require("./routes/authRoutes"));
app.use("/user", require("./routes/userRoutes"));
app.use("/products", require("./routes/productRoutes"));
app.use("/orders", require("./routes/orderRoutes"));
app.use("/categories", require("./routes/categoryRoutes"));
app.use("/cart", require("./routes/cartRoutes"));
app.use("/loyalty", require("./routes/loyaltyRoutes"));
app.use("/vouchers", require("./routes/voucherRoutes"));
app.use("/notifications", require("./routes/notificationRoutes"));
app.use("/upload", require("./routes/uploadRoutes"));
app.use("/shops", require("./routes/shopRoutes"));
app.use("/chat", require("./routes/chatRoutes"));
app.use("/recommend", require("./routes/recommendRoutes.js"));
app.use("/admin", require("./routes/adminRoutes.js"));
app.use("/products", require("./routes/productRoutes.js"));

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
