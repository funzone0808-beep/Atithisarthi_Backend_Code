const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const staffRoutesPath = path.join(projectRoot, "backend", "routes", "staff.js");
const staffAuthMiddlewarePath = path.join(projectRoot, "backend", "middleware", "require-staff-auth.js");
const staffOrdersFrontendPath = path.join(projectRoot, "frontend", "js", "staff-orders.js");

function readFileOrExit(filePath, label) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    console.log(`Staff billing permission check failed: could not read ${label}.`);
    console.log(error.message || String(error));
    process.exit(1);
  }
}

function hasPattern(content, pattern) {
  return pattern.test(content);
}

function main() {
  const staffRoutesSource = readFileOrExit(staffRoutesPath, "backend staff routes");
  const staffAuthSource = readFileOrExit(staffAuthMiddlewarePath, "staff auth middleware");
  const staffOrdersSource = readFileOrExit(staffOrdersFrontendPath, "staff orders frontend");
  const failures = [];

  const protectedRouteChecks = [
    {
      label: "mark-billed route",
      pattern: /router\.patch\(\s*"\/orders\/:id\/mark-billed",\s*requireStaffAuth,\s*requireStaffManagerAccess,\s*async\s*\(req,\s*res\)\s*=>/m
    },
    {
      label: "mark-paid route",
      pattern: /router\.patch\(\s*"\/orders\/:id\/mark-paid",\s*requireStaffAuth,\s*requireStaffManagerAccess,\s*async\s*\(req,\s*res\)\s*=>/m
    },
    {
      label: "mark-family-billed route",
      pattern: /router\.patch\(\s*"\/orders\/:id\/mark-family-billed",\s*requireStaffAuth,\s*requireStaffManagerAccess,\s*async\s*\(req,\s*res\)\s*=>/m
    },
    {
      label: "mark-family-paid route",
      pattern: /router\.patch\(\s*"\/orders\/:id\/mark-family-paid",\s*requireStaffAuth,\s*requireStaffManagerAccess,\s*async\s*\(req,\s*res\)\s*=>/m
    }
  ];

  protectedRouteChecks.forEach((check) => {
    if (!hasPattern(staffRoutesSource, check.pattern)) {
      failures.push(`${check.label} is not protected by requireStaffManagerAccess`);
    }
  });

  if (
    !hasPattern(
      staffAuthSource,
      /message:\s*"Manager access is required for this staff section"/m
    )
  ) {
    failures.push("manager-access middleware message is missing or changed unexpectedly");
  }

  if (!hasPattern(staffOrdersSource, /const\s+canManageBilling\s*=\s*isStaffManagerSession\(\);/m)) {
    failures.push("staff orders frontend is missing the manager-session billing gate");
  }

  if (!hasPattern(staffOrdersSource, /const\s+billingActionButtons\s*=\s*canManageBilling/m)) {
    failures.push("staff orders frontend no longer gates billing action buttons behind canManageBilling");
  }

  if (failures.length) {
    console.log("Staff billing permission check failed.");
    failures.forEach((failure) => {
      console.log(`- ${failure}`);
    });
    process.exit(1);
  }

  console.log("Staff billing permission guard looks ready.");
  console.log("Verified manager-only protection for billed/paid and family billed/paid actions.");
  console.log("Verified manager-session UI gating for money-state buttons in the staff orders page.");
}

main();
