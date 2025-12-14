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
        
        // Active users (đăng nhập trong 30 ngày qua)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const activeUsers = await User.countDocuments({
            updatedAt: { $gte: thirtyDaysAgo }
        });

        // User vs Seller distribution
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
            // Theo THÁNG (12 tháng)
            for (let i = 11; i >= 0; i--) {
                const date = new Date();
                date.setMonth(date.getMonth() - i);
                
                const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
                const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
                
                const count = await User.countDocuments({
                    createdAt: { $gte: startOfMonth, $lte: endOfMonth }
                });

                result.push({
                    label: date.toLocaleDateString('vi-VN', { month: 'short', year: 'numeric' }),
                    count
                });
            }
        } else {
            // Theo NGÀY
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
        const activities = [];

        // Lấy users mới
        const newUsers = await User.find()
            .sort({ createdAt: -1 })
            .limit(limit)
            .select('name email createdAt isSeller')
            .lean();

        newUsers.forEach(user => {
            activities.push({
                type: 'new_user',
                user: user.name || user.email,
                action: user.isSeller ? 'đã đăng ký làm Seller' : 'đã tạo tài khoản mới',
                icon: user.isSeller ? 'shop' : 'person-plus-fill',
                iconColor: user.isSeller ? 'warning' : 'success',
                time: user.createdAt,
                details: `Email: ${user.email}`
            });
        });

        // Lấy orders mới
        const recentOrders = await Order.find()
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('user', 'name email')
            .select('user total createdAt')
            .lean();

        recentOrders.forEach(order => {
            activities.push({
                type: 'new_order',
                user: order.user?.name || order.user?.email || 'Khách lẻ',
                action: 'đã đặt hàng',
                icon: 'cart-check-fill',
                iconColor: 'primary',
                time: order.createdAt,
                details: `Giá trị: ${order.total?.toLocaleString('vi-VN') || '0'}đ`
            });
        });

        // Sắp xếp theo thời gian
        activities.sort((a, b) => new Date(b.time) - new Date(a.time));

        res.json(activities.slice(0, limit));

    } catch (error) {
        console.error('❌ Error in /recent-activities:', error);
        res.json([]); // Trả về array rỗng thay vì error
    }
});

// ========== 4. GET /directory - Danh sách Users với FILTER ==========
router.get('/directory', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const role = req.query.role || ''; // 'admin' | 'user'
        const accountType = req.query.accountType || ''; // 'seller' | 'buyer'
        const loginMethod = req.query.loginMethod || ''; // 'local' | 'google' | 'facebook'

        // Build query
        let query = {};
        
        // Search filter (name, email, phone)
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }
        
        // Role filter
        if (role && ['admin', 'user'].includes(role)) {
            query.role = role;
        }

        // Account Type filter
        if (accountType === 'seller') {
            query.isSeller = true;
        } else if (accountType === 'buyer') {
            query.isSeller = false;
        }

        // Login Method filter
        if (loginMethod && ['local', 'google', 'facebook'].includes(loginMethod)) {
            query.loginMethod = loginMethod;
        }

        // Fetch users
        const users = await User.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit)
            .select('name email role isSeller avatar phone loginMethod createdAt updatedAt')
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

        let result = { modifiedCount: 0, deletedCount: 0 };

        switch (action) {
            case 'activate':
                // Set role to 'user' (active)
                result = await User.updateMany(
                    { _id: { $in: userIds } },
                    { $set: { role: 'user' } }
                );
                break;
                
            case 'deactivate':
                // Keep as 'user' but you could add a 'status' field
                result = await User.updateMany(
                    { _id: { $in: userIds } },
                    { $set: { role: 'user' } }
                );
                break;
                
            case 'delete':
                result = await User.deleteMany({ _id: { $in: userIds } });
                break;
                
            default:
                return res.status(400).json({ error: 'Invalid action' });
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

// ========== 6. GET /stats - Thống kê chi tiết ==========
router.get('/stats', async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const admins = await User.countDocuments({ role: 'admin' });
        const regularUsers = await User.countDocuments({ role: 'user' });
        const sellers = await User.countDocuments({ isSeller: true });
        const buyers = await User.countDocuments({ isSeller: false });
        
        // Login method stats
        const localUsers = await User.countDocuments({ loginMethod: 'local' });
        const googleUsers = await User.countDocuments({ loginMethod: 'google' });
        const facebookUsers = await User.countDocuments({ loginMethod: 'facebook' });

        res.json({
            total: totalUsers,
            byRole: {
                admin: admins,
                user: regularUsers
            },
            byAccountType: {
                seller: sellers,
                buyer: buyers
            },
            byLoginMethod: {
                local: localUsers,
                google: googleUsers,
                facebook: facebookUsers
            }
        });

    } catch (error) {
        console.error('❌ Error in /stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ========== 7. GET /:id - Chi tiết người dùng ==========
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Lấy thông tin user
    const user = await User.findById(id)
      .populate('shop', 'name avatar')
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Lấy thống kê đơn hàng
    const orderStats = await Order.aggregate([
      { $match: { user: mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$total' }
        }
      }
    ]);

    // Format response
    const response = {
      id: user._id,
      name: user.name || 'Chưa cập nhật',
      email: user.email,
      phone: user.phone || '',
      avatar: user.avatar || '',
      role: user.role === 'admin' ? 'Admin' : 'User',
      accountType: user.isSeller ? 'Seller' : 'Buyer',
      loginMethod: user.loginMethod === 'local' ? 'Email' : 
                   user.loginMethod === 'google' ? 'Google' : 'Facebook',
      status: 'active', // Có thể customize dựa vào logic của bạn
      createdAt: user.createdAt,
      lastActive: user.updatedAt,
      stats: {
        totalOrders: orderStats[0]?.totalOrders || 0,
        totalSpent: orderStats[0]?.totalSpent || 0,
        addressCount: user.addresses?.length || 0
      },
      shop: user.isSeller ? user.shop : null,
      addresses: user.addresses || [],
      coin: user.coin || 0,
      dob: user.dob || null,
      idCardNumber: user.idCardNumber || ''
    };

    res.json(response);
  } catch (error) {
    console.error('❌ Error in /:id:', error);
    res.status(500).json({ error: 'Failed to fetch user detail' });
  }
});

module.exports = router;
