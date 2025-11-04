const sellerMiddleware = (req, res, next) => {
  if (!req.user.isSeller)
    return res.status(403).json({ error: "Seller access only" });
  next();
};

module.exports = sellerMiddleware;
