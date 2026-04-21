const { verifyStaffToken } = require("../utils/auth");

function requireStaffAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Missing or invalid authorization header"
      });
    }

    const token = authHeader.slice("Bearer ".length).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Missing token"
      });
    }

    const decoded = verifyStaffToken(token);
    req.staffUser = decoded;
    req.staffHotelSlug = decoded.hotelSlug;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired staff token"
    });
  }
}

module.exports = { requireStaffAuth };
