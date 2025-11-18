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

/* -------------------------- CANCEL ORDER -------------------------- */
router.put("/:orderId/cancel", auth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId).populate("items.product");

    if (!order) return res.status(404).json({ error: "Order not found" });

    /* ---------------- USER CANCEL ---------------- */
    if (req.user.role === "user") {
      if (order.status !== "processing")
        return res.status(400).json({
          error: "Cannot cancel, order not processing",
        });

      order.status = "cancelled";
      await order.save();

      // Trả stock lại
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product._id, {
          $inc: { stock: item.quantity },
        });
      }

      const buyer = await User.findById(order.user).select("name");
      const shops = await Shop.find({ owner: { $ne: null } });

      for (const item of order.items) {
        const shop = shops.find(
          (s) => s._id.toString() === item.product.shopId?.toString()
        );
        if (!shop) continue;

        const seller = await User.findById(shop.owner).select("name");

        await Notification.create({
          user: shop.owner,
          sender: req.user._id,
          message: `Người mua ${buyer.name} đã hủy đơn hàng #${order._id}.`,
          type: "order",
          targetType: "seller",
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
            status: "cancelled",
          },
        });
      }

      return res.json({
        message: "Order cancelled successfully",
        order,
      });
    }

    res.status(403).json({ error: "Unauthorized" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- USER REQUEST REFUND -------------------------- */
router.post("/:orderId/refund", auth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    const order = await Order.findById(orderId).populate("items.product");
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (order.status !== "delivered")
      return res.status(400).json({
        error: "Refund only available for delivered orders",
      });

    order.refundRequest = { status: "pending", reason };
    await order.save();

    const buyer = await User.findById(order.user).select("name");
    const shops = await Shop.find({ owner: { $ne: null } });

    for (const item of order.items) {
      const shop = shops.find(
        (s) => s._id.toString() === item.product.shopId?.toString()
      );
      if (!shop) continue;

      const seller = await User.findById(shop.owner).select("name");

      await Notification.create({
        user: shop.owner,
        sender: req.user._id,
        message: `Người mua ${buyer.name} yêu cầu hoàn tiền đơn hàng #${order._id}.`,
        type: "order",
        targetType: "seller",
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
          status: "refund_pending",
          reason,
        },
      });
    }

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

/* -------------------------- SELLER ACCEPT / REJECT -------------------------- */
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

      // Cộng stock lại
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product._id, {
          $inc: { stock: item.quantity },
        });
      }
    } else if (action === "reject") {
      order.refundRequest.status = "rejected";
    } else {
      return res.status(400).json({ error: "Invalid action" });
    }

    await order.save();

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
        status: action === "accept" ? "refund_accepted" : "refund_rejected",
      },
    });

    res.json({ message: `Refund ${action}`, order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- PLACE ORDER (COD + MOMO) -------------------------- */
router.post("/", auth, async (req, res) => {
  try {
    const {
      items,
      addressId,
      paymentMethod,
      noteForShop,
      noteForShipper,
      voucherId,
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

    /** APPLY VOUCHER **/
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

    const deliveryFee = 15000;
    const total = subtotal + deliveryFee - discount;

    /** ================= CASE 1: COD ====================== **/
    if (paymentMethod === "cod") {
      const order = await Order.create({
        user: req.user._id,
        items: validatedItems,
        subtotal,
        discount,
        deliveryFee,
        total,
        voucher: appliedVoucher,
        address,
        paymentMethod,
        noteForShop,
        noteForShipper,
        status: "processing",
      });

      // trừ stock
      for (const item of validatedItems) {
        await Product.findByIdAndUpdate(item.product, {
          $inc: { stock: -item.quantity, ordersCount: item.quantity },
        });
      }

      req.user.cart = [];
      await req.user.save();

      return res.status(201).json({
        message: "Order placed successfully",
        order,
      });
    }

    /** ================= CASE 2: MOMO ====================== **/
    if (paymentMethod === "momo") {
      const crypto = require("crypto");
      const axios = require("axios");

      const partnerCode = "MOMO";
      const accessKey = "F8BBA842ECF85";
      const secretkey = "K951B6PE1waDMi640xX08PD3vg6EkVlz";
      const requestId = partnerCode + Date.now();
      const orderId = requestId;
      const orderInfo = "Thanh toán MoMo - 4Foods";
      const redirectUrl = "https://api.4foods.app/momo/return";
      const ipnUrl = "https://api.4foods.app/momo/callback";

      // extraData
      const extra = {
        userId: req.user._id,
        items: validatedItems,
        address,
        subtotal,
        discount,
        deliveryFee,
        noteForShop,
        noteForShipper,
        voucherId: appliedVoucher,
      };

      const extraData = Buffer.from(JSON.stringify(extra)).toString("base64");

      const requestType = "captureWallet";

      const rawSignature =
        `accessKey=${accessKey}` +
        `&amount=${total}` +
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
        amount: total.toString(),
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

/* -------------------------- MOMO CALLBACK -------------------------- */
router.post("/momo/callback", async (req, res) => {
  try {
    const data = req.body;

    const crypto = require("crypto");
    const accessKey = "F8BBA842ECF85";
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

    const order = await Order.create({
      user: extra.userId,
      items: extra.items,
      subtotal: extra.subtotal,
      discount: extra.discount,
      deliveryFee: extra.deliveryFee,
      total: data.amount,
      voucher: extra.voucherId,
      noteForShop: extra.noteForShop,
      noteForShipper: extra.noteForShipper,
      address: extra.address,
      paymentMethod: "momo",
      status: "processing",
    });

    for (const item of extra.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: -item.quantity, ordersCount: item.quantity },
      });
    }

    const user = await User.findById(extra.userId);
    if (user) {
      user.cart = [];
      await user.save();
    }

    return res.status(200).json({ message: "Order created", order });
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
      .populate("items.product", "name image prepTime comments")
      .populate("voucher", "code name discountType discountValue endDate")
      .sort({ createdAt: -1 });

    const ongoing = [];
    const history = [];
    const deals = [];
    const review = [];

    for (const order of orders) {
      if (["processing"].includes(order.status)) ongoing.push(order);
      else history.push(order);

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
              image: item.product.image,
              quantity: item.quantity,
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

    if (req.user.role === "seller") {
      const shops = await Shop.find({ owner: req.user._id }).select("_id");
      filter["items.product.shopId"] = { $in: shops.map((s) => s._id) };
    }

    const orders = await Order.find(filter)
      .populate("user", "name email")
      .populate("items.product", "name image prepTime")
      .populate("voucher", "code name discountType discountValue endDate")
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- UPDATE STATUS -------------------------- */
router.put("/:orderId/status", auth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!["processing", "delivered", "cancelled"].includes(status))
      return res.status(400).json({ error: "Invalid status" });

    const order = await Order.findById(orderId).populate("items.product");
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (req.user.role === "seller") {
      const shops = await Shop.find({ owner: req.user._id }).select("_id");
      const shopIds = shops.map((s) => s._id.toString());

      const hasItemFromShop = order.items.some((i) =>
        shopIds.includes(i.product.shopId.toString())
      );

      if (!hasItemFromShop) return res.status(403).json({ error: "Forbidden" });
    }

    order.status = status;
    await order.save();

    // seller cancels → trả stock
    if (status === "cancelled") {
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product._id, {
          $inc: { stock: item.quantity },
        });
      }
    }

    // notify
    if (req.user.role === "seller" && status === "delivered") {
      const seller = await User.findById(req.user._id).select("name");
      const buyer = await User.findById(order.user).select("name");

      await Notification.create({
        user: order.user,
        sender: req.user._id,
        message: `Người bán ${seller.name} đã giao thành công đơn hàng #${order._id}.`,
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
          status: "delivered",
        },
      });
    }

    if (req.user.role === "seller" && status === "cancelled") {
      const seller = await User.findById(req.user._id).select("name");
      const buyer = await User.findById(order.user).select("name");

      await Notification.create({
        user: order.user,
        sender: req.user._id,
        message: `Người bán ${seller.name} đã từ chối và hủy đơn hàng #${order._id}.`,
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
          status: "cancelled",
        },
      });
    }

    res.json({ message: "Order status updated", order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- ORDER STATS -------------------------- */
router.get("/stats", auth, async (req, res) => {
  try {
    const match = {};

    if (req.user.role === "seller") {
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

module.exports = router;
