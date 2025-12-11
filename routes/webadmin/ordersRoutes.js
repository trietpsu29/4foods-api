// routes/webadmin/ordersRoutes.js

const express = require('express');
const router = express.Router();
const Order = require('../../models/Order');
const User = require('../../models/User');

/**
 * GET /api/webadmin/orders/stats
 * Lấy thống kê tổng quan đơn hàng
 */
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalOrders, todayOrders, todayRevenue] = await Promise.all([
      // Tổng số đơn hàng
      Order.countDocuments(),
      
      // Đơn hàng hôm nay
      Order.countDocuments({
        createdAt: { $gte: today }
      }),
      
      // Doanh thu hôm nay
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: today },
            status: { $nin: ['cancelled', 'refunded'] }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$total' }
          }
        }
      ])
    ]);

    res.json({
      totalOrders,
      todayOrders,
      todayRevenue: todayRevenue[0]?.total || 0
    });
  } catch (error) {
    console.error('Get orders stats error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * GET /api/webadmin/orders/trends
 * Lấy xu hướng đơn hàng 7 ngày gần nhất
 */
router.get('/trends', async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const trends = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Tạo mảng đầy đủ 7 ngày
    const categories = [];
    const series = [];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayLabel = date.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' });
      
      categories.push(dayLabel);
      
      const found = trends.find(t => t._id === dateStr);
      series.push(found ? found.count : 0);
    }

    res.json({
      categories,
      series
    });
  } catch (error) {
    console.error('Get orders trends error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * GET /api/webadmin/orders/status-distribution
 * Phân bố trạng thái đơn hàng
 */
router.get('/status-distribution', async (req, res) => {
  try {
    const distribution = await Order.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    res.json(distribution);
  } catch (error) {
    console.error('Get status distribution error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * GET /api/webadmin/orders/list
 * Lấy danh sách đơn hàng với phân trang và lọc
 */
router.get('/list', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = '',
      paymentMethod = '',
      startDate = '',
      endDate = ''
    } = req.query;

    // Build filter
    const filter = {};

    if (status) {
      filter.status = status;
    }

    if (paymentMethod) {
      filter.paymentMethod = paymentMethod;
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = endDateTime;
      }
    }

    // Search by user or order ID
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      
      // Tìm users match với search
      const matchedUsers = await User.find({
        $or: [
          { fullname: searchRegex },
          { phone: searchRegex },
          { email: searchRegex }
        ]
      }).select('_id');

      const userIds = matchedUsers.map(u => u._id);

      filter.$or = [
        { user: { $in: userIds } },
        { _id: search } // Nếu search là ObjectId
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [orders, totalItems] = await Promise.all([
      Order.find(filter)
        .populate('user', 'fullname phone email')
        .populate('items.product', 'name images')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Order.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalItems / parseInt(limit));

    res.json({
      orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get orders list error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * GET /api/webadmin/orders/:id
 * Lấy chi tiết một đơn hàng
 */
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'fullname phone email')
      .populate('items.product', 'name images price')
      .populate('items.shopId', 'name')
      .populate('voucher');

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    res.json(order);
  } catch (error) {
    console.error('Get order detail error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * PUT /api/webadmin/orders/:id/status
 * Cập nhật trạng thái đơn hàng
 */
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;

    const validStatuses = [
      'processing', 'shipping', 'arrived', 'delivered', 
      'cancelled', 'refund_pending', 'refunded'
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Trạng thái không hợp lệ' });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    res.json({ message: 'Cập nhật trạng thái thành công', order });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * POST /api/webadmin/orders/bulk-update
 * Cập nhật hàng loạt trạng thái đơn hàng
 */
router.post('/bulk-update', async (req, res) => {
  try {
    const { orderIds, status } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ message: 'Danh sách đơn hàng không hợp lệ' });
    }

    const validStatuses = [
      'processing', 'shipping', 'arrived', 'delivered', 
      'cancelled', 'refund_pending', 'refunded'
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Trạng thái không hợp lệ' });
    }

    const result = await Order.updateMany(
      { _id: { $in: orderIds } },
      { $set: { status } }
    );

    res.json({ 
      message: 'Cập nhật thành công', 
      modifiedCount: result.modifiedCount 
    });
  } catch (error) {
    console.error('Bulk update orders error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
