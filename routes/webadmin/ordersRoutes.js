// routes/ordersRoutes.js
const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');

/**
 * @route   GET /api/webadmin/orders/list
 * @desc    Lấy danh sách tất cả đơn hàng
 * @access  Private (Admin only)
 */
router.get('/list', async (req, res) => {
  try {
    const { status, dateFilter, search, page = 1, limit = 10 } = req.query;
    
    let query = {};
    
    // Filter by status
    if (status) {
      query.status = status;
    }
    
    // Filter by date
    if (dateFilter) {
      const now = new Date();
      let startDate;
      
      switch (dateFilter) {
        case 'today':
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
      }
      
      if (startDate) {
        query.createdAt = { $gte: startDate };
      }
    }
    
    // Search by order number or customer info
    if (search) {
      // Note: This requires implementing search properly with user lookup
      // For now, we'll skip this and handle search on frontend
    }
    
    const skip = (page - 1) * limit;
    
    const orders = await Order.find(query)
      .populate('user', 'fullName email avatar phoneNumber')
      .populate({
        path: 'items.product',
        select: 'name imageUrl price'
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const total = await Order.countDocuments(query);
    
    // Format response
    const formattedOrders = orders.map(order => ({
      id: order._id,
      orderNumber: `ORD-${order._id.toString().slice(-8).toUpperCase()}`,
      customer: {
        name: order.user?.fullName || 'Unknown',
        email: order.user?.email || '',
        avatar: order.user?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(order.user?.fullName || 'U')}`,
        phone: order.user?.phoneNumber || ''
      },
      items: order.items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price
      })),
      itemCount: order.items.length,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      discount: order.discount,
      total: order.total,
      status: order.status,
      paymentMethod: order.paymentMethod,
      address: order.address,
      orderDate: order.createdAt,
      estimatedTime: order.estimatedTime,
      refundRequest: order.refundRequest,
      cancelRequest: order.cancelRequest
    }));
    
    res.json({
      success: true,
      data: formattedOrders,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy danh sách đơn hàng',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/webadmin/orders/stats
 * @desc    Lấy thống kê đơn hàng
 * @access  Private (Admin only)
 */
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Tổng số đơn hàng
    const totalOrders = await Order.countDocuments();
    
    // Đơn hàng hôm nay
    const todayOrders = await Order.countDocuments({
      createdAt: { $gte: today }
    });
    
    // Tổng giá trị hôm nay (không tính đơn đã hủy và hoàn tiền)
    const todayRevenue = await Order.aggregate([
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
    ]);
    
    // Đếm theo từng trạng thái
    const statusCounts = await Order.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const getCountByStatus = (status) => {
      return statusCounts.find(s => s._id === status)?.count || 0;
    };
    
    const stats = {
      total: totalOrders,
      today: todayOrders,
      todayRevenue: todayRevenue[0]?.total || 0,
      processing: getCountByStatus('processing'),
      shipping: getCountByStatus('shipping'),
      arrived: getCountByStatus('arrived'),
      delivered: getCountByStatus('delivered'),
      cancelled: getCountByStatus('cancelled'),
      refund_pending: getCountByStatus('refund_pending'),
      refunded: getCountByStatus('refunded')
    };
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching order stats:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy thống kê đơn hàng',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/webadmin/orders/trends
 * @desc    Lấy xu hướng đơn hàng theo thời gian
 * @access  Private (Admin only)
 */
router.get('/trends', async (req, res) => {
  try {
    const { timeframe = '7D' } = req.query;
    
    let days = 7;
    let groupFormat = '%Y-%m-%d';
    
    if (timeframe === '12M') {
      days = 365;
      groupFormat = '%Y-%m';
    }
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const trends = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: groupFormat, date: '$createdAt' }
          },
          count: { $sum: 1 },
          revenue: { 
            $sum: {
              $cond: [
                { $nin: ['$status', ['cancelled', 'refunded']] },
                '$total',
                0
              ]
            }
          }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Format labels
    const formattedTrends = trends.map(item => {
      let label = item._id;
      if (timeframe === '7D') {
        const date = new Date(item._id);
        label = date.toLocaleDateString('vi-VN', { 
          weekday: 'short', 
          day: 'numeric', 
          month: 'numeric' 
        });
      } else {
        const [year, month] = item._id.split('-');
        const monthNames = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];
        label = `${monthNames[parseInt(month) - 1]} ${year}`;
      }
      
      return {
        label,
        date: item._id,
        count: item.count,
        revenue: item.revenue
      };
    });
    
    res.json({
      success: true,
      data: formattedTrends
    });
  } catch (error) {
    console.error('Error fetching order trends:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy xu hướng đơn hàng',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/webadmin/orders/status-distribution
 * @desc    Lấy phân bố trạng thái đơn hàng (7 trạng thái)
 * @access  Private (Admin only)
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
    
    const total = distribution.reduce((sum, item) => sum + item.count, 0);
    
    const formattedDistribution = distribution.map(item => ({
      status: item._id,
      count: item.count,
      percentage: total > 0 ? ((item.count / total) * 100).toFixed(1) : '0.0'
    }));
    
    res.json({
      success: true,
      data: formattedDistribution
    });
  } catch (error) {
    console.error('Error fetching status distribution:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy phân bố trạng thái',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/webadmin/orders/:id
 * @desc    Lấy chi tiết một đơn hàng
 * @access  Private (Admin only)
 */
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'fullName email avatar phoneNumber')
      .populate({
        path: 'items.product',
        select: 'name imageUrl price category'
      })
      .populate('voucher', 'code discountType discountValue')
      .populate('items.shopId', 'name address')
      .lean();
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đơn hàng'
      });
    }
    
    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Error fetching order detail:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy chi tiết đơn hàng',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/webadmin/orders/:id/status
 * @desc    Cập nhật trạng thái đơn hàng
 * @access  Private (Admin only)
 */
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    
    // Các trạng thái hợp lệ từ model Order
    const validStatuses = [
      'processing', 
      'shipping', 
      'arrived', 
      'delivered', 
      'cancelled', 
      'refund_pending', 
      'refunded'
    ];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Trạng thái không hợp lệ'
      });
    }
    
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status, updatedAt: Date.now() },
      { new: true }
    );
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đơn hàng'
      });
    }
    
    res.json({
      success: true,
      message: 'Cập nhật trạng thái thành công',
      data: order
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi cập nhật trạng thái',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/webadmin/orders/bulk-update
 * @desc    Cập nhật trạng thái nhiều đơn hàng
 * @access  Private (Admin only)
 */
router.post('/bulk-update', async (req, res) => {
  try {
    const { orderIds, status } = req.body;
    
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Danh sách đơn hàng không hợp lệ'
      });
    }
    
    const validStatuses = [
      'processing', 
      'shipping', 
      'arrived', 
      'delivered', 
      'cancelled', 
      'refund_pending', 
      'refunded'
    ];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Trạng thái không hợp lệ'
      });
    }
    
    const result = await Order.updateMany(
      { _id: { $in: orderIds } },
      { status, updatedAt: Date.now() }
    );
    
    res.json({
      success: true,
      message: `Đã cập nhật ${result.modifiedCount} đơn hàng`,
      data: {
        matched: result.matchedCount,
        modified: result.modifiedCount
      }
    });
  } catch (error) {
    console.error('Error bulk updating orders:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi cập nhật hàng loạt',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/webadmin/orders/:id
 * @desc    Xóa đơn hàng (admin only, nên hạn chế)
 * @access  Private (Admin only)
 */
router.delete('/:id', async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đơn hàng'
      });
    }
    
    res.json({
      success: true,
      message: 'Đã xóa đơn hàng thành công'
    });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi xóa đơn hàng',
      error: error.message
    });
  }
});

module.exports = router;
