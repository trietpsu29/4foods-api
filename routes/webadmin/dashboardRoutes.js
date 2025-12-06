const express = require("express");
const router = express.Router();

// Middleware MOCK (bỏ qua auth cho development)
const mockAuth = (req, res, next) => {
  // Tạo user object giả với quyền admin
  req.user = {
    _id: 'mock-admin-id',
    role: 'admin',
    email: 'admin@4foods.com'
  };
  next();
};

// Tất cả routes dùng mockAuth thay vì auth
router.get("/overview", mockAuth, async (req, res) => {
  try {
    // Dữ liệu giả cho dashboard
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();
    
    const data = {
      revenue: {
        current: 54320 + Math.floor(Math.random() * 1000),
        percentage: 12.5
      },
      orders: {
        current: 1852 + Math.floor(Math.random() * 50),
        percentage: -2.1
      },
      users: {
        current: 426 + Math.floor(Math.random() * 20),
        percentage: 8.2
      },
      shops: {
        current: 284 + Math.floor(Math.random() * 10),
        percentage: 5.4
      },
      shippers: {
        current: 156 + Math.floor(Math.random() * 5),
        percentage: 3.7
      }
    };
    
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/recent-activity", mockAuth, async (req, res) => {
  const activities = [
    {
      type: "order",
      description: "New order #ORD-0123 from John Doe",
      createdAt: new Date(Date.now() - 2 * 60000).toISOString()
    },
    {
      type: "user",
      description: "New user Mike Johnson registered",
      createdAt: new Date(Date.now() - 5 * 60000).toISOString()
    },
    {
      type: "shop",
      description: "New shop 'Pho 24' approved",
      createdAt: new Date(Date.now() - 15 * 60000).toISOString()
    },
    {
      type: "payment",
      description: "Payment of $245.50 received",
      createdAt: new Date(Date.now() - 45 * 60000).toISOString()
    },
    {
      type: "delivery",
      description: "Order #ORD-0122 delivered successfully",
      createdAt: new Date(Date.now() - 120 * 60000).toISOString()
    }
  ];
  res.json(activities);
});

router.get("/recent-orders", mockAuth, async (req, res) => {
  const orders = [
    {
      orderId: "#ORD-0101",
      customerId: { name: "John Smith" },
      amount: 120.00,
      status: "completed",
      createdAt: new Date(2023, 10, 12).toISOString()
    },
    {
      orderId: "#ORD-0102",
      customerId: { name: "Jane Doe" },
      amount: 85.50,
      status: "processing",
      createdAt: new Date(2023, 10, 11).toISOString()
    },
    {
      orderId: "#ORD-0103",
      customerId: { name: "Robert Johnson" },
      amount: 210.75,
      status: "pending",
      createdAt: new Date(2023, 10, 10).toISOString()
    },
    {
      orderId: "#ORD-0104",
      customerId: { name: "Sarah Williams" },
      amount: 65.25,
      status: "completed",
      createdAt: new Date(2023, 10, 10).toISOString()
    },
    {
      orderId: "#ORD-0105",
      customerId: { name: "Michael Brown" },
      amount: 150.00,
      status: "cancelled",
      createdAt: new Date(2023, 10, 9).toISOString()
    },
    {
      orderId: "#ORD-0106",
      customerId: { name: "Emily Davis" },
      amount: 95.80,
      status: "processing",
      createdAt: new Date(2023, 10, 9).toISOString()
    },
    {
      orderId: "#ORD-0107",
      customerId: { name: "David Wilson" },
      amount: 175.40,
      status: "completed",
      createdAt: new Date(2023, 10, 8).toISOString()
    }
  ];
  res.json(orders);
});

router.post("/refresh", mockAuth, async (req, res) => {
  res.json({ 
    message: "Dashboard data refreshed successfully",
    timestamp: new Date().toISOString()
  });
});

module.exports = router;