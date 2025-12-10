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

const calculateGrowth = (current, previous) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return parseFloat((((current - previous) / previous) * 100).toFixed(1));
};

// ========== 1. GET /summary - Tổng quan Analytics ==========
router.get('/summary', async (req, res) => {
    try {
        const now = new Date();
        const today = getDateRange(now);
        const yesterday = getDateRange(new Date(now.getTime() - 24 * 60 * 60 * 1000));

        // Lấy ngày đầu tuần (Thứ 2)
        const startOfWeek = new Date(now);
        const dayOfWeek = startOfWeek.getDay();
        const diff = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek; // Thứ 2 = 1
        startOfWeek.setDate(startOfWeek.getDate() + diff);
        startOfWeek.setHours(0, 0, 0, 0);

        // Tuần trước
        const startOfLastWeek = new Date(startOfWeek);
        startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
        const endOfLastWeek = new Date(startOfWeek);
        endOfLastWeek.setMilliseconds(-1);

        // Đầu tháng
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        
        // Tháng trước
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

        // Đầu năm
        const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
        
        // Năm trước
        const startOfLastYear = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0);
        const endOfLastYear = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);

        // === HELPER: Tính doanh thu theo khoảng thời gian ===
        const getRevenue = async (start, end) => {
            const result = await Order.aggregate([
                { 
                    $match: { 
                        createdAt: { $gte: start, $lte: end },
                        status: { $nin: ['cancelled', 'refunded'] }
                    }
                },
                { $group: { _id: null, total: { $sum: '$total' } } }
            ]);
            return result[0]?.total || 0;
        };

        // 1. Tổng doanh thu (Lifetime)
        const totalRevenue = await getRevenue(new Date(0), now);

        // 2. Doanh thu hôm nay
        const todayRevenue = await getRevenue(today.start, today.end);
        const yesterdayRevenue = await getRevenue(yesterday.start, yesterday.end);

        // 3. Doanh thu tuần này
        const weekRevenue = await getRevenue(startOfWeek, now);
        const lastWeekRevenue = await getRevenue(startOfLastWeek, endOfLastWeek);

        // 4. Doanh thu tháng này
        const monthRevenue = await getRevenue(startOfMonth, now);
        const lastMonthRevenue = await getRevenue(startOfLastMonth, endOfLastMonth);

        // 5. Doanh thu năm nay
        const yearRevenue = await getRevenue(startOfYear, now);
        const lastYearRevenue = await getRevenue(startOfLastYear, endOfLastYear);

        // 6. Đơn hàng hôm nay
        const todayOrders = await Order.countDocuments({
            createdAt: { $gte: today.start, $lte: today.end }
        });

        // 7. Khách hàng mới hôm nay
        const todayCustomers = await User.countDocuments({
            createdAt: { $gte: today.start, $lte: today.end }
        });

        // 8. Phương thức thanh toán
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

        // 9. Đơn hàng gần đây
        const recentOrders = await Order.find()
            .sort({ createdAt: -1 })
            .limit(10)
            .populate('user', 'name email')
            .lean();

        // 10. Doanh thu theo danh mục
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
            totalRevenue,
            todayRevenue,
            todayOrders,
            todayCustomers,
            growth: calculateGrowth(todayRevenue, yesterdayRevenue),
            
            // 🆕 Dữ liệu theo thời gian
            weekRevenue,
            weekGrowth: calculateGrowth(weekRevenue, lastWeekRevenue),
            monthRevenue,
            monthGrowth: calculateGrowth(monthRevenue, lastMonthRevenue),
            yearRevenue,
            yearGrowth: calculateGrowth(yearRevenue, lastYearRevenue),
            
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

        // Fill missing dates
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
