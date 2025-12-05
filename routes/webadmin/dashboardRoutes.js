const express = require("express");
const router = express.Router();
const Order = require("../../models/Order");
const User = require("../../models/User");
const Shop = require("../../models/Shop");
const Product = require("../../models/Product");
const auth = require("../../middleware/auth");
const admin = require("../../middleware/admin");

/* -------------------------- DASHBOARD OVERVIEW -------------------------- */
router.get("/overview", auth, admin, async (req, res) => {
  try {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();
    
    // Tháng trước
    const lastMonthDate = new Date();
    lastMonthDate.setMonth(currentMonth - 1);
    const lastMonth = lastMonthDate.getMonth();
    const lastMonthYear = lastMonthDate.getFullYear();

    // Tính toán doanh thu
    const currentMonthRevenue = await calculateRevenue(currentMonth, currentYear);
    const lastMonthRevenue = await calculateRevenue(lastMonth, lastMonthYear);
    const revenuePercentage = lastMonthRevenue === 0 ? 100 : 
      ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;

    // Tính toán đơn hàng
    const currentMonthOrders = await Order.countDocuments({
      createdAt: {
        $gte: new Date(currentYear, currentMonth, 1),
        $lt: new Date(currentYear, currentMonth + 1, 1)
      }
    });
    
    const lastMonthOrders = await Order.countDocuments({
      createdAt: {
        $gte: new Date(lastMonthYear, lastMonth, 1),
        $lt: new Date(lastMonthYear, lastMonth + 1, 1)
      }
    });
    const ordersPercentage = lastMonthOrders === 0 ? 100 : 
      ((currentMonthOrders - lastMonthOrders) / lastMonthOrders) * 100;

    // Tính toán người dùng mới
    const currentMonthUsers = await User.countDocuments({
      createdAt: {
        $gte: new Date(currentYear, currentMonth, 1),
        $lt: new Date(currentYear, currentMonth + 1, 1)
      }
    });
    
    const lastMonthUsers = await User.countDocuments({
      createdAt: {
        $gte: new Date(lastMonthYear, lastMonth, 1),
        $lt: new Date(lastMonthYear, lastMonth + 1, 1)
      }
    });
    const usersPercentage = lastMonthUsers === 0 ? 100 : 
      ((currentMonthUsers - lastMonthUsers) / lastMonthUsers) * 100;

    // Tính toán shop mới
    const currentMonthShops = await Shop.countDocuments({
      status: "approved",
      createdAt: {
        $gte: new Date(currentYear, currentMonth, 1),
        $lt: new Date(currentYear, currentMonth + 1, 1)
      }
    });
    
    const lastMonthShops = await Shop.countDocuments({
      status: "approved",
      createdAt: {
        $gte: new Date(lastMonthYear, lastMonth, 1),
        $lt: new Date(lastMonthYear, lastMonth + 1, 1)
      }
    });
    const shopsPercentage = lastMonthShops === 0 ? 100 : 
      ((currentMonthShops - lastMonthShops) / lastMonthShops) * 100;

    // Tạm thời cho shippers (có thể thay bằng model Shipper sau)
    const shippersCurrent = 156; // Giá trị mẫu
    const shippersLastMonth = 150; // Giá trị mẫu
    const shippersPercentage = ((shippersCurrent - shippersLastMonth) / shippersLastMonth) * 100;

    res.json({
      revenue: {
        current: currentMonthRevenue,
        percentage: revenuePercentage
      },
      orders: {
        current: currentMonthOrders,
        percentage: ordersPercentage
      },
      users: {
        current: currentMonthUsers,
        percentage: usersPercentage
      },
      shops: {
        current: currentMonthShops,
        percentage: shopsPercentage
      },
      shippers: {
        current: shippersCurrent,
        percentage: shippersPercentage
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function calculateRevenue(month, year) {
  const orders = await Order.find({
    status: "delivered",
    createdAt: {
      $gte: new Date(year, month, 1),
      $lt: new Date(year, month + 1, 1)
    }
  });
  
  return orders.reduce((sum, order) => sum + order.total, 0);
}

/* -------------------------- RECENT ACTIVITY -------------------------- */
router.get("/recent-activity", auth, admin, async (req, res) => {
  try {
    // Lấy các hoạt động gần đây
    const recentOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("user", "name");
    
    const recentShops = await Shop.find({ status: "approved" })
      .sort({ createdAt: -1 })
      .limit(3)
      .populate("owner", "name");

    const activities = [];

    // Thêm hoạt động đơn hàng
    recentOrders.forEach(order => {
      activities.push({
        type: "order",
        description: `New order #${order._id.toString().slice(-6)} from ${order.user?.name || "Customer"}`,
        createdAt: order.createdAt
      });
    });

    // Thêm hoạt động shop mới
    recentShops.forEach(shop => {
      activities.push({
        type: "shop",
        description: `New shop "${shop.name}" registered by ${shop.owner?.name || "Seller"}`,
        createdAt: shop.createdAt
      });
    });

    // Sắp xếp theo thời gian
    activities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(activities.slice(0, 5));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- RECENT ORDERS -------------------------- */
router.get("/recent-orders", auth, admin, async (req, res) => {
  try {
    const recentOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(7)
      .populate("user", "name email");

    const formattedOrders = recentOrders.map(order => ({
      orderId: `#ORD-${order._id.toString().slice(-4).toUpperCase()}`,
      customerId: {
        name: order.user?.name || "Unknown Customer"
      },
      amount: order.total,
      status: order.status,
      createdAt: order.createdAt
    }));

    res.json(formattedOrders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- REFRESH DASHBOARD -------------------------- */
router.post("/refresh", auth, admin, async (req, res) => {
  try {
    // Cập nhật dữ liệu thống kê
    // Có thể thêm logic cache hoặc tính toán lại tại đây
    
    res.json({ 
      message: "Dashboard data refreshed successfully",
      timestamp: new Date()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;