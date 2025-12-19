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

// 4. GET /categories - Danh sách Categories với products
router.get('/categories', async (req, res) => {
  try {
    console.log('GET /categories called');
    
    const categories = await Product.distinct('category');
    console.log('Found categories:', categories);

    if (!categories || categories.length === 0) {
      console.log('No categories found in database');
      return res.json([]);
    }

    const categoryList = await Promise.all(
      categories.map(async (category) => {
        // Đếm số lượng sản phẩm
        const count = await Product.countDocuments({ category });
        
        // Lấy danh sách sản phẩm (limit 10) - ✅ THÊM _id
        const products = await Product.find({ category })
          .limit(10)
          .select('_id name price imageUrl stock status rating') // ✅ FIX: Thêm _id
          .lean();

        // ✅ FIX: Tính doanh thu thực tế từ Order thay vì price × stock
        let totalValue = 0;
        
        if (products.length > 0) {
          const productIds = products.map(p => p._id);
          
          const revenueStats = await Order.aggregate([
            // Unwind items array để xử lý từng item
            { $unwind: '$items' },
            // Chỉ lấy items có product thuộc category này
            { $match: { 'items.product': { $in: productIds } } },
            // Tính tổng doanh thu
            {
              $group: {
                _id: null,
                totalRevenue: { 
                  $sum: { $multiply: ['$items.price', '$items.quantity'] } 
                }
              }
            }
          ]);

          totalValue = revenueStats[0]?.totalRevenue || 0;
        }

        console.log(`Category: ${category}, count: ${count}, products: ${products.length}, revenue: ${totalValue}`);

        return {
          category,
          count,
          totalValue, // Doanh thu thực từ đơn hàng, không phải price × stock
          products
        };
      })
    );

    console.log('Sending categoryList:', categoryList.length, 'categories');
    res.json(categoryList);
  } catch (error) {
    console.error('Error in /categories:', error);
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

// 6. GET /list - Danh sách Products với FILTER
router.get('/list', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search;
    const category = req.query.category;
    const status = req.query.status;
    const minPrice = parseFloat(req.query.minPrice) || 0;
    const maxPrice = parseFloat(req.query.maxPrice) || Infinity;

    let query = {};

    // ✅ FIX: Search theo tên HOẶC ID - KHÔNG dùng nameNormalized
    if (search) {
      const trimmedSearch = search.trim();
      
      // Kiểm tra xem search có phải là ObjectId hợp lệ không
      const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(trimmedSearch);
      
      if (isValidObjectId) {
        // Nếu là ObjectId, tìm theo _id
        try {
          query._id = trimmedSearch;
        } catch (e) {
          // Nếu ObjectId không valid, bỏ qua
          console.log('Invalid ObjectId:', trimmedSearch);
        }
      } else {
        // ✅ FIX: Search trực tiếp trên field 'name' và 'description' 
        // KHÔNG dùng nameNormalized vì field này có thể không tồn tại
        query.$or = [
          { name: { $regex: trimmedSearch, $options: 'i' } },
          { description: { $regex: trimmedSearch, $options: 'i' } }
        ];
      }
    }

    // ✅ Category filter - giữ nguyên vì backend lưu đúng category name
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

    console.log('Search query:', JSON.stringify(query, null, 2));

    const products = await Product.find(query)
      .populate('sellerId', 'name email')
      .populate('shopId', 'name')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit)
      .select('name price discountPercent imageUrl stock rating category status views ordersCount createdAt')
      .lean();

    const total = await Product.countDocuments(query);

    console.log(`Found ${total} products matching query`);

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
    console.error('Error in /list:', error);
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

// ========== 9. GET /:id - Chi tiết sản phẩm ==========
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Lấy thông tin sản phẩm
        const product = await Product.findById(id)
            .populate('sellerId', 'name email avatar')
            .populate('shopId', 'name avatar address phone')
            .lean();

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Tính giá sau giảm
        const finalPrice = product.price * (1 - product.discountPercent / 100);

        // Lấy số lượng đơn hàng chứa sản phẩm này
        const orderCount = await Order.countDocuments({
            'items.product': product._id
        });

        // Lấy tổng doanh thu từ sản phẩm này
        const revenueStats = await Order.aggregate([
            { $match: { 'items.product': product._id } },
            { $unwind: '$items' },
            { $match: { 'items.product': product._id } },
            {
                $group: {
                    _id: null,
                    totalRevenue: { 
                        $sum: { $multiply: ['$items.price', '$items.quantity'] }
                    },
                    totalQuantitySold: { $sum: '$items.quantity' }
                }
            }
        ]);

        // Format response
        const response = {
            id: product._id,
            name: product.name,
            description: product.description || 'Chưa có mô tả',
            price: product.price,
            discountPercent: product.discountPercent,
            finalPrice: finalPrice,
            imageUrl: product.imageUrl,
            stock: product.stock,
            rating: product.rating,
            category: product.category,
            status: product.status,
            prepTime: product.prepTime,
            views: product.views,
            addToCartCount: product.addToCartCount,
            ordersCount: product.ordersCount,
            createdAt: product.createdAt,
            updatedAt: product.updatedAt,
            seller: product.sellerId ? {
                id: product.sellerId._id,
                name: product.sellerId.name || 'Chưa cập nhật',
                email: product.sellerId.email,
                avatar: product.sellerId.avatar || ''
            } : null,
            shop: product.shopId ? {
                id: product.shopId._id,
                name: product.shopId.name,
                avatar: product.shopId.avatar || '',
                address: product.shopId.address || '',
                phone: product.shopId.phone || ''
            } : null,
            stats: {
                totalOrders: orderCount,
                totalRevenue: revenueStats[0]?.totalRevenue || 0,
                totalQuantitySold: revenueStats[0]?.totalQuantitySold || 0
            },
            comments: product.comments || []
        };

        res.json(response);
    } catch (error) {
        console.error('❌ Error in /:id:', error);
        res.status(500).json({ error: 'Failed to fetch product detail' });
    }
});

// ========== DUYỆT SẢN PHẨM ==========
// 10. GET /pending - Danh sách sản phẩm chờ duyệt
router.get('/pending', async (req, res) => {
  try {
    console.log('[Backend] GET /pending - Fetching pending products');

    const products = await Product.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .select('name price imageUrl category stock rating createdAt')
      .lean();

    console.log(`[Backend] Found ${products.length} pending products`);

    res.json(products);
  } catch (error) {
    console.error('[Backend] Error fetching pending products:', error);
    res.status(500).json({ error: 'Failed to fetch pending products' });
  }
});

// 11. POST /review - Duyệt hoặc không duyệt sản phẩm
router.post('/review', async (req, res) => {
  try {
    const { id, action } = req.body;

    console.log(`[Backend] POST /review - Product: ${id}, Action: ${action}`);

    if (!id) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const newStatus = action === 'approve' ? 'displayed' : 'violated';

    const product = await Product.findByIdAndUpdate(
      id,
      { status: newStatus },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    console.log(`[Backend] Product ${id} updated to: ${newStatus}`);

    res.json({
      success: true,
      status: newStatus,
      message: action === 'approve'
        ? 'Duyệt sản phẩm thành công'
        : 'Không duyệt sản phẩm'
    });
  } catch (error) {
    console.error('[Backend] Error reviewing product:', error);
    res.status(500).json({ error: 'Failed to review product' });
  }
});

module.exports = router;
