const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const { body, validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');

// Configure multer for file uploads
const upload = multer({
    dest: 'uploads/',
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
        files: 1
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Chỉ chấp nhận file CSV'), false);
        }
    }
});

// Mock database (replace with real database in production)
let users = [];
let userIdCounter = 1;

// Initialize with sample data
function initializeSampleData() {
    users = [
        {
            id: 1,
            firstName: 'Nguyễn',
            lastName: 'Văn A',
            name: 'Nguyễn Văn A',
            email: 'admin@example.com',
            password: '$2b$10$hashedpassword', // In real app, use bcrypt
            role: 'admin',
            status: 'active',
            phone: '+84 123 456 789',
            avatar: '/assets/images/avatar-placeholder.svg',
            department: 'Engineering',
            lastLogin: new Date(Date.now() - 2 * 60000).toISOString(),
            createdAt: new Date('2023-01-15').toISOString(),
            updatedAt: new Date().toISOString()
        },
        {
            id: 2,
            firstName: 'Trần',
            lastName: 'Thị B',
            name: 'Trần Thị B',
            email: 'user@example.com',
            password: '$2b$10$hashedpassword',
            role: 'user',
            status: 'active',
            phone: '+84 987 654 321',
            avatar: '/assets/images/avatar-placeholder.svg',
            department: 'Marketing',
            lastLogin: new Date(Date.now() - 60 * 60000).toISOString(),
            createdAt: new Date('2023-02-20').toISOString(),
            updatedAt: new Date().toISOString()
        }
    ];
    userIdCounter = users.length + 1;
}

initializeSampleData();

// ==========================================================================
// Validation Middlewares
// ==========================================================================

const validateUser = [
    body('firstName').trim().notEmpty().withMessage('Tên là bắt buộc'),
    body('lastName').trim().notEmpty().withMessage('Họ là bắt buộc'),
    body('email').isEmail().withMessage('Email không hợp lệ'),
    body('role').isIn(['admin', 'user', 'moderator', 'seller', 'customer']).withMessage('Vai trò không hợp lệ'),
    body('status').isIn(['active', 'inactive', 'pending', 'banned', 'suspended']).withMessage('Trạng thái không hợp lệ'),
    body('phone').optional().isMobilePhone().withMessage('Số điện thoại không hợp lệ')
];

const validateBulkAction = [
    body('action').isIn(['activate', 'deactivate', 'delete']).withMessage('Hành động không hợp lệ'),
    body('userIds').isArray().withMessage('userIds phải là mảng')
];

// ==========================================================================
// API Routes
// ==========================================================================

/**
 * GET /api/users
 * Get users with pagination, filtering, and sorting
 */
router.get('/', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = '',
            role = '',
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;
        
        // Filter users
        let filteredUsers = [...users];
        
        // Search filter
        if (search) {
            const searchLower = search.toLowerCase();
            filteredUsers = filteredUsers.filter(user =>
                user.name.toLowerCase().includes(searchLower) ||
                user.email.toLowerCase().includes(searchLower) ||
                (user.phone && user.phone.toLowerCase().includes(searchLower))
            );
        }
        
        // Status filter
        if (status) {
            filteredUsers = filteredUsers.filter(user => user.status === status);
        }
        
        // Role filter
        if (role) {
            filteredUsers = filteredUsers.filter(user => user.role === role);
        }
        
        // Sorting
        filteredUsers.sort((a, b) => {
            if (sortOrder === 'asc') {
                return a[sortBy] > b[sortBy] ? 1 : -1;
            } else {
                return a[sortBy] < b[sortBy] ? 1 : -1;
            }
        });
        
        // Pagination
        const pageInt = parseInt(page);
        const limitInt = parseInt(limit);
        const startIndex = (pageInt - 1) * limitInt;
        const endIndex = pageInt * limitInt;
        
        const paginatedUsers = filteredUsers.slice(startIndex, endIndex);
        
        // Remove sensitive data
        const safeUsers = paginatedUsers.map(user => {
            const { password, ...safeUser } = user;
            return safeUser;
        });
        
        res.json({
            success: true,
            data: safeUsers,
            total: filteredUsers.length,
            page: pageInt,
            limit: limitInt,
            pages: Math.ceil(filteredUsers.length / limitInt)
        });
        
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi tải danh sách người dùng'
        });
    }
});

