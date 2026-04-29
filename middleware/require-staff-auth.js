const { verifyStaffToken, normalizeStaffRole, isStaffManagerRole } = require("../utils/auth");

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
    const normalizedRole = normalizeStaffRole(decoded.role);
    req.staffUser = {
      ...decoded,
      role: normalizedRole,
      isManager: isStaffManagerRole(normalizedRole)
    };
    req.staffHotelSlug = decoded.hotelSlug;
    req.staffRole = normalizedRole;
    req.staffCanViewManagerData = isStaffManagerRole(normalizedRole);
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired staff token"
    });
  }
}

function requireStaffManagerAccess(req, res, next) {
  if (req.staffCanViewManagerData || req.staffUser?.isManager) {
    next();
    return;
  }

  return res.status(403).json({
    success: false,
    message: "Manager access is required for this staff section"
  });
}

module.exports = { requireStaffAuth, requireStaffManagerAccess };
