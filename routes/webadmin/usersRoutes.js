// routes/webadmin/usersRoutes.js
const express = require('express');
const router = express.Router();
const User = require('../../models/User');
const Order = require('../../models/Order');

// ========== HELPER FUNCTIONS ==========
const getDateRange = (date) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { start, end };
};

// ========== 1. GET /summary - Tổng quan Users ==========
router.get('/summary', async (req, res) => {
    try {
        // 1. Total Users (Tất cả tài khoản)
        const totalUsers = await User.countDocuments();

        // 2. Active Users (Đang hoạt động - đăng nhập trong 30 ngày qua)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const activeUsers = await User.countDocuments({
            updatedAt: { $gte: thirtyDaysAgo }
        });

        // 3. User vs Seller Distribution (Biểu đồ tròn)
        const regularUsers = await User.countDocuments({ isSeller: false });
        const sellers = await User.countDocuments({ isSeller: true });

        res.json({
            totalUsers,
            activeUsers,
            userDistribution: {
                users: regularUsers,
                sellers: sellers
            }
        });

    } catch (error) {
        console.error('❌ Error in /summary:', error);
        res.status(500).json({ error: 'Failed to fetch users summary' });
    }
});

// ========== 2. GET /growth-chart - Biểu đồ tăng trưởng Users theo thời gian ==========
router.get('/growth-chart', async (req, res) => {
    try {
        const { period = '7days' } = req.query;
        
        let days = 7;
        if (period === '1month') days = 30;
        if (period === '1year') days = 365;

        const result = [];
        
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const range = getDateRange(date);
            
            const count = await User.countDocuments({
                createdAt: { $gte: range.start, $lte: range.end }
            });

            result.push({
                date: date.toISOString().split('T')[0],
                count
            });
        }

        res.json(result);

    } catch (error) {
        console.error('❌ Error in /growth-chart:', error);
        res.status(500).json({ error: 'Failed to fetch growth chart' });
    }
});

// ========== 3. GET /recent-activities - 7 hoạt động gần nhất ==========
router.get('/recent-activities', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 7;

        // Lấy user mới nhất
        const newUsers = await User.find()
            .sort({ createdAt: -1 })
            .limit(limit)
            .select('name email createdAt')
            .lean();

        // Lấy đơn hàng mới nhất
        const recentOrders = await Order.find()
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('user', 'name email')
            .select('user total createdAt')
            .lean();

        // Gộp activities
        const activities = [];

        newUsers.forEach(user => {
            activities.push({
                type: 'new_user',
                user: user.name || user.email,
                action: 'đã tạo tài khoản mới',
                icon: 'person-plus-fill',
                iconColor: 'success',
                time: user.createdAt,
                details: `Email: ${user.email}`
            });
        });

        recentOrders.forEach(order => {
            activities.push({
                type: 'new_order',
                user: order.user?.name || order.user?.email || 'Khách lẻ',
                action: 'đã đặt hàng',
                icon: 'cart-check-fill',
                iconColor: 'primary',
                time: order.createdAt,
                details: `Giá trị: ${order.total.toLocaleString('vi-VN')}đ`
            });
        });

        // Sắp xếp theo thời gian
        activities.sort((a, b) => new Date(b.time) - new Date(a.time));

        res.json(activities.slice(0, limit));

    } catch (error) {
        console.error('❌ Error in /recent-activities:', error);
        res.status(500).json({ error: 'Failed to fetch activities' });
    }
});

// ========== 4. GET /directory - Danh sách User Directory (10 users) ==========
router.get('/directory', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const role = req.query.role || '';

        // Build query
        let query = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        if (role) {
            query.role = role;
        }

        // Fetch users
        const users = await User.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit)
            .select('name email role isSeller avatar createdAt updatedAt')
            .lean();

        const total = await User.countDocuments(query);

        res.json({
            users,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error in /directory:', error);
        res.status(500).json({ error: 'Failed to fetch users directory' });
    }
});

// ========== 5. DELETE /bulk-delete - Xóa nhiều users ==========
router.post('/bulk-delete', async (req, res) => {
    try {
        const { userIds } = req.body;

        if (!Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ error: 'Invalid userIds array' });
        }

        const result = await User.deleteMany({ _id: { $in: userIds } });

        res.json({
            success: true,
            deletedCount: result.deletedCount,
            message: `Đã xóa ${result.deletedCount} tài khoản`
        });

    } catch (error) {
        console.error('❌ Error in /bulk-delete:', error);
        res.status(500).json({ error: 'Failed to delete users' });
    }
});

module.exports = router;