/**
 * GET /api/users/search
 * Advanced search for users
 */
router.get('/search', async (req, res) => {
    try {
        const filters = req.query;
        let filteredUsers = [...users];
        
        // Apply all filters
        Object.keys(filters).forEach(key => {
            if (key === 'search' && filters[key]) {
                const searchTerm = filters[key].toLowerCase();
                filteredUsers = filteredUsers.filter(user =>
                    user.name.toLowerCase().includes(searchTerm) ||
                    user.email.toLowerCase().includes(searchTerm)
                );
            } else if (filters[key]) {
                filteredUsers = filteredUsers.filter(user => user[key] === filters[key]);
            }
        });
        
        // Remove sensitive data
        const safeUsers = filteredUsers.map(user => {
            const { password, ...safeUser } = user;
            return safeUser;
        });
        
        res.json({
            success: true,
            data: safeUsers,
            total: filteredUsers.length
        });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi tìm kiếm'
        });
    }
});

/**
 * GET /api/users/:id
 * Get user by ID
 */
router.get('/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const user = users.find(u => u.id === userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }
        
        // Remove sensitive data
        const { password, ...safeUser } = user;
        
        res.json({
            success: true,
            data: safeUser
        });
        
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi tải thông tin người dùng'
        });
    }
});

/**
 * POST /api/users
 * Create new user
 */
router.post('/', validateUser, async (req, res) => {
    try {
        // Validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }
        
        const { firstName, lastName, email, role, status, phone } = req.body;
        
        // Check if email already exists
        const existingUser = users.find(u => u.email === email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Email đã tồn tại'
            });
        }
        
        // Create new user
        const newUser = {
            id: userIdCounter++,
            firstName,
            lastName,
            name: `${firstName} ${lastName}`,
            email,
            role,
            status,
            phone: phone || '',
            avatar: '/assets/images/avatar-placeholder.svg',
            department: 'New',
            lastLogin: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        users.push(newUser);
        
        // Remove sensitive data before sending response
        const { password, ...safeUser } = newUser;
        
        res.status(201).json({
            success: true,
            message: 'Tạo người dùng thành công',
            data: safeUser
        });
        
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi tạo người dùng'
        });
    }
});

/**
 * PUT /api/users/:id
 * Update user
 */
router.put('/:id', validateUser, async (req, res) => {
    try {
        // Validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }
        
        const userId = parseInt(req.params.id);
        const { firstName, lastName, email, role, status, phone } = req.body;
        
        // Find user
        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }
        
        // Check if email is already used by another user
        const existingUser = users.find(u => u.email === email && u.id !== userId);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Email đã được sử dụng bởi người dùng khác'
            });
        }
        
        // Update user
        users[userIndex] = {
            ...users[userIndex],
            firstName,
            lastName,
            name: `${firstName} ${lastName}`,
            email,
            role,
            status,
            phone: phone || '',
            updatedAt: new Date().toISOString()
        };
        
        // Remove sensitive data before sending response
        const { password, ...safeUser } = users[userIndex];
        
        res.json({
            success: true,
            message: 'Cập nhật người dùng thành công',
            data: safeUser
        });
        
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi cập nhật người dùng'
        });
    }
});

/**
 * DELETE /api/users/:id
 * Delete user
 */
router.delete('/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const userIndex = users.findIndex(u => u.id === userId);
        
        if (userIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }
        
        // Remove user
        users.splice(userIndex, 1);
        
        res.json({
            success: true,
            message: 'Xóa người dùng thành công'
        });
        
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi xóa người dùng'
        });
    }
});

/**
 * POST /api/users/bulk-action
 * Perform bulk actions (activate, deactivate, delete)
 */
