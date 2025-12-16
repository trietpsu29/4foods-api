const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Shop = require("../models/Shop");
const User = require("../models/User");
const Notification = require("../models/Notification");
const auth = require("../middleware/auth");
const { cleanKeyword } = require("../utils/searchHelper");
// const admin = require("../middleware/admin"); // Uncomment nếu có middleware admin

/* ============================================================
   1. CREATE PRODUCT (Seller/Admin)
   ============================================================ */
router.post("/", auth, async (req, res) => {
  try {
    const user = req.user;

    if (!user.isSeller && user.role !== "admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Xác định Shop
    let shopId = user.role === "admin" ? req.body.shopId : user.shop;
    if (!shopId) return res.status(400).json({ error: "Missing shopId" });

    const shop = await Shop.findById(shopId);
    if (!shop) return res.status(400).json({ error: "Shop not found" });

    const { name, price, description, imageUrl, discountPercent, prepTime, stock, category } = req.body;

    if (!name || !price || !imageUrl || !category) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Tạo sản phẩm (Không cần tính toán tag ở đây nữa)
    // Model Product.js (pre-save) sẽ tự động điền searchTags, nameNormalized...
    const product = await Product.create({
      name,
      price,
      description,
      imageUrl,
      discountPercent,
      prepTime,
      stock,
      sellerId: user._id,
      shopId: shop._id,
      category,
      status: user.role === "admin" ? "displayed" : "pending",
    });

    // Thông báo cho Admin
    if (user.isSeller) {
      const admins = await User.find({ role: "admin" });
      if (admins.length > 0) {
          const notis = admins.map((a) => ({
            user: a._id,
            message: `Sản phẩm mới "${product.name}" đang chờ duyệt.`,
            type: "system",
            metadata: { productId: product._id },
          }));
          await Notification.insertMany(notis);
      }
    }

    res.status(201).json({ message: "Created successfully", product });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ============================================================
   2. GET PRODUCT BY ID
   ============================================================ */
router.get("/:id", auth, async (req, res) => {
  try {
    // Kiểm tra ID hợp lệ
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        // Nếu ID không phải ObjectId, bỏ qua (để route search bên dưới chạy nếu trùng path)
        // Tuy nhiên express match route từ trên xuống, nên route /:id sẽ hứng tất cả.
        // Tốt nhất nên return 404
        return res.status(404).json({ error: "Invalid ID format" });
    }

    const product = await Product.findById(req.params.id)
      .populate("shopId")
      .populate("sellerId", "name email")
      .populate("comments.user", "name avatar");

    if (!product) return res.status(404).json({ error: "Product not found" });

    const productData = {
      ...product.toObject(),
      category: product.category,
    };

    res.json(productData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   3. GET ALL PRODUCTS (SMART SEARCH + FILTER + SORT)
   ============================================================ */

router.get("/", auth, async (req, res) => {
  try {
    const { category, categoryId, shopId, keyword, page = 1, limit = 10, sort, searchType } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const pipeline = [];

    // --- 1. MATCH CƠ BẢN (Category, Shop) ---
    const matchStage = {};
    const targetCate = categoryId || category;
    if (shopId) matchStage.shopId = new mongoose.Types.ObjectId(shopId);
    if (targetCate) {
        const catConditions = [targetCate]; 
        if (mongoose.Types.ObjectId.isValid(targetCate)) catConditions.push(new mongoose.Types.ObjectId(targetCate));
        matchStage.category = { $in: catConditions };
    }

    // --- LOGIC QUYỀN XEM ---
    let isAdmin = false;
    let isViewingOwnShop = false;
    if (req.user) { 
        if (req.user.role === 'admin') isAdmin = true;
        if (req.user.shop && req.user.shop.toString() === shopId) isViewingOwnShop = true;
    }
    if (!isAdmin && !isViewingOwnShop) {
         if(!shopId) { 
             const openShops = await Shop.find({ isOpen: true }).select("_id");
             matchStage.shopId = { $in: openShops.map((s) => s._id) };
         }
         matchStage.status = "displayed"; 
    }
    pipeline.push({ $match: matchStage });

    // --- 2. LOOKUP SHOP (Để search tên shop) ---
    pipeline.push({
      $lookup: { from: "shops", localField: "shopId", foreignField: "_id", as: "shopInfo" },
    });
    pipeline.push({ $unwind: "$shopInfo" });

    // --- 3. XỬ LÝ SEARCH ---
    if (keyword && keyword.trim() !== '') {
        const { cleanKeyword } = require("../utils/searchHelper");
        const finalKeyword = cleanKeyword(keyword); // vd: "toi muon an bun dau"
        
        // Tách từ khóa
        const words = finalKeyword.split(" ").filter(w => w.length > 0);
        
        if (words.length > 0) {
            const isAdvanced = searchType === 'all'; // Checkbox

            if (!isAdvanced) {
                // ===============================================
                // CHẾ ĐỘ 1: CƠ BẢN (STRICT MODE) - AND LOGIC
                // Yêu cầu: "Bánh mì" -> Phải có "Bánh" VÀ "Mì"
                // Phạm vi: Chỉ Tên SP hoặc Tên Shop
                // ===============================================
                
                const andConditions = words.map(word => {
                    const regex = new RegExp(word, 'i');
                    return {
                        $or: [
                            { nameNormalized: regex },           // Tìm trong tên SP
                            { "shopInfo.nameNormalized": regex } // Tìm trong tên Shop
                        ]
                    };
                });
                
                // Dùng $and: Bắt buộc thỏa mãn tất cả các từ
                pipeline.push({ $match: { $and: andConditions } });

            } else {
                // ===============================================
                // CHẾ ĐỘ 2: NÂNG CAO (SMART SCORING) - OR LOGIC + SCORE
                // Yêu cầu: Gõ câu dài -> Lọc ra các món liên quan nhất
                // Phạm vi: Tên, Shop, Tag, Mô tả
                // ===============================================

                // 1. Lọc sơ bộ: Ít nhất phải dính 1 từ trong đống từ khóa thì mới lôi ra tính điểm
                const orConditions = words.map(word => {
                    const regex = new RegExp(word, 'i');
                    return {
                        $or: [
                            { nameNormalized: regex },
                            { "shopInfo.nameNormalized": regex },
                            { searchTags: { $in: [regex] } },
                            { descriptionNormalized: regex }
                        ]
                    };
                });
                pipeline.push({ $match: { $or: orConditions } });

                // 2. TÍNH ĐIỂM (SCORING) - Phần quan trọng nhất
                // - Trùng khớp nguyên cụm từ (vd "Cốt trà sữa"): 100 điểm
                // - Trùng từ trong Tên: 10 điểm/từ
                // - Trùng từ trong Tag: 5 điểm/từ
                // - Trùng từ trong Mô tả: 2 điểm/từ
                pipeline.push({
                    $addFields: {
                        score: {
                            $add: [
                                // Điểm tuyệt đối nếu trùng nguyên cụm từ khóa (Full phrase match)
                                { $cond: [{ $regexMatch: { input: "$nameNormalized", regex: finalKeyword, options: "i" } }, 100, 0] },
                                
                                // Cộng điểm cho từng từ khớp trong Tên (Name)
                                ...words.map(w => ({
                                    $cond: [{ $regexMatch: { input: "$nameNormalized", regex: w, options: "i" } }, 10, 0]
                                })),

                                // Cộng điểm cho từng từ khớp trong Tag
                                ...words.map(w => ({
                                    $cond: [{ $isArray: "$searchTags" }, { 
                                        $cond: [{ $in: [new RegExp(w, "i"), "$searchTags"] }, 5, 0] 
                                    }, 0]
                                })),

                                // Cộng điểm cho từng từ khớp trong Mô tả
                                ...words.map(w => ({
                                    $cond: [{ $regexMatch: { input: "$descriptionNormalized", regex: w, options: "i" } }, 2, 0]
                                }))
                            ]
                        }
                    }
                });

                // 3. Sắp xếp theo điểm cao xuống thấp
                pipeline.push({ $sort: { score: -1, createdAt: -1 } });
            }
        }
    }

    // --- 4. SORT MẶC ĐỊNH (Nếu ko phải search nâng cao hoặc điểm bằng nhau) ---
    // Nếu là Basic Search thì chưa có sort, ta sort theo user chọn
    // Nếu là Advanced Search thì đã sort theo score ở trên rồi, nhưng ta vẫn giữ logic này để fallback
    if (!keyword || (keyword && req.query.searchType !== 'all')) {
        let sortOption = { createdAt: -1 }; 
        if (sort === "price_asc") sortOption = { price: 1 };
        else if (sort === "price_desc") sortOption = { price: -1 };
        else if (sort === "rate") sortOption = { rating: -1 };
        
        pipeline.push({ $sort: sortOption });
    }

    // --- 5. PAGINATION ---
    pipeline.push({
        $facet: {
            metadata: [{ $count: "total" }],
            data: [
                { $skip: skip }, { $limit: parseInt(limit) },
                {
                    $project: {
                        name: 1, imageUrl: 1, price: 1, stock: 1, rating: 1,
                        discountPercent: 1, description: 1, createdAt: 1,
                        category: 1, prepTime: 1, shopId: 1,
                        shop: "$shopInfo.name", shopAddress: "$shopInfo.address",
                        ordersCount: 1, status: 1,
                        score: 1 // Debug điểm số nếu cần
                    }
                }
            ]
        }
    });

    const result = await Product.aggregate(pipeline);
    const total = result[0].metadata[0] ? result[0].metadata[0].total : 0;
    const products = result[0].data;

    res.json({ total, page: Number(page), totalPages: Math.ceil(total / limit), products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   4. UPDATE PRODUCT (Seller)
   ============================================================ */
router.put("/:id", auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const isOwnShop =
      req.user.shop && product.shopId.toString() === req.user.shop.toString();

    if (req.user.role !== "admin" && !isOwnShop) {
      return res
        .status(403)
        .json({ error: "You can only update your own products" });
    }

    // Nếu không phải admin và sp đang chờ duyệt thì không cho sửa (tuỳ logic)
    // Ở đây cho sửa nhưng status vẫn là pending
    if (req.user.role !== "admin" && product.status === "pending") {
       // Code cũ chặn sửa khi pending, có thể mở ra nếu muốn
       // return res.status(400).json({ error: "Pending product cannot be edited" });
    }

    const fields = [
      "name",
      "price",
      "description",
      "imageUrl",
      "discountPercent",
      "prepTime",
      "stock",
      "category",
    ];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) product[f] = req.body[f];
    });

    if (req.user.role !== "admin") {
      product.status = "pending"; // Sửa xong phải duyệt lại
      // Notify Admin
      const admins = await User.find({ role: "admin" });
      if(admins.length > 0) {
          const notis = admins.map((a) => ({
            user: a._id,
            message: `Sản phẩm "${product.name}" vừa được cập nhật, cần duyệt lại.`,
            type: "system",
            metadata: { productId: product._id },
          }));
          await Notification.insertMany(notis);
      }
    }

    await product.save();
    res.json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ============================================================
   5. DELETE PRODUCT
   ============================================================ */
router.delete("/:id", auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const isOwnShop =
      req.user.shop && product.shopId.toString() === req.user.shop.toString();

    if (req.user.role !== "admin" && !isOwnShop) {
      return res
        .status(403)
        .json({ error: "You can only delete your own product" });
    }

    await product.deleteOne();
    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   6. ADMIN APPROVE
   ============================================================ */
router.put("/:id/approve", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Admin only" });

    const { status, reason } = req.body;

    if (!["displayed", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    product.status = status;
    await product.save();

    const seller = await User.findById(product.sellerId);
    if(seller) {
        const message =
        status === "displayed"
            ? `Sản phẩm "${product.name}" đã được duyệt.`
            : status === "rejected"
            ? `Sản phẩm "${product.name}" bị từ chối. Lý do: ${reason || "Không rõ."}`
            : `Sản phẩm "${product.name}" đang chờ duyệt lại.`;

        await Notification.create({
        user: seller._id,
        sender: req.user.id,
        message,
        type: "system",
        targetType: "seller",
        metadata: { productId: product._id, status, reason },
        });
    }

    res.json({ message: `Product status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   7. TOGGLE DISPLAY/HIDDEN (Seller)
   ============================================================ */
router.put("/:id/toggle", auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const isOwnShop =
      req.user.shop && product.shopId.toString() === req.user.shop.toString();

    if (!isOwnShop) return res.status(403).json({ error: "Forbidden" });
    
    // Chỉ cho phép toggle khi sản phẩm đã được duyệt hoặc đang ẩn
    if (!["displayed", "hidden"].includes(product.status)) {
      return res
        .status(400)
        .json({ error: "Only approved products can be toggled" });
    }

    product.status = product.status === "displayed" ? "hidden" : "displayed";
    await product.save();

    res.json({ message: `Product is now ${product.status}`, product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   8. COMMENT
   ============================================================ */
router.post("/:id/comment", auth, async (req, res) => {
  try {
    const { content, rating, images = [] } = req.body;
    if (!content)
      return res.status(400).json({ error: "Comment content required" });

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const comment = {
      user: req.user._id,
      content,
      rating: rating || 0,
      images,
      createdAt: new Date(),
    };

    product.comments.push(comment);

    const totalRatings = product.comments.reduce(
      (sum, c) => sum + (c.rating || 0),
      0
    );
    const avgRating = totalRatings / product.comments.length;
    product.rating = Number(avgRating.toFixed(1));

    await product.save();
    res.json({ message: "Comment added", comment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   9. GET COMMENTS
   ============================================================ */
router.get("/:id/comments", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate(
      "comments.user",
      "name avatar"
    );
    if (!product) return res.status(404).json({ error: "Product not found" });

    res.json(product.comments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;