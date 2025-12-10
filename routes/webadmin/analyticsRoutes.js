// routes/webadmin/analyticsRoutes.js
const express = require('express');
const router = express.Router();
const Order = require('../../models/Order');
const User = require('../../models/User');
const Product = require('../../models/Product');

// ========== HELPER FUNCTIONS ==========
const getDateRange = (date) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { start, end };
};

// ========== 1. GET /summary - Tổng quan Analytics ==========
router.get('/summary', async (req, res) => {
    try {
        const now = new Date();
        const today = getDateRange(now);
        const yesterday = getDateRange(new Date(now.getTime() - 24 * 60 * 60 * 1000));

        // 1. Tổng doanh thu (Lifetime)
        const totalRevenueResult = await Order.aggregate([
            { $match: { status: { $in: ['delivered', 'shipping', 'arrived', 'processing'] } } },
            { $group: { _id: null, total: { $sum: '$total' } } }
        ]);

        // 2. Doanh thu hôm nay
        const todayRevenueResult = await Order.aggregate([
            { 
                $match: { 
                    createdAt: { $gte: today.start, $lte: today.end },
                    status: { $in: ['delivered', 'shipping', 'arrived', 'processing'] }
                }
            },
            { $group: { _id: null, total: { $sum: '$total' } } }
        ]);

        // 3. Doanh thu hôm qua
        const yesterdayRevenueResult = await Order.aggregate([
            { 
                $match: { 
                    createdAt: { $gte: yesterday.start, $lte: yesterday.end },
                    status: { $in: ['delivered', 'shipping', 'arrived', 'processing'] }
                }
            },
            { $group: { _id: null, total: { $sum: '$total' } } }
        ]);

        // 4. Đơn hàng hôm nay
        const todayOrders = await Order.countDocuments({
            createdAt: { $gte: today.start, $lte: today.end }
        });

        // 5. Khách hàng mới hôm nay
        const todayCustomers = await User.countDocuments({
            createdAt: { $gte: today.start, $lte: today.end }
        });

        // 6. Tính % tăng trưởng
        const todayRev = todayRevenueResult[0]?.total || 0;
        const yesterdayRev = yesterdayRevenueResult[0]?.total || 0;
        const growth = yesterdayRev > 0 
            ? parseFloat((((todayRev - yesterdayRev) / yesterdayRev) * 100).toFixed(1))
            : 0;

        // 7. Phương thức thanh toán (COD vs MoMo)
        const paymentStats = await Order.aggregate([
            { $match: { status: { $nin: ['cancelled', 'refunded'] } } },
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
            momo: paymentStats.find(p => p._id === 'momo')?.total || 0
        };

        // 8. Đơn hàng gần đây (10 đơn)
        const recentOrders = await Order.find()
            .sort({ createdAt: -1 })
            .limit(10)
            .populate('user', 'name email')
            .lean();

        // 9. Doanh thu theo danh mục
        const topCategories = await Order.aggregate([
            { $match: { status: { $nin: ['cancelled', 'refunded'] } } },
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

        res.json({
            totalRevenue: totalRevenueResult[0]?.total || 0,
            todayRevenue: todayRev,
            todayOrders,
            todayCustomers,
            growth,
            paymentBreakdown,
            recentOrders: recentOrders.map(o => ({
                _id: o._id,
                user: { name: o.user?.name || o.user?.email || 'Khách lẻ' },
                createdAt: o.createdAt,
                items: o.items,
                total: o.total,
                status: o.status
            })),
            topCategories: topCategories.map(c => ({
                _id: c._id || 'Chưa phân loại',
                revenue: c.revenue
            }))
        });

    } catch (error) {
        console.error('❌ Error in /summary:', error);
        res.status(500).json({ error: 'Failed to fetch analytics summary' });
    }
});

// ========== 2. GET /revenue-daily - Doanh thu 30 ngày ==========
router.get('/revenue-daily', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);

        const data = await Order.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate },
                    status: { $nin: ['cancelled', 'refunded'] }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    revenue: { $sum: '$total' },
                    orders: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Fill missing dates with 0
        const result = [];
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            const found = data.find(d => d._id === dateStr);
            result.push({
                date: dateStr,
                revenue: found?.revenue || 0,
                orders: found?.orders || 0
            });
        }

        res.json(result);

    } catch (error) {
        console.error('❌ Error in /revenue-daily:', error);
        res.status(500).json({ error: 'Failed to fetch daily revenue' });
    }
});

module.exports = router;
