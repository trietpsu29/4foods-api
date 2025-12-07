const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Voucher = require("../models/Voucher");
const Shop = require("../models/Shop");
const Notification = require("../models/Notification");
const User = require("../models/User");
const Cart = require("../models/Cart");

/* -------------------------- SELLER RESPONSE TO CANCEL REQUEST -------------------------- */
router.put("/:orderId/cancel-response", auth, async (req, res) => {
  try {
    if (!req.user.isSeller) return res.status(403).json({ error: "Seller only" });

    const { orderId } = req.params;
    const { action } = req.body; // "accept" hoặc "reject"

    const order = await Order.findById(orderId).populate("items.product");
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Kiểm tra có yêu cầu hủy không
    if (!order.cancelRequest || order.cancelRequest.status !== "pending") {
      return res.status(400).json({ error: "No pending cancel request" });
    }

    if (action === "accept") {
      // 1. Chấp nhận hủy
      order.cancelRequest.status = "accepted";
      order.status = "cancelled"; // Chuyển đơn sang trạng thái Đã hủy

      // 2. Trả lại Stock
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product._id, {
          $inc: { stock: item.quantity },
        });
      }
    } else if (action === "reject") {
      // Từ chối hủy -> Đơn vẫn giữ nguyên trạng thái cũ (thường là processing)
      order.cancelRequest.status = "rejected";
      // Không đổi order.status
    } else {
      return res.status(400).json({ error: "Invalid action" });
    }

    await order.save();

    // Gửi thông báo cho User
    await Notification.create({
      user: order.user,
      message: action === "accept" 
        ? "Shop đã đồng ý hủy đơn hàng của bạn." 
        : "Shop đã từ chối yêu cầu hủy đơn hàng (Đơn đã làm xong).",
      type: "order",
      metadata: { orderId: order._id, status: order.status },
    });

    res.json({ message: `Cancel request ${action}ed`, order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- USER REQUEST CANCEL ORDER -------------------------- */
router.post("/:orderId/cancel-request", auth, async (req, res) => {
  console.log("!!! SERVER ĐÃ NHẬN ĐƯỢC LỆNH HỦY !!!");
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    const order = await Order.findById(orderId).populate("items.product");
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Chỉ cho phép gửi yêu cầu khi đơn đang "processing" (Đang chuẩn bị)
    if (order.status !== "processing") {
      return res.status(400).json({ 
        error: "Cannot cancel order at this stage (only processing orders)" 
      });
    }

    // 1. Cập nhật cancelRequest vào đơn hàng
    order.cancelRequest = {
      status: "pending",
      reason: reason || "User requested cancellation",
      createdAt: new Date()
    };
    
    // Lưu ý: Không đổi status chính của order ngay, phải chờ Shop duyệt
    // (Tuy nhiên ở App Frontend bạn có thể hiện trạng thái "Đang chờ duyệt hủy")
    
    await order.save();

    // 2. Gửi thông báo cho Seller (Chủ Shop)
    const shops = await Shop.find({ owner: { $ne: null } });
    const buyer = await User.findById(req.user._id).select("name");

    // Tìm Shop sở hữu đơn hàng này
    // (Logic này giả định 1 đơn hàng chỉ thuộc 1 Shop - do lúc tạo đơn đã tách rồi)
    let shopOwnerId = null;
    if (order.items.length > 0) {
       const product = await Product.findById(order.items[0].product._id);
       const shop = shops.find(s => s._id.toString() === product.shopId.toString());
       if (shop) shopOwnerId = shop.owner;
    }

    if (shopOwnerId) {
      await Notification.create({
        user: shopOwnerId, // Gửi cho Seller
        sender: req.user._id,
        message: `Khách hàng ${buyer.name} muốn hủy đơn hàng #${order._id}. Lý do: ${reason}`,
        type: "order",
        targetType: "seller", // Để App Seller biết đường mở màn hình duyệt
        metadata: {
          orderId: order._id,
          status: "cancel_pending", // Cờ hiệu để Seller biết
          reason
        }
      });
    }

    res.json({ message: "Cancel request sent successfully", order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- USER REQUEST REFUND -------------------------- */
router.post("/:orderId/refund", auth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    // Populate để lấy thông tin món và shopId
    const order = await Order.findById(orderId).populate("items.product");
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Chỉ cho hoàn tiền khi đã giao thành công
    if (order.status !== "delivered") {
      return res.status(400).json({
        error: "Refund only available for delivered orders",
      });
    }

    // 1. CẬP NHẬT DB (Quan trọng nhất)
    order.refundRequest = {
      status: "pending",
      reason: reason || "Sản phẩm lỗi/hỏng",
      createdAt: new Date(),
    };
    order.status = "refund_pending"; // Đổi màu bên App User

    await order.save(); // Lưu ngay để đảm bảo dữ liệu

    // 2. GỬI THÔNG BÁO CHO SHOP (Bọc Try-Catch để không làm chết API)
    try {
        const buyer = await User.findById(req.user._id).select("name");
        
        // Tìm chủ shop (Vì đơn đã tách theo shop, nên lấy shop của món đầu tiên là được)
        let shopOwnerId = null;
        if (order.items.length > 0 && order.items[0].product) {
            const product = order.items[0].product;
            // Lấy ID shop (xử lý trường hợp populate hoặc không)
            const shopId = product.shopId?._id || product.shopId;
            
            if (shopId) {
                const shop = await Shop.findById(shopId);
                if (shop) shopOwnerId = shop.owner;
            }
        }

        if (shopOwnerId) {
            await Notification.create({
                user: shopOwnerId,
                sender: req.user._id,
                message: `Khách hàng ${buyer.name} yêu cầu hoàn tiền đơn hàng #${order._id}. Lý do: ${reason}`,
                type: "order",
                targetType: "seller",
                metadata: {
                    orderId: order._id,
                    status: "refund_pending",
                    reason,
                    // Thêm danh sách món để Shop dễ nhìn
                    items: order.items.map((i) => ({
                        name: i.product.name,
                        quantity: i.quantity,
                    })),
                },
            });
        }
    } catch (notifyErr) {
        console.error("Lỗi gửi thông báo (nhưng Refund đã lưu):", notifyErr.message);
    }

    // Trả về thành công
    res.json({ message: "Refund request sent", order });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- SELLER VIEW PENDING REFUNDS -------------------------- */
router.get("/refunds", auth, async (req, res) => {
  try {
    if (!req.user.isSeller)
      return res.status(403).json({ error: "Only for sellers" });

    const shops = await Shop.find({ owner: req.user._id }).select("_id");
    const shopIds = shops.map((s) => s._id.toString());

    // FIX BUG: populate product to read shopId
    const orders = await Order.find({
      "refundRequest.status": "pending",
    }).populate("items.product");

    const filtered = orders.filter((o) =>
      o.items.some(
        (i) =>
          i.product?.shopId?.toString &&
          shopIds.includes(i.product.shopId.toString())
      )
    );

    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- SELLER ACCEPT / REJECT REFUND -------------------------- */
router.put("/:orderId/refund", auth, async (req, res) => {
  try {
    if (!req.user.isSeller)
      return res.status(403).json({ error: "Only for sellers" });

    const { orderId } = req.params;
    const { action } = req.body;

    const order = await Order.findById(orderId).populate("items.product");

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!order.refundRequest || order.refundRequest.status !== "pending")
      return res.status(400).json({ error: "No processing refund request" });

    if (action === "accept") {
      order.refundRequest.status = "accepted";
      order.status = "refunded"; // <-- ĐƠN ĐÃ HOÀN TIỀN THÀNH CÔNG

      // Cộng stock lại
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product._id, {
          $inc: { stock: item.quantity },
        });
      }
    } else if (action === "reject") {
      order.refundRequest.status = "rejected";
      order.status = "delivered"; // <-- ĐƠN QUAY VỀ LỊCH SỬ (delivered)
    } else {
      return res.status(400).json({ error: "Invalid action" });
    }

    await order.save();

    // GỬI THÔNG BÁO CHO BUYER
    const buyer = await User.findById(order.user).select("name");
    const seller = await User.findById(req.user._id).select("name");

    await Notification.create({
      user: order.user,
      sender: req.user._id,
      message:
        action === "accept"
          ? `Người bán ${seller.name} đã chấp nhận hoàn tiền đơn hàng #${order._id}.`
          : `Người bán ${seller.name} đã từ chối hoàn tiền đơn hàng #${order._id}.`,
      type: "order",
      targetType: "user",
      metadata: {
        orderId: order._id,
        buyerId: buyer._id,
        buyerName: buyer.name,
        sellerId: seller._id,
        sellerName: seller.name,
        items: order.items.map((i) => ({
          name: i.product.name,
          quantity: i.quantity,
        })),
        status: action === "accept" ? "refunded" : "delivered", // Trạng thái cuối cùng để client biết
      },
    });

    res.json({ message: `Refund ${action}`, order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ...existing code...

/* -------------------------- Place order (split per shop) -------------------------- */
router.post("/", auth, async (req, res) => {
  try {
    const {
      items,
      addressId,
      paymentMethod,
      noteForShipper,
      voucherId,
      shopNotes,
    } = req.body;

    if (!items || !items.length)
      return res.status(400).json({ error: "Cart is empty" });

    const address = req.user.addresses[addressId];
    if (!address) return res.status(400).json({ error: "Invalid address" });

    /** VALIDATE ITEMS **/
    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const product = await Product.findById(item.product).populate("shopId");
      if (!product || product.stock < item.quantity)
        return res.status(400).json({
          error: `Product ${product?.name || "unknown"} out of stock`,
        });

      validatedItems.push({
        product: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        shopId: product.shopId?._id,
      });

      subtotal += product.price * item.quantity;
    }

    /** SHOP NOTES MAPPING (shopId + note) */
    const notesByShop = new Map();
    if (Array.isArray(shopNotes)) {
      for (const s of shopNotes) {
        if (s.shopId) notesByShop.set(s.shopId.toString(), s.note || "");
      }
    }

    /** APPLY VOUCHER (global) **/
    let discount = 0;
    let appliedVoucher = null;

    if (voucherId) {
      const voucher = await Voucher.findById(voucherId);
      if (
        voucher &&
        voucher.remaining > 0 &&
        new Date() >= voucher.startDate &&
        new Date() <= voucher.endDate
      ) {
        if (voucher.discountType === "percent") {
          discount = Math.min(
            (subtotal * voucher.discountValue) / 100,
            voucher.maxDiscount || subtotal
          );
        } else {
          discount = Math.min(voucher.discountValue, subtotal);
        }
        appliedVoucher = voucher._id;
      }
    }

    /** GROUP ITEMS BY SHOP **/
    const groups = new Map(); // shopId => { items: [], subtotal }
    for (const vi of validatedItems) {
      const key = vi.shopId?.toString();
      if (!key) return res.status(400).json({ error: "Product missing shop" });
      if (!groups.has(key)) groups.set(key, { items: [], subtotal: 0 });
      const g = groups.get(key);
      g.items.push(vi);
      g.subtotal += vi.price * vi.quantity;
    }

    const deliveryFeePerOrder = 15000;

    /** ================= CASE 1: COD — create 1 order per shop ====================== **/
    if (paymentMethod === "cod") {
      const ordersCreated = [];

      for (const [shopId, group] of groups.entries()) {
        // Split discount proportionally to each shop group
        const proportion = subtotal > 0 ? group.subtotal / subtotal : 0;
        const groupDiscount = Math.round(discount * proportion);
        const total = group.subtotal + deliveryFeePerOrder - groupDiscount;

        const order = await Order.create({
          user: req.user._id,
          items: group.items,
          subtotal: group.subtotal,
          discount: groupDiscount,
          deliveryFee: deliveryFeePerOrder,
          total,
          voucher: appliedVoucher,
          address,
          paymentMethod,
          shopNotes: [{ shopId, note: notesByShop.get(shopId) || "" }],
          noteForShipper,
          status: "processing",
        });

        // decrease stock for items in this group
        for (const gi of group.items) {
          await Product.findByIdAndUpdate(gi.product, {
            $inc: { stock: -gi.quantity, ordersCount: gi.quantity },
          });
        }

        ordersCreated.push(order);
      }

      // clear cart after successful orders
      await Cart.updateOne({ user: req.user._id }, { $set: { items: [] } });

      return res.status(201).json({
        message: "Orders placed successfully",
        orders: ordersCreated,
      });
    }

    /** ================= CASE 2: MOMO — pay once then split on callback ====================== **/
    if (paymentMethod === "momo") {
      const crypto = require("crypto");
      const axios = require("axios");

      const partnerCode = "MOMO";
      const accessKey = "F8BBA842ECF85";
      const secretkey = "K951B6PE1waDMi640xX08PD3vg6EkVlz";

      const requestId = partnerCode + Date.now();
      const orderId = requestId;
      const orderInfo = "Thanh toán MoMo - 4Foods";
      const redirectUrl = "https://api.4foods.app/orders/momo/return";
      const ipnUrl = "https://api.4foods.app/orders/momo/callback";

      // include everything needed to reconstruct split orders
      const extra = {
        userId: req.user._id,
        address,
        noteForShipper,
        voucherId: appliedVoucher,
        deliveryFeePerOrder,
        groups: Array.from(groups.entries()).map(([shopId, g]) => ({
          shopId,
          items: g.items,
          subtotal: g.subtotal,
          note: notesByShop.get(shopId) || "",
        })),
        subtotal,
        discount,
      };

      const totalForPayment =
        Array.from(groups.values()).reduce((sum, g) => sum + g.subtotal, 0) +
        groups.size * deliveryFeePerOrder -
        discount;

      const extraData = Buffer.from(JSON.stringify(extra)).toString("base64");
      const requestType = "captureWallet";

      const rawSignature =
        `accessKey=${accessKey}` +
        `&amount=${totalForPayment}` +
        `&extraData=${extraData}` +
        `&ipnUrl=${ipnUrl}` +
        `&orderId=${orderId}` +
        `&orderInfo=${orderInfo}` +
        `&partnerCode=${partnerCode}` +
        `&redirectUrl=${redirectUrl}` +
        `&requestId=${requestId}` +
        `&requestType=${requestType}`;

      const signature = crypto
        .createHmac("sha256", secretkey)
        .update(rawSignature)
        .digest("hex");

      const requestBody = {
        partnerCode,
        accessKey,
        requestId,
        amount: totalForPayment.toString(),
        orderId,
        orderInfo,
        redirectUrl,
        ipnUrl,
        extraData,
        requestType,
        signature,
      };

      const axiosRes = await axios.post(
        "https://test-payment.momo.vn/v2/gateway/api/create",
        requestBody
      );

      return res.json({
        message: "Redirect to MoMo",
        payUrl: axiosRes.data.payUrl,
      });
    }

    return res.status(400).json({ error: "Invalid payment method" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/* -------------------------- MOMO CALLBACK (split orders per shop) -------------------------- */
router.post("/momo/callback", async (req, res) => {
  try {
    const data = req.body;

    const crypto = require("crypto");
    const secretkey = "K951B6PE1waDMi640xX08PD3vg6EkVlz";

    const rawSignature =
      `accessKey=${data.accessKey}` +
      `&amount=${data.amount}` +
      `&extraData=${data.extraData}` +
      `&message=${data.message}` +
      `&orderId=${data.orderId}` +
      `&orderInfo=${data.orderInfo}` +
      `&orderType=${data.orderType}` +
      `&partnerCode=${data.partnerCode}` +
      `&payType=${data.payType}` +
      `&requestId=${data.requestId}` +
      `&responseTime=${data.responseTime}` +
      `&resultCode=${data.resultCode}` +
      `&transId=${data.transId}`;

    const checkSignature = crypto
      .createHmac("sha256", secretkey)
      .update(rawSignature)
      .digest("hex");

    if (checkSignature !== data.signature)
      return res.status(400).json({ message: "Invalid signature" });

    if (data.resultCode !== 0)
      return res.status(200).json({ message: "Payment failed" });

    const extra = JSON.parse(
      Buffer.from(data.extraData, "base64").toString("utf8")
    );

    const {
      userId,
      address,
      noteForShipper,
      voucherId,
      deliveryFeePerOrder,
      groups,
      subtotal,
      discount,
    } = extra;

    const orders = [];

    for (const group of groups) {
      const proportion = subtotal > 0 ? group.subtotal / subtotal : 0;
      const groupDiscount = Math.round(discount * proportion);
      const total = group.subtotal + deliveryFeePerOrder - groupDiscount;

      const order = await Order.create({
        user: userId,
        items: group.items,
        subtotal: group.subtotal,
        discount: groupDiscount,
        deliveryFee: deliveryFeePerOrder,
        total,
        voucher: voucherId,
        noteForShipper,
        address,
        paymentMethod: "momo",
        status: "processing",
        shopNotes: [{ shopId: group.shopId, note: group.note || "" }],
      });

      for (const item of group.items) {
        await Product.findByIdAndUpdate(item.product, {
          $inc: { stock: -item.quantity, ordersCount: item.quantity },
        });
      }

      orders.push(order);
    }

    // clear cart
    const user = await User.findById(userId);
    if (user) {
      user.cart = [];
      await user.save();
    }

    return res.status(200).json({ message: "Orders created", orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/momo/return", (req, res) => {
  const { resultCode } = req.query;
  if (resultCode === "0")
    return res.send("Thanh toán thành công. Bạn có thể đóng trang này.");
  return res.send("Thanh toán thất bại hoặc bị hủy.");
});

/* -------------------------- USER ALL TABS -------------------------- */
router.get("/all-tabs", auth, async (req, res) => {
  try {
    const now = new Date();

    const orders = await Order.find({ user: req.user._id })
      .populate({
        path: "items.product",
        select: "name imageUrl prepTime comments description shopId",
        populate: {
          path: "shopId",
          select: "name address",
        },
      })
      .populate("voucher", "code name discountType discountValue endDate")
      .sort({ createdAt: -1 });

    const ongoing = [];
    const history = [];
    const deals = [];
    const review = [];

    for (const order of orders) {
      if (["processing", "shipping", "arrived"].includes(order.status)) {
        ongoing.push(order);
      } else {
        history.push(order);
      }

      if (order.voucher) {
        deals.push({
          voucherCode: order.voucher.code,
          name: order.voucher.name,
          discountType: order.voucher.discountType,
          discountValue: order.voucher.discountValue,
          used: true,
          expired: now > order.voucher.endDate,
          orderId: order._id,
          totalDiscount: order.discount,
        });
      }

      if (order.status === "delivered") {
        for (const item of order.items) {
          const hasReviewed = item.product.comments.some(
            (c) => c.user.toString() === req.user._id.toString()
          );

          if (!hasReviewed) {
            review.push({
              orderId: order._id,
              productId: item.product._id,
              name: item.product.name,
              image: item.product.imageUrl,
              description: item.product.description,
              quantity: item.quantity,
              shopName: item.product.shopId?.name,
              shopAddress: item.product.shopId?.address,
            });
          }
        }
      }
    }

    res.json({ ongoing, history, deals, review });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- ALL ORDERS (ADMIN/SELLER) -------------------------- */
router.get("/all", auth, async (req, res) => {
  try {
    let filter = {};

    if (req.user.isSeller) {
      const shops = await Shop.find({ owner: req.user._id }).select("_id");
      filter["items.shopId"] = { $in: shops.map((s) => s._id) };
    }

    const { status } = req.query;
    if (status) {
      if (status === "active") {
        // Tab Đang giao: Gồm Mới, Đang ship, Đã đến (chưa xác nhận)
        filter.status = { $in: ["processing", "shipping", "arrived"] };
      } 
      else if (status === "completed") {
        // Tab Đã giao: Chỉ tính đơn giao thành công
        filter.status = "delivered";
      }
      else if (status === "refunded_group") {
        // Tab Hoàn tiền: Gồm đang chờ và đã hoàn
        filter.status = { $in: ["refund_pending", "refunded"] };
      }
      else {
        // Các trường hợp khác (cancelled...)
        filter.status = status;
      }
    }

    const orders = await Order.find(filter)
      .populate("user", "name email phone")
      .populate({
        path: "items.product",
        select: "name imageUrl prepTime description price stock shopId",
        populate: { path: "shopId", select: "name address isOpen" },
      })
      .populate("voucher", "code name discountType discountValue endDate")
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- GET ONE ORDER -------------------------- */
router.get("/:orderId", auth, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .populate("user", "name email phone")
      .populate({
        path: "items.product",
        select: "name imageUrl prepTime price stock description shopId",
        populate: {
          path: "shopId",
          select: "name address isOpen",
        },
      })
      .populate("voucher", "code name discountType discountValue endDate");

    if (!order) return res.status(404).json({ error: "Order not found" });

    // Seller only access their own shops’ orders
    if (req.user.role === "seller") {
      const shops = await Shop.find({ owner: req.user._id }).select("_id");
      const shopIds = shops.map((s) => s._id.toString());

      const hasItemFromShop = order.items.some((i) =>
        shopIds.includes(i.product.shopId._id.toString())
      );

      if (!hasItemFromShop) {
        return res
          .status(403)
          .json({ error: "Forbidden: You cannot view this order" });
      }
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




/* -------------------------- UPDATE STATUS -------------------------- */
/* Dùng cho các nút: "Giao hàng", "Đã giao", hoặc Seller tự bấm "Hủy đơn" */
router.put("/:orderId/status", auth, async (req, res) => {
  try {
    // 1. Kiểm tra quyền Seller
    // (Hỗ trợ cả cờ isSeller và role string để chắc chắn)
    if (!req.user.isSeller && req.user.role !== "seller") {
      return res
        .status(403)
        .json({ error: "Only sellers can update order status" });
    }

    const { orderId } = req.params;
    const { status } = req.body;

    // 2. Validate trạng thái hợp lệ
    // (Thêm 'shipping', 'arrived' vào danh sách cho phép)
    if (
      !["processing", "shipping", "arrived", "delivered", "cancelled"].includes(
        status
      )
    ) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const order = await Order.findById(orderId).populate("items.product");
    if (!order) return res.status(404).json({ error: "Order not found" });

    // 3. Kiểm tra bảo mật: Seller có sở hữu đơn hàng này không?
    // (Lấy tất cả shop của user này và so sánh với shopId trong đơn hàng)
    const shops = await Shop.find({ owner: req.user._id }).select("_id");
    const shopIds = shops.map((s) => s._id.toString());

    // Chỉ cần 1 món trong đơn thuộc shop của seller là được quyền xem/sửa
    const hasItemFromShop = order.items.some((i) =>
      shopIds.includes(i.product.shopId.toString())
    );
    
    if (!hasItemFromShop) return res.status(403).json({ error: "Forbidden: Not your order" });

    // 4. LOGIC QUAN TRỌNG: Nếu Seller chủ động HỦY -> Phải trả lại Stock (Tồn kho)
    if (status === "cancelled" && order.status !== "cancelled") {
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product._id, {
          $inc: { stock: item.quantity }, // Cộng lại số lượng
        });
      }
    }

    // 5. Cập nhật trạng thái
    order.status = status;
    await order.save();

    // 6. Gửi thông báo chi tiết cho Khách hàng (User)
    const seller = await User.findById(req.user._id).select("name");
    const buyer = await User.findById(order.user).select("name");

    let notiMessage = `Trạng thái đơn hàng #${order._id} đã chuyển sang: ${status}`;
    
    if (status === "shipping") {
        notiMessage = `Đơn hàng #${order._id} đã được giao cho đơn vị vận chuyển.`;
    } else if (status === "delivered") {
        notiMessage = `Đơn hàng #${order._id} đã được giao thành công. Chúc bạn ngon miệng!`;
    } else if (status === "cancelled") {
        notiMessage = `Rất tiếc, đơn hàng #${order._id} đã bị Shop hủy.`;
    }

    await Notification.create({
      user: order.user,
      sender: req.user._id,
      message: notiMessage,
      type: "order",
      targetType: "user",
      metadata: {
        orderId: order._id,
        buyerId: buyer._id,
        sellerId: seller._id, // Lưu lại ID để sau này chat/review
        status: status,
      },
    });

    res.json({ message: "Order status updated successfully", order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- ORDER STATS -------------------------- */
router.get("/stats", auth, async (req, res) => {
  try {
    const match = {};

    if (req.user.isSeller) {
      const shops = await Shop.find({ owner: req.user._id }).select("_id");
      match["items.product.shopId"] = { $in: shops.map((s) => s._id) };
    }

    const stats = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: "$total" },
        },
      },
    ]);

    res.json(stats[0] || { totalOrders: 0, totalRevenue: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- USER CONFIRM ORDER (ĐÃ NHẬN HÀNG) -------------------------- */
router.put("/:orderId/confirm", auth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);

    if (!order) return res.status(404).json({ error: "Order not found" });

    // 1. Chỉ chủ đơn hàng mới được bấm nút này
    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // 2. Chỉ cho nhận khi đơn đã đến nơi (arrived)
    // (Nếu muốn cho nhận lúc đang giao luôn thì thêm 'shipping' vào)
    if (!["arrived", "shipping"].includes(order.status)) {
      return res.status(400).json({ error: "Order not arrived yet" });
    }

    // 3. Cập nhật thành công -> Đơn sẽ tự bay sang tab Lịch sử
    order.status = "delivered";
    await order.save();

    // 4. Tạo thông báo cho Seller biết
    // (Bạn có thể copy code Notification từ API khác bỏ vào đây nếu cần)

    res.json({ message: "Order confirmed delivered", order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
