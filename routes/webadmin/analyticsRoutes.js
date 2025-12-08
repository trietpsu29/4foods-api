// routes/webadmin/analyticsRoutes.js
const express = require('express');
const router = express.Router();
const Order = require('../../models/Order');
const User = require('../../models/User');
const Shop = require('../../models/Shop');
const Product = require('../../models/Product');

// ============================================================
// BYPASS AUTH MIDDLEWARE (Giống dashboardRoutes.js)
// ============================================================
const bypassAuth = (req, res, next) => next();

// Debug log để kiểm tra file có được load không
console.log('✅ Analytics Routes Module Loaded!');

// ============================================================
// ROUTE 1: TỔNG QUAN (SUMMARY)
// ============================================================
router.get('/summary', bypassAuth, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        // Query song song để tối ưu
        const [
            totalRevenue,
            todayStats,
            yesterdayStats,
            userCount,
            shopCount,
            productCount,
            paymentStats,
            recentOrders
        ] = await Promise.all([
            // Tổng doanh thu toàn thời gian
            Order.aggregate([
                { $match: { status: { $in: ['delivered', 'shipping', 'arrived'] } } },
                { $group: { _id: null, total: { $sum: '$total' } } }
            ]),

            // Thống kê hôm nay
            Order.aggregate([
                { $match: { 
                    createdAt: { $gte: today },
                    status: { $in: ['delivered', 'shipping', 'arrived', 'processing'] }
                }},
                { $group: { 
                    _id: null, 
                    revenue: { $sum: '$total' },
                    orders: { $sum: 1 },
                    customers: { $addToSet: '$user' }
                }}
            ]),

            // Thống kê hôm qua
            Order.aggregate([
                { $match: { 
                    createdAt: { $gte: yesterday, $lt: today },
                    status: { $in: ['delivered', 'shipping', 'arrived', 'processing'] }
                }},
                { $group: { 
                    _id: null, 
                    revenue: { $sum: '$total' }
                }}
            ]),

            // Tổng số users
            User.countDocuments(),

            // Tổng số shops
            Shop.countDocuments(),

            // Tổng số products
            Product.countDocuments(),

            // Thống kê phương thức thanh toán
            Order.aggregate([
                { $match: { status: { $in: ['delivered', 'shipping', 'arrived'] } } },
                { $group: {
                    _id: '$paymentMethod',
                    total: { $sum: '$total' },
                    count: { $sum: 1 }
                }}
            ]),

            // Đơn hàng gần đây
            Order.find()
                .populate('user', 'name email')
                .populate('shop', 'name')
                .sort({ createdAt: -1 })
                .limit(10)
                .lean()
        ]);

        // Xử lý dữ liệu
        const todayRevenue = todayStats[0]?.revenue || 0;
        const todayOrders = todayStats[0]?.orders || 0;
        const todayCustomers = todayStats[0]?.customers?.length || 0;
        const yesterdayRevenue = yesterdayStats[0]?.revenue || 0;

        // Tính tăng trưởng
        const growth = yesterdayRevenue > 0 
            ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100 
            : 0;

        // Format payment breakdown
        const paymentBreakdown = {
            cod: 0,
            momo: 0,
            codCount: 0,
            momoCount: 0
        };

        paymentStats.forEach(stat => {
            if (stat._id === 'cod') {
                paymentBreakdown.cod = stat.total;
                paymentBreakdown.codCount = stat.count;
            } else if (stat._id === 'momo') {
                paymentBreakdown.momo = stat.total;
                paymentBreakdown.momoCount = stat.count;
            }
        });

        res.json({
            totalRevenueAllTime: totalRevenue[0]?.total || 0,
            todayRevenue,
            todayOrders,
            todayCustomers,
            growth: parseFloat(growth.toFixed(2)),
            totalUsers: userCount,
            totalShops: shopCount,
            totalProducts: productCount,
            paymentBreakdown,
            recentOrders
        });

    } catch (error) {
        console.error('❌ Analytics Summary Error:', error);
        res.status(500).json({ 
            error: 'Không thể lấy dữ liệu tổng quan',
            message: error.message 
        });
    }
});

// ============================================================
// ROUTE 2: DOANH THU THEO NGÀY
// ============================================================
router.get('/revenue-daily', bypassAuth, async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const revenueData = await Order.aggregate([
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

        res.json(revenueData);

    } catch (error) {
        console.error('❌ Revenue Daily Error:', error);
        res.status(500).json({ 
            error: 'Không thể lấy dữ liệu doanh thu theo ngày',
            message: error.message 
        });
    }
});

