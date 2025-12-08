// routes/webadmin/analyticsRoutes.js

const express = require('express');
const router = express.Router();
const Order = require('../../models/Order');
const User = require('../../models/User');
const Shop = require('../../models/Shop');
const Product = require('../../models/Product');

console.log('✅ Analytics Routes Module Loaded!');

// ============================================================
// MIDDLEWARE: Bypass Auth (giống dashboardRoutes.js)
// ============================================================
const bypassAuth = (req, res, next) => {
  req.user = { _id: 'admin', role: 'admin' };
  next();
};

router.use(bypassAuth);

// ============================================================
// 1. SUMMARY - Tổng quan
// ============================================================
router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    // Tổng doanh thu tất cả thời gian
    const totalRevenue = await Order.aggregate([
      { $match: { status: { $in: ['delivered', 'shipping', 'arrived'] } } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);

    // Doanh thu hôm nay
    const todayRevenue = await Order.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startOfToday },
          status: { $in: ['delivered', 'shipping', 'arrived', 'processing'] }
        } 
      },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);

    // Doanh thu hôm qua
    const yesterdayRevenue = await Order.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startOfYesterday, $lt: startOfToday },
          status: { $in: ['delivered', 'shipping', 'arrived', 'processing'] }
        } 
      },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);

    // Đơn hàng hôm nay
    const todayOrders = await Order.countDocuments({
      createdAt: { $gte: startOfToday }
    });

    // Khách hàng mới hôm nay
    const todayCustomers = await User.countDocuments({
      createdAt: { $gte: startOfToday }
    });

    // Tính growth
    const todayRev = todayRevenue[0]?.total || 0;
    const yesterdayRev = yesterdayRevenue[0]?.total || 0;
    const growth = yesterdayRev > 0 
      ? ((todayRev - yesterdayRev) / yesterdayRev * 100).toFixed(1)
      : 0;

    // Tổng users, shops, products
    const [totalUsers, totalShops, totalProducts] = await Promise.all([
      User.countDocuments(),
      Shop.countDocuments(),
      Product.countDocuments()
    ]);

    // Payment breakdown
    const paymentStats = await Order.aggregate([
      { $match: { status: { $in: ['delivered', 'shipping', 'arrived', 'processing'] } } },
      {
        $group: {
          _id: '$paymentMethod',
          total: { $sum: '$total' },
          count: { $sum: 1 }
        }
      }
    ]);

    const paymentBreakdown = {
      cod: paymentStats.find(p => p._id === 'cod')?.total || 0,
      momo: paymentStats.find(p => p._id === 'momo')?.total || 0,
      codCount: paymentStats.find(p => p._id === 'cod')?.count || 0,
      momoCount: paymentStats.find(p => p._id === 'momo')?.count || 0
    };

    // ✅ SỬA: Chỉ populate 'user', KHÔNG populate 'shop'
    const recentOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('user', 'name email')  // Chỉ populate user
      .lean();

    res.json({
      totalRevenueAllTime: totalRevenue[0]?.total || 0,
      todayRevenue: todayRev,
      todayOrders,
      todayCustomers,
      growth: parseFloat(growth),
      totalUsers,
      totalShops,
      totalProducts,
      paymentBreakdown,
      recentOrders: recentOrders.map(o => ({
        _id: o._id,
        total: o.total,
        status: o.status,
        paymentMethod: o.paymentMethod,
        createdAt: o.createdAt,
        userName: o.user?.name || 'Khách lẻ'
      }))
    });

  } catch (error) {
    console.error('❌ Error in /summary:', error);
    res.status(500).json({ 
      error: 'Không thể lấy dữ liệu tổng quan',
      message: error.message 
    });
  }
});

// ============================================================
// 2. REVENUE DAILY - Doanh thu theo ngày
// ============================================================
router.get('/revenue-daily', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const data = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $in: ['delivered', 'shipping', 'arrived'] }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json(data);
  } catch (error) {
    console.error('❌ Error in /revenue-daily:', error);
    res.status(500).json({ error: 'Không thể lấy dữ liệu', message: error.message });
  }
});

