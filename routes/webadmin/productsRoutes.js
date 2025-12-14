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
        const totalProducts = await Product.countDocuments();
        
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

        const byStatus = await Product.aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } }
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

// ========== 2. GET /category-sales-timeline - Biểu đồ đường nhiều category (7 ngày) ==========
router.get('/category-sales-timeline', async (req, res) => {
    try {
        const days = 7;
        const dates = [];
        
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            dates.push({
                date: date.toISOString().split('T')[0],
                label: date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
                start: new Date(date.setHours(0, 0, 0, 0)),
                end: new Date(date.setHours(23, 59, 59, 999))
            });
        }

        const startDate = dates[0].start;
        const endDate = dates[dates.length - 1].end;

        const orders = await Order.find({
            createdAt: { $gte: startDate, $lte: endDate }
        })
        .populate({
            path: 'items.product',
            select: 'category price'
        })
        .select('items createdAt')
        .lean();

        const categoryData = {};

        orders.forEach(order => {
            const orderDate = new Date(order.createdAt).toISOString().split('T')[0];
            
            order.items?.forEach(item => {
                if (item.product && item.product.category) {
                    const category = item.product.category;
                    const value = (item.product.price || 0) * (item.quantity || 0);
                    
                    if (!categoryData[category]) {
                        categoryData[category] = {};
                        dates.forEach(d => {
                            categoryData[category][d.date] = 0;
                        });
                    }
                    
                    if (categoryData[category][orderDate] !== undefined) {
                        categoryData[category][orderDate] += value;
                    }
                }
            });
        });

        const series = Object.keys(categoryData).map(category => ({
            name: category,
            data: dates.map(d => categoryData[category][d.date])
        }));

        const labels = dates.map(d => d.label);

        res.json({
            series,
            labels
        });

    } catch (error) {
        console.error('❌ Error in /category-sales-timeline:', error);
        res.status(500).json({ error: 'Failed to fetch category sales timeline' });
    }
});

// ========== 3. GET /top-selling - Top 5 sản phẩm bán chạy ==========
router.get('/top-selling', async (req, res) => {
    try {
        const topProducts = await Product.find()
            .sort({ ordersCount: -1 })
            .limit(5)
            .select('name price imageUrl ordersCount category rating')
            .lean();

        res.json(topProducts);

    } catch (error) {
        console.error('❌ Error in /top-selling:', error);
        res.status(500).json({ error: 'Failed to fetch top selling products' });
    }
});

// ========== 4. GET /categories - Danh sách Categories với products ==========
router.get('/categories', async (req, res) => {
    try {
        console.log('📊 GET /categories called');
        
        const categories = await Product.distinct('category');
        console.log('✅ Found categories:', categories);
        
        if (!categories || categories.length === 0) {
            console.log('⚠️ No categories found in database');
            return res.json([]);
        }
        
        const categoryList = await Promise.all(
            categories.map(async (category) => {
                const count = await Product.countDocuments({ category });
                
                const products = await Product.find({ category })
                    .limit(10)
                    .select('name price imageUrl stock status rating')
                    .lean();
                
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
                
                console.log(`📦 Category "${category}": ${count} products, value: ${categoryValue[0]?.totalValue || 0}`);
                
                return {
                    category,
                    count,
                    totalValue: categoryValue[0]?.totalValue || 0,
                    products
                };
            })
        );

        console.log('✅ Sending categoryList:', categoryList.length, 'categories');
        res.json(categoryList);

    } catch (error) {
        console.error('❌ Error in /categories:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

// ========== 5. GET /category-distribution - Phân bố Category (Pie Chart) ==========
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

// ========== 6. GET /list - Danh sách Products với FILTER ==========
router.get('/list', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const category = req.query.category || '';
        const status = req.query.status || '';
        const minPrice = parseFloat(req.query.minPrice) || 0;
        const maxPrice = parseFloat(req.query.maxPrice) || Infinity;

        let query = {};
        
        if (search) {
            query.$or = [
                { nameNormalized: { $regex: search, $options: 'i' } },
                { descriptionNormalized: { $regex: search, $options: 'i' } }
            ];
        }
        
        if (category) {
            query.category = category;
        }

        if (status && ['pending', 'displayed', 'hidden', 'violated'].includes(status)) {
            query.status = status;
        }

        if (minPrice > 0 || maxPrice < Infinity) {
            query.price = {};
            if (minPrice > 0) query.price.$gte = minPrice;
            if (maxPrice < Infinity) query.price.$lte = maxPrice;
        }

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

// ========== 7. POST /bulk-action - Bulk actions ==========
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

// ========== 8. DELETE /:id - Xóa 1 product ==========
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
