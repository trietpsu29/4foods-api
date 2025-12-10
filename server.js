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
const cors = require("cors");

dotenv.config();
const app = express();

app.use(express.json());
// Thêm vào sau app.use(express.json());
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', 'http://157.66.101.113:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

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
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    console.log("⚠️  Running without MongoDB connection...");
  });

app.use("/auth", require("./routes/authRoutes"));
app.use("/user", require("./routes/userRoutes"));
app.use("/products", require("./routes/productRoutes"));
app.use("/orders", require("./routes/orderRoutes"));
app.use("/cart", require("./routes/cartRoutes"));
app.use("/loyalty", require("./routes/loyaltyRoutes"));
app.use("/vouchers", require("./routes/voucherRoutes"));
app.use("/notifications", require("./routes/notificationRoutes"));
app.use("/upload", require("./routes/uploadRoutes"));
app.use("/shops", require("./routes/shopRoutes"));
app.use("/chat", require("./routes/chatRoutes"));
app.use("/recommend", require("./routes/recommendRoutes.js"));
app.use("/admin", require("./routes/adminRoutes.js"));
app.use("/images", require("./routes/imageSearch"));
app.use("/calendar", require("./routes/calendarRoutes"));

// webadmin routes
const adminRouter = express.Router();
app.use("/api/webadmin", adminRouter); 

adminRouter.use("/dashboard", require("./routes/webadmin/dashboardRoutes"));
adminRouter.use("/analytics", require("./routes/webadmin/analyticsRoutes"));
adminRouter.use("/users", require("./routes/webadmin/usersRoutes"));
adminRouter.use("/products", require("./routes/webadmin/productsRoutes"));


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
