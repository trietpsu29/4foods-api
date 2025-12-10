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
        const totalUsers = await User.countDocuments();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const activeUsers = await User.countDocuments({
            updatedAt: { $gte: thirtyDaysAgo }
        });

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

// ========== 2. GET /growth-chart - Biểu đồ tăng trưởng ==========
router.get('/growth-chart', async (req, res) => {
    try {
        const { period = '7days' } = req.query;
        
        let result = [];

        if (period === '1year') {
            // Trả về theo THÁNG (12 tháng gần nhất)
            for (let i = 11; i >= 0; i--) {
                const date = new Date();
                date.setMonth(date.getMonth() - i);
                
                const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0);
                const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
                
                const count = await User.countDocuments({
                    createdAt: { $gte: startOfMonth, $lte: endOfMonth }
                });

                result.push({
                    label: date.toLocaleDateString('vi-VN', { month: 'short', year: 'numeric' }),
                    count
                });
            }
        } else {
            // Trả về theo NGÀY
            let days = period === '1month' ? 30 : 7;
            
            for (let i = days - 1; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const range = getDateRange(date);
                
                const count = await User.countDocuments({
                    createdAt: { $gte: range.start, $lte: range.end }
                });

                result.push({
                    label: date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
                    count
                });
            }
        }

        res.json(result);

    } catch (error) {
        console.error('❌ Error in /growth-chart:', error);
        res.status(500).json({ error: 'Failed to fetch growth chart' });
    }
});

// ========== 3. GET /recent-activities ==========
router.get('/recent-activities', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;

        const newUsers = await User.find()
            .sort({ createdAt: -1 })
            .limit(limit)
            .select('name email createdAt')
            .lean();

        const recentOrders = await Order.find()
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('user', 'name email')
            .select('user total createdAt')
            .lean();

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

        activities.sort((a, b) => new Date(b.time) - new Date(a.time));

        res.json(activities.slice(0, limit));

    } catch (error) {
        console.error('❌ Error in /recent-activities:', error);
        res.status(500).json({ error: 'Failed to fetch activities' });
    }
});

// ========== 4. GET /directory ==========
router.get('/directory', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const status = req.query.status || '';
        const role = req.query.role || '';

        let query = {};
        
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        
        if (role) {
            if (role === 'seller') {
                query.isSeller = true;
            } else {
                query.role = role;
            }
        }

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

// ========== 5. POST /bulk-action ==========
router.post('/bulk-action', async (req, res) => {
    try {
        const { action, userIds } = req.body;

        if (!Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ error: 'Invalid userIds array' });
        }

        let result = { modifiedCount: 0 };

        switch (action) {
            case 'activate':
                result = await User.updateMany(
                    { _id: { $in: userIds } },
                    { $set: { role: 'user' } }
                );
                break;
            case 'deactivate':
                result = await User.updateMany(
                    { _id: { $in: userIds } },
                    { $set: { role: 'user' } }
                );
                break;
            case 'delete':
                result = await User.deleteMany({ _id: { $in: userIds } });
                break;
        }

        res.json({
            success: true,
            count: result.deletedCount || result.modifiedCount,
            message: `Đã ${action} ${result.deletedCount || result.modifiedCount} tài khoản`
        });

    } catch (error) {
        console.error('❌ Error in /bulk-action:', error);
        res.status(500).json({ error: 'Failed to perform bulk action' });
    }
});

module.exports = router;
