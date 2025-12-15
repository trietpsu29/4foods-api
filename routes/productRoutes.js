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
      return res
        .status(403)
        .json({ error: "Only sellers or admins can add products" });
    }

    // Xác định shop
    let shopId;
    if (user.role === "admin") {
      shopId = req.body.shopId;
      if (!shopId) return res.status(400).json({ error: "Missing shopId" });
    } else {
      shopId = user.shop;
      if (!shopId)
        return res.status(400).json({ error: "Seller has no shop assigned" });
    }

    const shop = await Shop.findById(shopId);
    if (!shop) return res.status(400).json({ error: "Shop not found" });

    const {
      name,
      price,
      description,
      imageUrl,
      discountPercent,
      prepTime,
      stock,
      category,
    } = req.body;

    if (!name || !price || !imageUrl || !category) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const removeAccents = require('remove-accents'); // Đảm bảo đã cài thư viện này
    const nameNoAccent = removeAccents(name).toLowerCase();
    const splitName = nameNoAccent.split(" "); // Tách từng từ: ["bun", "dau"]
    
    // Tạo bộ tag cơ bản
    let autoTags = [nameNoAccent, ...splitName];
    
    // Nếu mô tả ngắn, nhét thêm vào tag luôn cho chắc (tùy chọn)
    if (description && description.length < 100) {
        autoTags.push(removeAccents(description).toLowerCase());
    }

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

    // Notify admin if seller creates
    if (user.isSeller) {
      const admins = await User.find({ role: "admin" });
      const notis = admins.map((a) => ({
        user: a._id,
        message: `Sản phẩm mới "${product.name}" đang chờ duyệt.`,
        type: "system",
        metadata: { productId: product._id },
      }));
      if (notis.length) await Notification.insertMany(notis);
    }

    res.status(201).json({
      message:
        user.role === "admin"
          ? "Product created & displayed"
          : "Product created & pending approval",
      product,
    });
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

router.get("/", async (req, res) => {
  try {
    const { category, categoryId, shopId, keyword, page = 1, limit = 10, sort } = req.query;
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

    // --- LOGIC QUYỀN XEM (Giữ nguyên) ---
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

    // --- 2. LOOKUP SHOP ---
    pipeline.push({
      $lookup: { from: "shops", localField: "shopId", foreignField: "_id", as: "shopInfo" },
    });
    pipeline.push({ $unwind: "$shopInfo" });

    // --- 3. SEARCH NGHIÊM NGẶT (STRICT MODE) ---
    if (keyword && keyword.trim() !== '') {
        const { cleanKeyword } = require("../utils/searchHelper");
        const finalKeyword = cleanKeyword(keyword); // vd: "bun dau"
        
        // Tách từng từ: ["bun", "dau"]
        const words = finalKeyword.split(" ").filter(w => w.length > 0);
        
        if (words.length > 0) {
            // Tạo mảng điều kiện AND: Tất cả các từ phải xuất hiện
            const andConditions = words.map(word => {
                const regex = new RegExp(word, 'i');
                return {
                    $or: [
                        { nameNormalized: regex },           // Hoặc nằm trong tên
                        { descriptionNormalized: regex },    // Hoặc nằm trong mô tả
                        { searchTags: { $in: [regex] } },    // Hoặc nằm trong Tag
                        { "shopInfo.nameNormalized": regex } // Hoặc nằm trong tên Shop
                    ]
                };
            });

            // Đẩy điều kiện AND vào pipeline
            pipeline.push({ $match: { $and: andConditions } });

            // --- CHẤM ĐIỂM (Để sắp xếp thằng nào khớp nhiều nhất lên đầu) ---
            pipeline.push({
                $addFields: {
                    score: {
                        $add: [
                            // Thưởng cực lớn nếu khớp nguyên cụm từ "bun dau"
                            { $cond: [{ $regexMatch: { input: "$nameNormalized", regex: finalKeyword, options: "i" } }, 100, 0] },
                            // Thưởng nếu khớp tên từng phần
                            { $cond: [{ $regexMatch: { input: "$nameNormalized", regex: words[0], options: "i" } }, 10, 0] },
                            // Thưởng nếu khớp Tag
                            { $cond: [{ $isArray: "$searchTags" }, { $cond: [{ $in: [new RegExp(finalKeyword, "i"), "$searchTags"] }, 50, 0] }, 0] }
                        ]
                    }
                }
            });
            // Sort theo điểm -> Mới nhất
            pipeline.push({ $sort: { score: -1, createdAt: -1 } });
        }
    } else {
        // Sort mặc định khi không search
        let sortOption = { createdAt: -1 }; 
        if (sort === "price_asc") sortOption = { price: 1 };
        else if (sort === "price_desc") sortOption = { price: -1 };
        pipeline.push({ $sort: sortOption });
    }

    // --- 4. PAGINATION ---
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
                        ordersCount: 1, status: 1
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