// routes/webadmin/productsRoutes.js
const express = require('express');
const router = express.Router();
const Product = require('../../models/Product');
const Order = require('../../models/Order');

// ========== HELPER FUNCTIONS ==========
const getDateRange = (date) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { start, end };
};

// ========== 1. GET /summary - Tổng quan Products ==========
router.get('/summary', async (req, res) => {
    try {
        // Tổng số sản phẩm
        const totalProducts = await Product.countDocuments();
        
        // Tổng giá trị = tổng (price * stock) của tất cả sản phẩm
        const productsWithValue = await Product.aggregate([
            {
                $project: {
                    value: { $multiply: ['$price', '$stock'] }
                }
            },
            {
                $group: {
                    _id: null,
                    totalValue: { $sum: '$value' }
                }
            }
        ]);
        
        const totalValue = productsWithValue[0]?.totalValue || 0;

        // Thống kê theo status
        const byStatus = await Product.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);

        const statusStats = {};
        byStatus.forEach(item => {
            statusStats[item._id] = item.count;
        });

        res.json({
            totalProducts,
            totalValue,
            statusStats: {
                pending: statusStats.pending || 0,
                displayed: statusStats.displayed || 0,
                hidden: statusStats.hidden || 0,
                violated: statusStats.violated || 0
            }
        });

    } catch (error) {
        console.error('❌ Error in /summary:', error);
        res.status(500).json({ error: 'Failed to fetch products summary' });
    }
});

// ========== 2. GET /category-sales - Biểu đồ đường doanh thu theo category ==========
router.get('/category-sales', async (req, res) => {
    try {
        const { period = '7days' } = req.query;
        
        let days = period === '1month' ? 30 : period === '1year' ? 365 : 7;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Lấy doanh thu từ Orders, populate products
        const orders = await Order.find({
            createdAt: { $gte: startDate }
        })
        .populate({
            path: 'items.product',
            select: 'category price'
        })
        .select('items createdAt')
        .lean();

        // Nhóm theo category và tính tổng
        const categoryData = {};
        
        orders.forEach(order => {
            order.items?.forEach(item => {
                if (item.product && item.product.category) {
                    const category = item.product.category;
                    const value = (item.product.price || 0) * (item.quantity || 0);
                    
                    if (!categoryData[category]) {
                        categoryData[category] = 0;
                    }
                    categoryData[category] += value;
                }
            });
        });

        // Format response
        const result = Object.keys(categoryData).map(category => ({
            category,
            value: categoryData[category]
        }));

        res.json(result);

    } catch (error) {
        console.error('❌ Error in /category-sales:', error);
        res.status(500).json({ error: 'Failed to fetch category sales' });
    }
});

// ========== 3. GET /categories - Danh sách Categories với products ==========
router.get('/categories', async (req, res) => {
    try {
        // Lấy tất cả categories unique
        const categories = await Product.distinct('category');
        
        const categoryList = await Promise.all(
            categories.map(async (category) => {
                // Đếm số sản phẩm trong category
                const count = await Product.countDocuments({ category });
                
                // Lấy 5 sản phẩm mẫu
                const products = await Product.find({ category })
                    .limit(5)
                    .select('name price imageUrl stock status')
                    .lean();
                
                // Tính tổng giá trị
                const categoryValue = await Product.aggregate([
                    { $match: { category } },
                    {
                        $project: {
                            value: { $multiply: ['$price', '$stock'] }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            totalValue: { $sum: '$value' }
                        }
                    }
                ]);
                
                return {
                    category,
                    count,
                    totalValue: categoryValue[0]?.totalValue || 0,
                    products
                };
            })
        );

        res.json(categoryList);

    } catch (error) {
        console.error('❌ Error in /categories:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

// ========== 4. GET /category-distribution - Phân bố Category (Pie Chart) ==========
router.get('/category-distribution', async (req, res) => {
    try {
        const distribution = await Product.aggregate([
            {
                $group: {
                    _id: '$category',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]);

        res.json(distribution.map(item => ({
            category: item._id,
            count: item.count
        })));

    } catch (error) {
        console.error('❌ Error in /category-distribution:', error);
        res.status(500).json({ error: 'Failed to fetch category distribution' });
    }
});

// ========== 5. GET /list - Danh sách Products với FILTER ==========
router.get('/list', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const category = req.query.category || '';
        const status = req.query.status || '';
        const minPrice = parseFloat(req.query.minPrice) || 0;
        const maxPrice = parseFloat(req.query.maxPrice) || Infinity;

        // Build query
        let query = {};
        
        // Search
        if (search) {
            query.$or = [
                { nameNormalized: { $regex: search, $options: 'i' } },
                { descriptionNormalized: { $regex: search, $options: 'i' } }
            ];
        }
        
        // Category filter
        if (category) {
            query.category = category;
        }

        // Status filter
        if (status && ['pending', 'displayed', 'hidden', 'violated'].includes(status)) {
            query.status = status;
        }

        // Price range
        if (minPrice > 0 || maxPrice < Infinity) {
            query.price = {};
            if (minPrice > 0) query.price.$gte = minPrice;
            if (maxPrice < Infinity) query.price.$lte = maxPrice;
        }

        // Fetch products
        const products = await Product.find(query)
            .populate('sellerId', 'name email')
            .populate('shopId', 'name')
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit)
            .select('name price discountPercent imageUrl stock rating category status views ordersCount createdAt')
            .lean();

        const total = await Product.countDocuments(query);

        res.json({
            products,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error in /list:', error);
        res.status(500).json({ error: 'Failed to fetch products list' });
    }
});

// ========== 6. POST /bulk-action - Bulk actions ==========
router.post('/bulk-action', async (req, res) => {
    try {
        const { action, productIds } = req.body;

        if (!Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({ error: 'Invalid productIds array' });
        }

        let result = { modifiedCount: 0, deletedCount: 0 };

        switch (action) {
            case 'display':
                result = await Product.updateMany(
                    { _id: { $in: productIds } },
                    { $set: { status: 'displayed' } }
                );
                break;
                
            case 'hide':
                result = await Product.updateMany(
                    { _id: { $in: productIds } },
                    { $set: { status: 'hidden' } }
                );
                break;
                
            case 'delete':
                result = await Product.deleteMany({ _id: { $in: productIds } });
                break;
                
            default:
                return res.status(400).json({ error: 'Invalid action' });
        }

        res.json({
            success: true,
            count: result.deletedCount || result.modifiedCount,
            message: `Đã ${action} ${result.deletedCount || result.modifiedCount} sản phẩm`
        });

    } catch (error) {
        console.error('❌ Error in /bulk-action:', error);
        res.status(500).json({ error: 'Failed to perform bulk action' });
    }
});

// ========== 7. DELETE /:id - Xóa 1 product ==========
router.delete('/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const result = await Product.findByIdAndDelete(productId);
        
        if (!result) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.json({ success: true, message: 'Đã xóa sản phẩm' });

    } catch (error) {
        console.error('❌ Error deleting product:', error);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

module.exports = router;
