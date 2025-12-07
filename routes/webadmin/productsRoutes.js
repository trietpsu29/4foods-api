// routes/webadmin/productsRoutes.js
const express = require('express');
const router = express.Router();
const Product = require('../../models/Product');

// Mock data cho demo (sẽ thay bằng MongoDB sau)
let products = [
  {
    id: 1,
    name: 'iPhone 14 Pro',
    sku: 'IPHONE14-PRO-128',
    category: 'electronics',
    price: 999.99,
    stock: 45,
    status: 'published',
    created: '2024-01-15',
    image: '/assets/images/product-placeholder.svg',
    description: 'Latest iPhone with advanced camera system'
  },
  // ... các sản phẩm khác từ dữ liệu mẫu trong frontend
];

// Lấy tất cả sản phẩm với phân trang và filter
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, category, status, search, sortBy = 'created', sortOrder = 'desc' } = req.query;
    
    let filteredProducts = [...products];
    
    // Lọc theo search
    if (search) {
      filteredProducts = filteredProducts.filter(p => 
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase())
      );
    }
    
    // Lọc theo category
    if (category) {
      filteredProducts = filteredProducts.filter(p => p.category === category);
    }
    
    // Lọc theo status
    if (status) {
      filteredProducts = filteredProducts.filter(p => p.status === status);
    }
    
    // Sắp xếp
    filteredProducts.sort((a, b) => {
      if (sortOrder === 'asc') {
        return a[sortBy] > b[sortBy] ? 1 : -1;
      }
      return a[sortBy] < b[sortBy] ? 1 : -1;
    });
    
    // Phân trang
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedProducts = filteredProducts.slice(startIndex, endIndex);
    
    // Thống kê
    const stats = {
      total: filteredProducts.length,
      inStock: filteredProducts.filter(p => p.stock > 20).length,
      lowStock: filteredProducts.filter(p => p.stock > 0 && p.stock <= 20).length,
      outOfStock: filteredProducts.filter(p => p.stock === 0).length,
      totalValue: filteredProducts.reduce((sum, p) => sum + (p.price * p.stock), 0)
    };
    
    res.json({
      success: true,
      data: paginatedProducts,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(filteredProducts.length / limit),
        totalItems: filteredProducts.length,
        hasNext: endIndex < filteredProducts.length,
        hasPrev: startIndex > 0
      },
      stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Lấy sản phẩm theo ID
router.get('/:id', async (req, res) => {
  try {
    const product = products.find(p => p.id === parseInt(req.params.id));
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Tạo sản phẩm mới
router.post('/', async (req, res) => {
  try {
    const { name, sku, category, price, stock, description, status } = req.body;
    
    // Validate required fields
    if (!name || !sku || !category || !price || !stock) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }
    
    // Check if SKU already exists
    const existingProduct = products.find(p => p.sku === sku);
    if (existingProduct) {
      return res.status(400).json({
        success: false,
        message: 'SKU already exists'
      });
    }
    
    const newProduct = {
      id: products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1,
      name,
      sku,
      category,
      price: parseFloat(price),
      stock: parseInt(stock),
      description,
      status: status || 'draft',
      image: '/assets/images/product-placeholder.svg',
      created: new Date().toISOString().split('T')[0]
    };
    
    products.push(newProduct);
    
    res.status(201).json({
      success: true,
      data: newProduct
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Cập nhật sản phẩm
router.put('/:id', async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const updates = req.body;
    
    const index = products.findIndex(p => p.id === productId);
    
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    // Check if SKU is being changed to one that already exists
    if (updates.sku && updates.sku !== products[index].sku) {
      const existingProduct = products.find(p => p.sku === updates.sku);
      if (existingProduct) {
        return res.status(400).json({
          success: false,
          message: 'SKU already exists'
        });
      }
    }
    
    // Update product
    products[index] = {
      ...products[index],
      ...updates,
      id: productId // Ensure ID doesn't change
    };
    
    res.json({
      success: true,
      data: products[index]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Xóa sản phẩm
router.delete('/:id', async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const index = products.findIndex(p => p.id === productId);
    
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    const deletedProduct = products.splice(index, 1)[0];
    
    res.json({
      success: true,
      data: deletedProduct,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Xóa nhiều sản phẩm
router.delete('/', async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Product IDs array is required'
      });
    }
    
    const deletedProducts = [];
    const remainingProducts = products.filter(p => {
      if (ids.includes(p.id)) {
        deletedProducts.push(p);
        return false;
      }
      return true;
    });
    
    products = remainingProducts;
    
    res.json({
      success: true,
      data: deletedProducts,
      message: `${deletedProducts.length} products deleted successfully`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Lấy thống kê
router.get('/stats/summary', async (req, res) => {
  try {
    const stats = {
      total: products.length,
      inStock: products.filter(p => p.stock > 20).length,
      lowStock: products.filter(p => p.stock > 0 && p.stock <= 20).length,
      outOfStock: products.filter(p => p.stock === 0).length,
      totalValue: products.reduce((sum, p) => sum + (p.price * p.stock), 0),
      categories: {},
      statuses: {}
    };
    
    // Thống kê theo category
    products.forEach(p => {
      stats.categories[p.category] = (stats.categories[p.category] || 0) + 1;
    });
    
    // Thống kê theo status
    products.forEach(p => {
      stats.statuses[p.status] = (stats.statuses[p.status] || 0) + 1;
    });
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;