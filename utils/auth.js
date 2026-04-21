const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

const ADMIN_TOKEN_SCOPE = "admin";
const STAFF_TOKEN_SCOPE = "hotel_staff";

function signAdminToken(adminUser) {
  return jwt.sign(
    {
      sub: adminUser.id,
      scope: ADMIN_TOKEN_SCOPE,
      email: adminUser.email,
      fullName: adminUser.full_name || ""
    },
    env.jwtSecret,
    {
      expiresIn: env.jwtExpiresIn
    }
  );
}

function verifyAdminToken(token) {
  const decoded = jwt.verify(token, env.jwtSecret);

  if (decoded.scope && decoded.scope !== ADMIN_TOKEN_SCOPE) {
    throw new Error("Invalid admin token scope");
  }

  return decoded;
}

function signStaffToken(staffAccess) {
  const staffId = String(staffAccess?.id || "").trim();
  const hotelSlug = String(
    staffAccess?.hotel_slug || staffAccess?.hotelSlug || ""
  ).trim();
  const role = String(staffAccess?.role || "staff").trim().toLowerCase();

  if (!staffId || !hotelSlug) {
    throw new Error("Staff token requires staff id and hotel slug");
  }

  return jwt.sign(
    {
      sub: staffId,
      scope: STAFF_TOKEN_SCOPE,
      hotelSlug,
      displayName: staffAccess.display_name || staffAccess.displayName || "Staff",
      role: role === "owner" ? "owner" : "staff"
    },
    env.jwtSecret,
    {
      expiresIn: env.jwtExpiresIn
    }
  );
}

function verifyStaffToken(token) {
  const decoded = jwt.verify(token, env.jwtSecret);

  if (decoded.scope !== STAFF_TOKEN_SCOPE || !decoded.hotelSlug) {
    throw new Error("Invalid staff token scope");
  }

  return decoded;
}

module.exports = {
  signAdminToken,
  verifyAdminToken,
  signStaffToken,
  verifyStaffToken,
  ADMIN_TOKEN_SCOPE,
  STAFF_TOKEN_SCOPE
};