router.post('/bulk-action', validateBulkAction, async (req, res) => {
    try {
        // Validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }
        
        const { action, userIds } = req.body;
        let updatedCount = 0;
        
        switch (action) {
            case 'activate':
                userIds.forEach(userId => {
                    const user = users.find(u => u.id === userId);
                    if (user) {
                        user.status = 'active';
                        user.updatedAt = new Date().toISOString();
                        updatedCount++;
                    }
                });
                break;
                
            case 'deactivate':
                userIds.forEach(userId => {
                    const user = users.find(u => u.id === userId);
                    if (user) {
                        user.status = 'inactive';
                        user.updatedAt = new Date().toISOString();
                        updatedCount++;
                    }
                });
                break;
                
            case 'delete':
                users = users.filter(user => !userIds.includes(user.id));
                updatedCount = userIds.length;
                break;
        }
        
        res.json({
            success: true,
            message: `Đã ${action} ${updatedCount} người dùng`,
            count: updatedCount
        });
        
    } catch (error) {
        console.error('Bulk action error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi thực hiện hành động hàng loạt'
        });
    }
});

/**
 * GET /api/users/stats
 * Get user statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const totalUsers = users.length;
        const activeUsers = users.filter(u => u.status === 'active').length;
        const inactiveUsers = users.filter(u => u.status === 'inactive').length;
        const pendingUsers = users.filter(u => u.status === 'pending').length;
        const bannedUsers = users.filter(u => u.status === 'banned').length;
        
        // Role distribution
        const roleDistribution = users.reduce((acc, user) => {
            acc[user.role] = (acc[user.role] || 0) + 1;
            return acc;
        }, {});
        
        // Department distribution
        const departmentDistribution = users.reduce((acc, user) => {
            acc[user.department] = (acc[user.department] || 0) + 1;
            return acc;
        }, {});
        
        // Monthly growth (mock data)
        const monthlyGrowth = [
            { month: 'Jan', count: 5 },
            { month: 'Feb', count: 8 },
            { month: 'Mar', count: 12 },
            { month: 'Apr', count: 15 },
            { month: 'May', count: 10 },
            { month: 'Jun', count: 18 }
        ];
        
        res.json({
            success: true,
            data: {
                totalUsers,
                activeUsers,
                inactiveUsers,
                pendingUsers,
                bannedUsers,
                roleDistribution,
                departmentDistribution,
                monthlyGrowth,
                activePercentage: totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0,
                growthRate: 12.5 // Mock data
            }
        });
        
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi tải thống kê'
        });
    }
});

/**
 * GET /api/users/activities
 * Get recent user activities
 */
router.get('/activities', async (req, res) => {
    try {
        const activities = [
            {
                id: 1,
                user: 'Nguyễn Văn A',
                action: 'đã đăng nhập',
                type: 'login',
                icon: 'box-arrow-in-right',
                details: 'Đăng nhập từ Chrome trên Windows',
                time: '2 phút trước',
                createdAt: new Date(Date.now() - 2 * 60000).toISOString()
            },
            {
                id: 2,
                user: 'Trần Thị B',
                action: 'đã cập nhật hồ sơ',
                type: 'update',
                icon: 'person-gear',
                details: 'Cập nhật thông tin liên hệ',
                time: '1 giờ trước',
                createdAt: new Date(Date.now() - 60 * 60000).toISOString()
            },
            {
                id: 3,
                user: 'Nguyễn Văn A',
                action: 'đã tạo người dùng mới',
                type: 'create',
                icon: 'person-plus',
                details: 'Tạo người dùng: Lê Văn C',
                time: '3 giờ trước',
                createdAt: new Date(Date.now() - 180 * 60000).toISOString()
            },
            {
                id: 4,
                user: 'Hệ thống',
                action: 'đã gửi email xác nhận',
                type: 'system',
                icon: 'envelope',
                details: 'Gửi email xác nhận cho người dùng mới',
                time: '5 giờ trước',
                createdAt: new Date(Date.now() - 300 * 60000).toISOString()
            },
            {
                id: 5,
                user: 'Trần Thị B',
                action: 'đã đăng xuất',
                type: 'logout',
                icon: 'box-arrow-right',
                details: 'Đăng xuất khỏi tất cả thiết bị',
                time: '1 ngày trước',
                createdAt: new Date(Date.now() - 1440 * 60000).toISOString()
            }
        ];
        
        res.json({
            success: true,
            data: activities
        });
        
    } catch (error) {
        console.error('Activities error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi tải hoạt động'
        });
    }
});

/**
 * POST /api/users/import
 * Import users from CSV
 */
