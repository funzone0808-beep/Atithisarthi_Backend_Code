const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const staffRoutesPath = path.join(projectRoot, "backend", "routes", "staff.js");
const staffOrdersHtmlPath = path.join(projectRoot, "frontend", "staff-orders.html");
const staffOrdersJsPath = path.join(projectRoot, "frontend", "js", "staff-orders.js");

function readFileOrExit(filePath, label) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    console.log(`Staff reports module verification failed: could not read ${label}.`);
    console.log(error.message || String(error));
    process.exit(1);
  }
}

function hasPattern(content, pattern) {
  return pattern.test(content);
}

function runChecks({ label, source, checks, failures }) {
  checks.forEach((check) => {
    if (!hasPattern(source, check.pattern)) {
      failures.push(`${label}: ${check.label}`);
    }
  });
}

function main() {
  const staffRoutesSource = readFileOrExit(staffRoutesPath, "backend staff routes");
  const staffOrdersHtmlSource = readFileOrExit(staffOrdersHtmlPath, "staff orders html");
  const staffOrdersJsSource = readFileOrExit(staffOrdersJsPath, "staff orders javascript");
  const failures = [];

  runChecks({
    label: "backend",
    source: staffRoutesSource,
    failures,
    checks: [
      {
        label: "business report route is staff-manager protected",
        pattern:
          /router\.get\(\s*"\/reports\/business",\s*requireStaffAuth,\s*requireStaffManagerAccess,\s*async\s*\(req,\s*res\)\s*=>/m
      },
      {
        label: "business report uses staff hotel scope",
        pattern: /const\s+hotelSlug\s*=\s*String\(req\.staffHotelSlug\s*\|\|\s*""\)\.trim\(\);/m
      },
      {
        label: "business report query filters by hotel slug",
        pattern: /\.from\("orders"\)[\s\S]*\.eq\("hotel_slug",\s*hotelSlug\)/m
      },
      {
        label: "custom report period parser is present",
        pattern: /function\s+getStaffReportPeriod\(query\s*=\s*\{\}\)/m
      },
      {
        label: "report row cap is present",
        pattern: /const\s+STAFF_BUSINESS_REPORT_MAX_ORDERS\s*=\s*5000;/m
      },
      {
        label: "customer phones are masked",
        pattern: /function\s+maskStaffReportPhone\(value\s*=\s*""\)/m
      },
      {
        label: "staff performance report is present",
        pattern: /function\s+buildStaffPerformanceReport\(orders\s*=\s*\[\],\s*staffById\s*=\s*new Map\(\)\)/m
      },
      {
        label: "combo report fields are included",
        pattern: /topCombos:\s*comboSales\.topItems\.slice\(0,\s*STAFF_BUSINESS_REPORT_ITEM_LIMIT\)/m
      }
    ]
  });

  runChecks({
    label: "frontend html",
    source: staffOrdersHtmlSource,
    failures,
    checks: [
      {
        label: "reports sidebar tab exists",
        pattern: /data-staff-view="reports"[^>]*>[\s\S]*?<span class="staff-sidebar-nav-label">Reports<\/span>[\s\S]*?<\/button>/m
      },
      {
        label: "reports panel exists",
        pattern: /id="staffReportsPanel"[\s\S]*data-staff-view-panel="reports"/m
      },
      {
        label: "reports range filter exists",
        pattern: /id="staffReportsRangeInput"/m
      },
      {
        label: "month-wise filter exists",
        pattern: /<option value="month_select">Month Wise<\/option>/m
      },
      {
        label: "custom date range filter exists",
        pattern: /<option value="custom">Custom Date Range<\/option>/m
      },
      {
        label: "export pdf button exists",
        pattern: /id="staffReportsPrintBtn"[\s\S]*Export PDF/m
      }
    ]
  });

  runChecks({
    label: "frontend js",
    source: staffOrdersJsSource,
    failures,
    checks: [
      {
        label: "reports is manager-only view",
        pattern: /const\s+STAFF_MANAGER_VIEWS\s*=\s*\[[\s\S]*"reports"[\s\S]*\];/m
      },
      {
        label: "basic staff views do not include reports",
        pattern: /const\s+STAFF_BASIC_VIEWS\s*=\s*\[(?:(?!"reports")[\s\S])*?\];/m
      },
      {
        label: "reports API loader exists",
        pattern: /async\s+function\s+loadStaffBusinessReport\(\{\s*silent\s*=\s*false\s*\}\s*=\s*\{\}\)/m
      },
      {
        label: "reports endpoint is called",
        pattern: /staffFetchJson\(`\$\{STAFF_API_BASE\}\/reports\/business\?\$\{params\.toString\(\)\}`\)/m
      },
      {
        label: "custom query params are built",
        pattern: /function\s+getStaffBusinessReportQueryParams\(\)/m
      },
      {
        label: "reports render function exists",
        pattern: /function\s+renderStaffBusinessReport\(report\s*=\s*STAFF_STATE\.businessReport\)/m
      },
      {
        label: "print export document exists",
        pattern: /function\s+buildStaffReportPrintDocument\(report\s*=\s*STAFF_STATE\.businessReport\)/m
      },
      {
        label: "reports loads when view opens",
        pattern: /if\s*\(nextView\s*===\s*"reports"\s*&&\s*!STAFF_STATE\.businessReportLoaded\)\s*\{[\s\S]*loadStaffBusinessReport\(\)/m
      }
    ]
  });

  if (failures.length) {
    console.log("Staff reports module verification failed.");
    failures.forEach((failure) => {
      console.log(`- ${failure}`);
    });
    process.exit(1);
  }

  console.log("Staff reports module looks ready.");
  console.log("Verified manager-only reports view, hotel-scoped backend route, filters, rendering, and print/PDF export wiring.");
}

main();