// ============================================================
// ROUTE 3: TOP SHOPS
// ============================================================
router.get('/top-shops', bypassAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const topShops = await Order.aggregate([
            { $match: { status: { $in: ['delivered', 'shipping', 'arrived'] } } },
            {
                $group: {
                    _id: '$shop',
                    revenue: { $sum: '$total' },
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

        res.json(topShops);

    } catch (error) {
        console.error('❌ Top Shops Error:', error);
        res.status(500).json({ 
            error: 'Không thể lấy danh sách shop hàng đầu',
            message: error.message 
        });
    }
});

// ============================================================
// ROUTE 4: TOP PRODUCTS
// ============================================================
router.get('/top-products', bypassAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const topProducts = await Order.aggregate([
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

        res.json(topProducts);

    } catch (error) {
        console.error('❌ Top Products Error:', error);
        res.status(500).json({ 
            error: 'Không thể lấy danh sách sản phẩm hàng đầu',
            message: error.message 
        });
    }
});

// ============================================================
// ROUTE 5: TOP CATEGORIES
// ============================================================
router.get('/top-categories', bypassAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

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
                    revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                    quantity: { $sum: '$items.quantity' }
                }
            },
            { $sort: { revenue: -1 } },
            { $limit: limit },
            {
                $project: {
                    _id: 1,
                    category: { $ifNull: ['$_id', 'Chưa phân loại'] },
                    revenue: 1,
                    quantity: 1
                }
            }
        ]);

        res.json(topCategories);

    } catch (error) {
        console.error('❌ Top Categories Error:', error);
        res.status(500).json({ 
            error: 'Không thể lấy danh sách danh mục hàng đầu',
            message: error.message 
        });
    }
});

// ============================================================
// ROUTE 6: ORDER STATUS BREAKDOWN
// ============================================================
router.get('/order-status', bypassAuth, async (req, res) => {
    try {
        const statusData = await Order.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    revenue: { $sum: '$total' }
                }
            }
        ]);

        // Format với label tiếng Việt
        const statusMap = {
            processing: 'Đang xử lý',
            shipping: 'Đang giao',
            delivered: 'Đã giao',
            arrived: 'Đã đến',
            cancelled: 'Đã hủy',
            refund_pending: 'Chờ hoàn tiền',
            refunded: 'Đã hoàn tiền'
        };

        const formattedData = statusData.map(item => ({
            _id: item._id,
            label: statusMap[item._id] || item._id,
            count: item.count,
            revenue: item.revenue
        }));

        res.json(formattedData);

    } catch (error) {
        console.error('❌ Order Status Error:', error);
        res.status(500).json({ 
            error: 'Không thể lấy thống kê trạng thái đơn hàng',
            message: error.message 
        });
    }
});

// ============================================================
// ROUTE 7: USER GROWTH
// ============================================================
router.get('/user-growth', bypassAuth, async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const userGrowth = await User.aggregate([
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

        res.json(userGrowth);

    } catch (error) {
        console.error('❌ User Growth Error:', error);
        res.status(500).json({ 
            error: 'Không thể lấy dữ liệu tăng trưởng người dùng',
            message: error.message 
        });
    }
});

// ============================================================
// ROUTE 8: REVENUE BY HOUR
// ============================================================
router.get('/revenue-hourly', bypassAuth, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const hourlyData = await Order.aggregate([
            { 
                $match: { 
                    createdAt: { $gte: today },
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

        // Fill missing hours với 0
        const allHours = Array.from({ length: 24 }, (_, i) => {
            const existingData = hourlyData.find(d => d.hour === i);
            return existingData || { hour: i, revenue: 0, orders: 0 };
        });

        res.json(allHours);

    } catch (error) {
        console.error('❌ Revenue Hourly Error:', error);
        res.status(500).json({ 
            error: 'Không thể lấy dữ liệu doanh thu theo giờ',
            message: error.message 
        });
    }
});

// ============================================================
// ROUTE 9: EXPORT DATA (BONUS)
// ============================================================
router.get('/export', bypassAuth, async (req, res) => {
    try {
        const [orders, users, shops, products] = await Promise.all([
            Order.find().populate('user shop').lean(),
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
        console.error('❌ Export Error:', error);
        res.status(500).json({ 
            error: 'Không thể xuất dữ liệu',
            message: error.message 
        });
    }
});

module.exports = router;