router.post('/import', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng tải lên file CSV'
            });
        }
        
        const filePath = req.file.path;
        const importedUsers = [];
        
        // Read and parse CSV file
        const results = await new Promise((resolve, reject) => {
            const results = [];
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (data) => results.push(data))
                .on('end', () => resolve(results))
                .on('error', reject);
        });
        
        // Process each row
        for (const row of results) {
            try {
                const { name, email, role, status, phone } = row;
                
                // Validate required fields
                if (!name || !email || !role) {
                    continue;
                }
                
                // Check if email already exists
                const existingUser = users.find(u => u.email === email);
                if (existingUser) {
                    continue;
                }
                
                // Parse name
                const nameParts = name.split(' ');
                const firstName = nameParts[0] || '';
                const lastName = nameParts.slice(1).join(' ') || '';
                
                // Create new user
                const newUser = {
                    id: userIdCounter++,
                    firstName,
                    lastName,
                    name,
                    email,
                    role,
                    status: status || 'active',
                    phone: phone || '',
                    avatar: '/assets/images/avatar-placeholder.svg',
                    department: 'Imported',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                
                users.push(newUser);
                importedUsers.push(newUser);
                
            } catch (rowError) {
                console.error('Error processing row:', rowError);
            }
        }
        
        // Clean up uploaded file
        fs.unlinkSync(filePath);
        
        res.json({
            success: true,
            message: `Đã import ${importedUsers.length} người dùng`,
            count: importedUsers.length,
            data: importedUsers
        });
        
    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi import người dùng'
        });
    }
});

/**
 * GET /api/users/export
 * Export users to CSV
 */
router.get('/export', async (req, res) => {
    try {
        const { format = 'csv' } = req.query;
        
        if (format !== 'csv') {
            return res.status(400).json({
                success: false,
                message: 'Chỉ hỗ trợ định dạng CSV'
            });
        }
        
        // Prepare CSV content
        const headers = ['ID', 'Tên', 'Email', 'Vai trò', 'Trạng thái', 'Số điện thoại', 'Phòng ban', 'Ngày tạo'];
        const rows = users.map(user => [
            user.id,
            user.name,
            user.email,
            user.role,
            user.status,
            user.phone,
            user.department,
            new Date(user.createdAt).toLocaleDateString('vi-VN')
        ]);
        
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(field => `"${field}"`).join(','))
        ].join('\n');
        
        // Set response headers for file download
        const filename = `users-export-${new Date().toISOString().split('T')[0]}.csv`;
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvContent);
        
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi xuất dữ liệu'
        });
    }
});

/**
 * GET /api/users/check-email/:email
 * Check if email exists
 */
router.get('/check-email/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const existingUser = users.find(u => u.email === email);
        
        res.json({
            success: true,
            exists: !!existingUser,
            data: existingUser ? {
                id: existingUser.id,
                name: existingUser.name,
                email: existingUser.email
            } : null
        });
        
    } catch (error) {
        console.error('Check email error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi kiểm tra email'
        });
    }
});

/**
 * PUT /api/users/:id/status
 * Update user status
 */
router.put('/:id/status', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { status } = req.body;
        
        if (!['active', 'inactive', 'pending', 'banned', 'suspended'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Trạng thái không hợp lệ'
            });
        }
        
        const user = users.find(u => u.id === userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }
        
        user.status = status;
        user.updatedAt = new Date().toISOString();
        
        res.json({
            success: true,
            message: `Đã cập nhật trạng thái thành ${status}`,
            data: user
        });
        
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi cập nhật trạng thái'
        });
    }
});

/**
 * PUT /api/users/:id/role
 * Update user role
 */
router.put('/:id/role', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { role } = req.body;
        
        if (!['admin', 'user', 'moderator', 'seller', 'customer'].includes(role)) {
            return res.status(400).json({
                success: false,
                message: 'Vai trò không hợp lệ'
            });
        }
        
        const user = users.find(u => u.id === userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }
        
        user.role = role;
        user.updatedAt = new Date().toISOString();
        
        res.json({
            success: true,
            message: `Đã cập nhật vai trò thành ${role}`,
            data: user
        });
        
    } catch (error) {
        console.error('Update role error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi cập nhật vai trò'
        });
    }
});

module.exports = router;