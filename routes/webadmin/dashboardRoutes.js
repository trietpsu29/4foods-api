const express = require('express');
const router = express.Router();
const Order = require('../../models/Order');
const User = require('../../models/User');
const Shop = require('../../models/Shop');

// ========== HELPER FUNCTIONS ==========
const getDateRange = (date) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    
    return { start, end };
};

const getTodayRange = () => getDateRange(new Date());
const getYesterdayRange = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return getDateRange(yesterday);
};

const calculateGrowth = (current, previous) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return parseFloat((((current - previous) / previous) * 100).toFixed(1));
};

// ========== 1. SUMMARY STATS (4 khối đầu) ==========
router.get('/summary', async (req, res) => {
    try {
        const today = getTodayRange();
        const yesterday = getYesterdayRange();

        // === DOANH THU ===
        const revenueToday = await Order.aggregate([
            {
                $match: {
                    createdAt: { $gte: today.start, $lte: today.end },
                    status: { $nin: ['cancelled', 'refunded'] }
                }
            },
            { $group: { _id: null, total: { $sum: '$total' } } }
        ]);

        const revenueYesterday = await Order.aggregate([
            {
                $match: {
                    createdAt: { $gte: yesterday.start, $lte: yesterday.end },
                    status: { $nin: ['cancelled', 'refunded'] }
                }
            },
            { $group: { _id: null, total: { $sum: '$total' } } }
        ]);

        const revToday = revenueToday[0]?.total || 0;
        const revYesterday = revenueYesterday[0]?.total || 0;

        // === ĐƠN HÀNG ===
        const ordersToday = await Order.countDocuments({
            createdAt: { $gte: today.start, $lte: today.end }
        });

        const ordersYesterday = await Order.countDocuments({
            createdAt: { $gte: yesterday.start, $lte: yesterday.end }
        });

        // === NGƯỜI DÙNG MỚI ===
        const usersToday = await User.countDocuments({
            createdAt: { $gte: today.start, $lte: today.end }
        });

        const usersYesterday = await User.countDocuments({
            createdAt: { $gte: yesterday.start, $lte: yesterday.end }
        });

        // === SHOP MỚI ===
        const shopsToday = await Shop.countDocuments({
            createdAt: { $gte: today.start, $lte: today.end }
        });

        const shopsYesterday = await Shop.countDocuments({
            createdAt: { $gte: yesterday.start, $lte: yesterday.end }
        });

        res.json({
            revenue: {
                value: revToday,
                growth: calculateGrowth(revToday, revYesterday)
            },
            orders: {
                value: ordersToday,
                growth: calculateGrowth(ordersToday, ordersYesterday)
            },
            newUsers: {
                value: usersToday,
                growth: calculateGrowth(usersToday, usersYesterday)
            },
            newShops: {
                value: shopsToday,
                growth: calculateGrowth(shopsToday, shopsYesterday)
            }
        });

    } catch (error) {
        console.error('❌ Error fetching summary:', error);
        res.status(500).json({ error: 'Failed to fetch summary stats' });
    }
});

// ========== 2. REVENUE CHART (12 tháng) ==========
router.get('/revenue-chart', async (req, res) => {
    try {
        const months = [];
        const values = [];
        
        for (let i = 11; i >= 0; i--) {
            const date = new Date();
            date.setMonth(date.getMonth() - i);
            
            const year = date.getFullYear();
            const month = date.getMonth();
            
            const startOfMonth = new Date(year, month, 1);
            const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);
            
            const revenue = await Order.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startOfMonth, $lte: endOfMonth },
                        status: { $nin: ['cancelled', 'refunded'] }
                    }
                },
                { $group: { _id: null, total: { $sum: '$total' } } }
            ]);
            
            const monthLabel = date.toLocaleDateString('vi-VN', { 
                month: 'short', 
                year: 'numeric' 
            });
            
            months.push(monthLabel);
            values.push(revenue[0]?.total || 0);
        }

        res.json({ months, values });

    } catch (error) {
        console.error('❌ Error fetching revenue chart:', error);
        res.status(500).json({ error: 'Failed to fetch revenue data' });
    }
});

