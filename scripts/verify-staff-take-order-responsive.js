const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const html = fs.readFileSync(path.join(projectRoot, "frontend", "staff-orders.html"), "utf8");
const script = fs.readFileSync(path.join(projectRoot, "frontend", "js", "staff-orders.js"), "utf8");

function requirePattern(source, pattern, label) {
  if (!pattern.test(source)) {
    throw new Error(`Missing ${label}`);
  }
}

function main() {
  requirePattern(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0"/m, "device viewport configuration");
  requirePattern(html, /\.staff-btn\s*\{[\s\S]*?min-height:\s*44px/m, "44px shared button target");
  requirePattern(html, /staff-take-order-table-filter\s*\{[\s\S]*?min-height:\s*44px/m, "44px table filter target");
  requirePattern(html, /staff-table-order-category-pill\s*\{[\s\S]*?min-height:\s*44px/m, "44px category target");
  requirePattern(html, /staff-table-order-qty\s*\{[\s\S]*?grid-template-columns:\s*44px minmax\(44px, 1fr\) 44px/m, "touch-friendly quantity controls");
  requirePattern(html, /@media \(max-width: 760px\)[\s\S]*?staff-take-order-action-grid[\s\S]*?grid-template-columns:\s*1fr/m, "stacked mobile home actions");
  requirePattern(html, /@media \(max-width: 760px\)[\s\S]*?staff-table-order-mobile-bar:not\(\[hidden\]\)[\s\S]*?position:\s*fixed/m, "fixed mobile cart summary");
  requirePattern(html, /staff-table-order-mobile-sheet-content\s*\{[\s\S]*?overflow-y:\s*auto[\s\S]*?overscroll-behavior:\s*contain/m, "scroll-safe mobile cart sheet");
  requirePattern(html, /staff-table-order-category-pills\s*\{[\s\S]*?overflow-x:\s*auto/m, "horizontally scrollable categories");
  requirePattern(html, /@media \(min-width: 761px\)[\s\S]*?staff-table-order-form[\s\S]*?position:\s*sticky/m, "visible desktop cart");
  requirePattern(html, /staff-take-order-table-card-head,[\s\S]*?staff-take-order-table-card-meta[^\{]*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/m, "narrow table-card wrapping");
  requirePattern(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.staff-btn,[\s\S]*?transition:\s*none/m, "reduced-motion control transitions");
  requirePattern(html, /id="staffTableOrderMobileCartBtn"[\s\S]*?aria-haspopup="dialog"[\s\S]*?aria-controls="staffTableOrderMobileSheet"/m, "accessible mobile cart trigger");
  requirePattern(html, /<dialog id="staffTableOrderMobileSheet"[\s\S]*?aria-labelledby="staffTableOrderMobileSheetTitle"/m, "labelled native cart dialog");
  requirePattern(html, /staff-orders-workspace :where\(button, input, select, summary\):focus-visible/m, "visible workspace focus treatment");
  requirePattern(script, /function getStaffPreferredScrollBehavior\(\)[\s\S]*?prefers-reduced-motion: reduce[\s\S]*?"auto"[\s\S]*?"smooth"/m, "motion-aware programmatic scrolling");
  requirePattern(script, /tableOrderMobileSheet\.addEventListener\("close"[\s\S]*?tableOrderMobileCartButton\?\.focus/m, "mobile dialog focus return");

  console.log("Staff Take Order responsive and accessibility verification passed.");
  console.log("Verified mobile stacking, touch targets, sticky cart behavior, scroll-safe dialog, focus return, and reduced-motion support.");
}

main();