// ============================================================
// 3. TOP SHOPS - Cửa hàng bán chạy
// ============================================================
router.get('/top-shops', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const data = await Order.aggregate([
      { $match: { status: { $in: ['delivered', 'shipping', 'arrived'] } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.shopId',
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          orders: { $sum: 1 }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'shops',
          localField: '_id',
          foreignField: '_id',
          as: 'shopInfo'
        }
      },
      { $unwind: { path: '$shopInfo', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          name: { $ifNull: ['$shopInfo.name', 'Unknown Shop'] },
          revenue: 1,
          orders: 1
        }
      }
    ]);

    res.json(data);
  } catch (error) {
    console.error('❌ Error in /top-shops:', error);
    res.status(500).json({ error: 'Không thể lấy dữ liệu', message: error.message });
  }
});

// ============================================================
// 4. TOP PRODUCTS - Sản phẩm bán chạy
// ============================================================
router.get('/top-products', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const data = await Order.aggregate([
      { $match: { status: { $in: ['delivered', 'shipping', 'arrived'] } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          quantity: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { quantity: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'productInfo'
        }
      },
      { $unwind: { path: '$productInfo', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          name: { $ifNull: ['$productInfo.name', 'Unknown Product'] },
          quantity: 1,
          revenue: 1
        }
      }
    ]);

    res.json(data);
  } catch (error) {
    console.error('❌ Error in /top-products:', error);
    res.status(500).json({ error: 'Không thể lấy dữ liệu', message: error.message });
  }
});

// ============================================================
// 5. TOP CATEGORIES - Danh mục bán chạy
// ============================================================
router.get('/top-categories', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const data = await Order.aggregate([
      { $match: { status: { $in: ['delivered', 'shipping', 'arrived'] } } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productInfo'
        }
      },
      { $unwind: { path: '$productInfo', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$productInfo.category',
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          count: { $sum: 1 }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          category: { $ifNull: ['$_id', 'Không xác định'] },
          revenue: 1,
          count: 1
        }
      }
    ]);

    res.json(data);
  } catch (error) {
    console.error('❌ Error in /top-categories:', error);
    res.status(500).json({ error: 'Không thể lấy dữ liệu', message: error.message });
  }
});

// ============================================================
// 6. ORDER STATUS - Thống kê trạng thái đơn hàng
// ============================================================
router.get('/order-status', async (req, res) => {
  try {
    const data = await Order.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    const statusLabels = {
      processing: 'Đang xử lý',
      shipping: 'Đang giao',
      arrived: 'Đã đến',
      delivered: 'Hoàn thành',
      cancelled: 'Đã hủy',
      refund_pending: 'Chờ hoàn tiền',
      refunded: 'Đã hoàn tiền'
    };

    const result = data.map(d => ({
      _id: d._id,
      label: statusLabels[d._id] || d._id,
      count: d.count
    }));

    res.json(result);
  } catch (error) {
    console.error('❌ Error in /order-status:', error);
    res.status(500).json({ error: 'Không thể lấy dữ liệu', message: error.message });
  }
});

// ============================================================
// 7. USER GROWTH - Tăng trưởng user theo ngày
// ============================================================
router.get('/user-growth', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const data = await User.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          newUsers: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json(data);
  } catch (error) {
    console.error('❌ Error in /user-growth:', error);
    res.status(500).json({ error: 'Không thể lấy dữ liệu', message: error.message });
  }
});

// ============================================================
// 8. REVENUE HOURLY - Doanh thu theo giờ (hôm nay)
// ============================================================
router.get('/revenue-hourly', async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const data = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfToday },
          status: { $in: ['delivered', 'shipping', 'arrived', 'processing'] }
        }
      },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          hour: '$_id',
          revenue: 1,
          orders: 1
        }
      }
    ]);

    res.json(data);
  } catch (error) {
    console.error('❌ Error in /revenue-hourly:', error);
    res.status(500).json({ error: 'Không thể lấy dữ liệu', message: error.message });
  }
});

// ============================================================
// 9. EXPORT - Export tất cả dữ liệu
// ============================================================
router.get('/export', async (req, res) => {
  try {
    const [orders, users, shops, products] = await Promise.all([
      Order.find().populate('user', 'name email').lean(),
      User.find().lean(),
      Shop.find().lean(),
      Product.find().lean()
    ]);

    res.json({
      orders,
      users,
      shops,
      products,
      exportedAt: new Date()
    });
  } catch (error) {
    console.error('❌ Error in /export:', error);
    res.status(500).json({ error: 'Không thể xuất dữ liệu', message: error.message });
  }
});

module.exports = router;
