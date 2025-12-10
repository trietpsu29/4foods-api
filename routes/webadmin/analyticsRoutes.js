// routes/webadmin/analyticsRoutes.js

const express = require('express');
const router = express.Router();
const Order = require('../../models/Order');
const User = require('../../models/User');
const Shop = require('../../models/Shop');
const Product = require('../../models/Product');

console.log('✅ Analytics Routes Module Loaded!');

// ============================================================
// MIDDLEWARE: Bypass Auth (giống các routes khác)
// ============================================================
const bypassAuth = (req, res, next) => {
  req.user = { _id: 'admin', role: 'admin' };
  next();
};

router.use(bypassAuth);

// ============================================================
// 1. GET /summary - Tổng quan analytics
// ============================================================
router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    // 1. Tổng doanh thu tất cả thời gian (chỉ đơn đã giao hoặc đang giao)
    const totalRevenueResult = await Order.aggregate([
      { 
        $match: { 
          status: { $in: ['delivered', 'shipping', 'arrived'] } 
        } 
      },
      { 
        $group: { 
          _id: null, 
          total: { $sum: '$total' } 
        } 
      }
    ]);

    // 2. Doanh thu hôm nay
    const todayRevenueResult = await Order.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startOfToday },
          status: { $in: ['delivered', 'shipping', 'arrived', 'processing'] }
        } 
      },
      { 
        $group: { 
          _id: null, 
          total: { $sum: '$total' } 
        } 
      }
    ]);

    // 3. Doanh thu hôm qua (để tính growth)
    const yesterdayRevenueResult = await Order.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startOfYesterday, $lt: startOfToday },
          status: { $in: ['delivered', 'shipping', 'arrived', 'processing'] }
        } 
      },
      { 
        $group: { 
          _id: null, 
          total: { $sum: '$total' } 
        } 
      }
    ]);

    // 4. Số đơn hàng hôm nay
    const todayOrders = await Order.countDocuments({
      createdAt: { $gte: startOfToday }
    });

    // 5. Số khách hàng mới hôm nay
    const todayCustomers = await User.countDocuments({
      createdAt: { $gte: startOfToday }
    });

    // 6. Tính % tăng trưởng
    const todayRev = todayRevenueResult[0]?.total || 0;
    const yesterdayRev = yesterdayRevenueResult[0]?.total || 0;
    const growth = yesterdayRev > 0 
      ? ((todayRev - yesterdayRev) / yesterdayRev * 100).toFixed(1)
      : 0;

    // 7. Payment breakdown (COD vs MoMo)
    const paymentStats = await Order.aggregate([
      { 
        $match: { 
          status: { $in: ['delivered', 'shipping', 'arrived', 'processing'] } 
        } 
      },
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

    // 8. Đơn hàng gần đây (10 đơn mới nhất)
    const recentOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('user', 'name email')
      .lean();

    // 9. Doanh thu theo danh mục (top categories)
    const topCategories = await Order.aggregate([
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
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 }
    ]);

    // Response
    res.json({
      totalRevenue: totalRevenueResult[0]?.total || 0,
      todayRevenue: todayRev,
      todayOrders,
      todayCustomers,
      growth: parseFloat(growth),
      paymentBreakdown,
      recentOrders: recentOrders.map(o => ({
        id: o._id,
        user: {
          name: o.user?.name || 'Khách lẻ'
        },
        createdAt: o.createdAt,
        items: o.items,
        total: o.total,
        status: o.status
      })),
      topCategories: topCategories.map(c => ({
        id: c._id || 'Chưa xác định',
        revenue: c.revenue
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
// 2. GET /revenue-daily - Doanh thu theo ngày (30 ngày gần nhất)
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
    res.status(500).json({ 
      error: 'Không thể lấy dữ liệu doanh thu',
      message: error.message 
    });
  }
});

module.exports = router;
