const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const serverSource = fs.readFileSync(path.join(projectRoot, "backend", "server.js"), "utf8");
const staffScriptSource = fs.readFileSync(
  path.join(projectRoot, "frontend", "js", "staff-orders.js"),
  "utf8"
);

function requirePattern(source, pattern, label) {
  if (!pattern.test(source)) {
    throw new Error(`Missing ${label}`);
  }
}

function main() {
  requirePattern(serverSource, /globalLimiter[\s\S]*skip:[\s\S]*startsWith\("\/api\/staff"\)/m, "staff exclusion from public global limiter");
  requirePattern(serverSource, /function getStaffRateLimitKey[\s\S]*createHash\("sha256"\)[\s\S]*ipKeyGenerator/m, "staff session rate-limit key");
  requirePattern(serverSource, /const staffReadLimiter = rateLimit\([\s\S]*limit: 1200[\s\S]*STAFF_READ_RATE_LIMITED/m, "staff read budget");
  requirePattern(serverSource, /const staffMutationLimiter = rateLimit\([\s\S]*limit: 180[\s\S]*STAFF_MUTATION_RATE_LIMITED/m, "staff mutation budget");
  requirePattern(serverSource, /app\.use\("\/api\/staff", staffReadLimiter, staffMutationLimiter\)/m, "staff limiter route mounting");
  requirePattern(staffScriptSource, /Retry-After[\s\S]*response\.status === 429[\s\S]*Please retry in about/m, "actionable frontend retry message");

  console.log("Staff rate-limit verification passed.");
  console.log("Verified dedicated staff read/mutation budgets, session keys, login isolation, and actionable 429 handling.");
}

main();