// ========== 3. RECENT ACTIVITIES ==========
router.get('/activities', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        
        // Lấy các hoạt động gần đây
        const recentOrders = await Order.find()
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('user', 'name email')
            .select('_id user total status createdAt')
            .lean();

        const recentUsers = await User.find()
            .sort({ createdAt: -1 })
            .limit(limit)
            .select('_id name email createdAt')
            .lean();

        const recentShops = await Shop.find()
            .sort({ createdAt: -1 })
            .limit(limit)
            .select('_id name status createdAt')
            .lean();

        // Gộp và format activities
        const activities = [];

        recentOrders.forEach(order => {
            activities.push({
                type: 'order',
                user: order.user?.name || order.user?.email || 'Khách vãng lai',
                action: `đã đặt đơn hàng #${order._id.toString().slice(-6)} (${order.total.toLocaleString('vi-VN')}đ)`,
                time: order.createdAt,
                status: order.status
            });
        });

        recentUsers.forEach(user => {
            activities.push({
                type: 'user',
                user: user.name || user.email,
                action: 'đã đăng ký tài khoản mới',
                time: user.createdAt
            });
        });

        recentShops.forEach(shop => {
            activities.push({
                type: 'shop',
                user: shop.name,
                action: `đã đăng ký shop (${shop.status})`,
                time: shop.createdAt
            });
        });

        // Sắp xếp theo thời gian và giới hạn
        activities.sort((a, b) => new Date(b.time) - new Date(a.time));
        
        res.json(activities.slice(0, limit));

    } catch (error) {
        console.error('❌ Error fetching activities:', error);
        res.status(500).json({ error: 'Failed to fetch activities' });
    }
});

// ========== 4. RECENT ORDERS (7 đơn gần nhất) ==========
router.get('/recent-orders', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 7;
        
        const orders = await Order.find()
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('user', 'name email')
            .select('_id user total status createdAt')
            .lean();

        const formatted = orders.map(order => ({
            code: order._id.toString().slice(-8).toUpperCase(),
            customer: order.user?.name || order.user?.email || 'Khách vãng lai',
            total: order.total,
            status: order.status,
            createdAt: order.createdAt
        }));

        res.json(formatted);

    } catch (error) {
        console.error('❌ Error fetching recent orders:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// ========== 5. ORDER STATUS DISTRIBUTION ==========
router.get('/order-status', async (req, res) => {
    try {
        const distribution = await Order.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);

        const statusMap = {
            'processing': 'Đang xử lý',
            'shipping': 'Đang giao',
            'arrived': 'Đã đến',
            'delivered': 'Đã giao',
            'cancelled': 'Đã hủy',
            'refund_pending': 'Chờ hoàn tiền',
            'refunded': 'Đã hoàn tiền'
        };

        const labels = [];
        const values = [];

        distribution.forEach(item => {
            labels.push(statusMap[item._id] || item._id);
            values.push(item.count);
        });

        res.json({ labels, values });

    } catch (error) {
        console.error('❌ Error fetching order status:', error);
        res.status(500).json({ error: 'Failed to fetch order status' });
    }
});

// ========== 6. USER GROWTH (30 ngày) ==========
router.get('/user-growth', async (req, res) => {
    try {
        const days = [];
        const values = [];
        
        for (let i = 29; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            
            const range = getDateRange(date);
            
            const count = await User.countDocuments({
                createdAt: { $gte: range.start, $lte: range.end }
            });
            
            const dayLabel = date.toLocaleDateString('vi-VN', { 
                day: '2-digit', 
                month: '2-digit' 
            });
            
            days.push(dayLabel);
            values.push(count);
        }

        res.json({ days, values });

    } catch (error) {
        console.error('❌ Error fetching user growth:', error);
        res.status(500).json({ error: 'Failed to fetch user growth' });
    }
});

module.exports = router;
