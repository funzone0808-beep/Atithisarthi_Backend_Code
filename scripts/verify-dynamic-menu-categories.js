"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const {
  GLOBAL_MENU_IMAGE,
  buildEligibleCategoryDtos,
  createMenuVersion,
  resolveMenuItemDisplayImage
} = require("../utils/menu-categories");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const exists = (relativePath) => fs.existsSync(path.join(ROOT, relativePath));

function buildScaleFixture(categoryCount, itemCount) {
  const categories = Array.from({ length: categoryCount }, (_, index) => ({
    id: index + 1,
    category_key: `category-${index + 1}`,
    name: `Category ${index + 1}`,
    slug: `category-${index + 1}`,
    display_order: index,
    is_active: true,
    is_published: true,
    staff_enabled: true,
    website_enabled: true,
    qr_enabled: true,
    default_image_url: index % 3 === 0 ? `/img/category-${index + 1}.webp` : "",
    image_version: 1
  }));
  const items = Array.from({ length: itemCount }, (_, index) => ({
    item_id: `item-${index + 1}`,
    category: categories[index % categoryCount].category_key,
    price: (index % 50) + 1,
    sort_order: index,
    image: index % 4 === 0 ? `/img/item-${index + 1}.webp` : ""
  }));
  return { categories, items };
}

function verifyImageHierarchy() {
  const category = {
    defaultImage: {
      cardUrl: "/img/category-food.webp",
      thumbnailUrl: "/img/category-food-thumb.webp"
    }
  };
  const itemImage = resolveMenuItemDisplayImage(
    { name: "Paneer Tikka", image: "/img/paneer.webp" },
    category
  );
  assert.equal(itemImage.source, "item");
  assert.equal(itemImage.url, "/img/paneer.webp");
  assert.equal(itemImage.categoryFallbackUrl, "/img/category-food.webp");

  const categoryImage = resolveMenuItemDisplayImage({ name: "Paneer Tikka", image: "" }, category);
  assert.equal(categoryImage.source, "category");
  assert.equal(categoryImage.url, "/img/category-food.webp");

  const globalImage = resolveMenuItemDisplayImage({ name: "Paneer Tikka", image: "" }, null);
  assert.equal(globalImage.source, "global");
  assert.equal(globalImage.url, GLOBAL_MENU_IMAGE.cardUrl);

  const unsafeImage = resolveMenuItemDisplayImage(
    { name: "Unsafe", image: "javascript:alert(1)" },
    null
  );
  assert.equal(unsafeImage.url, GLOBAL_MENU_IMAGE.cardUrl);
}

function verifyScale() {
  const scenarios = [
    [5, 25],
    [10, 100],
    [25, 300],
    [20, 250],
    [30, 500],
    [50, 1000]
  ];
  return scenarios.map(([categoryCount, itemCount]) => {
    const fixture = buildScaleFixture(categoryCount, itemCount);
    const startedAt = performance.now();
    const categories = buildEligibleCategoryDtos(fixture.categories, fixture.items, { hideEmpty: true });
    const resolvedItems = fixture.items.map((item) => {
      const category = categories.find((entry) => entry.key === item.category);
      return { ...item, imageMeta: resolveMenuItemDisplayImage(item, category) };
    });
    const menuVersion = createMenuVersion({ categories, items: resolvedItems });
    const durationMs = performance.now() - startedAt;
    assert.equal(categories.length, categoryCount);
    assert.equal(resolvedItems.length, itemCount);
    assert.equal(new Set(resolvedItems.map((item) => item.item_id)).size, itemCount);
    assert.match(menuVersion, /^[a-f0-9]{16}$/);
    assert.ok(durationMs < 250, `Scale normalization exceeded 250 ms: ${durationMs.toFixed(2)} ms`);
    return { categoryCount, itemCount, durationMs: Number(durationMs.toFixed(2)) };
  });
}

function verifySourceContracts() {
  const indexHtml = read("frontend/index.html");
  const menuHtml = read("frontend/menu.html");
  const dataLoader = read("frontend/js/data-loader.js");
  const mainJs = read("frontend/js/main.js");
  const staffJs = read("frontend/js/staff-orders.js");
  const publicRoute = read("backend/routes/public.js");
  const staffRoute = read("backend/routes/staff.js");
  const adminRoute = read("backend/routes/admin.js");
  const adminJs = read("frontend/js/admin.js");
  const snapshotUtil = read("backend/utils/order-item-snapshots.js");
  const migration = read("backend/scripts/create-dynamic-menu-categories.sql");

  assert.ok(!/data-cat="(?:starters|mains|desserts|drinks|combos)"/.test(indexHtml));
  assert.ok(!/data-cat="(?:starters|mains|desserts|drinks|combos)"/.test(menuHtml));
  assert.ok(!dataLoader.includes("MENU_CATEGORY_ALIASES"));
  assert.ok(!mainJs.includes("const CATEGORY_LABELS"));
  assert.ok(!mainJs.includes('categories.includes("starters")'));
  assert.ok(mainJs.includes("getMenuCategoryRecords"));
  assert.ok(mainJs.includes("data-category-fallback-src"));
  assert.ok(mainJs.includes("data-global-fallback-src"));
  assert.ok(mainJs.includes("data-format-fallback-src"));
  assert.ok(mainJs.includes("isFrontendWorkspacePreview"));
  assert.ok(mainJs.includes('grid.insertAdjacentHTML("beforeend", cardsMarkup)'));
  assert.ok(mainJs.includes('loading="${priority ? "eager" : "lazy"}"'));
  assert.ok(mainJs.includes("refreshRenderedMenuItem(itemId)"));
  assert.ok(mainJs.includes("window.updateRenderedMenuItem"));
  assert.ok(mainJs.includes("data-menu-item-id"));
  assert.ok(indexHtml.includes('href="img/default-food.v1.webp"'));
  assert.ok(menuHtml.includes('href="img/default-food.v1.webp"'));
  assert.ok(read("frontend/css/style.css").includes("content-visibility: auto"));
  assert.ok(staffJs.includes("tableOrderMenuCategories"));
  assert.ok(publicRoute.includes("categories: visibleCategories"));
  assert.ok(publicRoute.includes("hideEmpty: true"));
  assert.ok(staffRoute.includes("consumer: \"staff\""));
  assert.ok(staffRoute.includes("categories: visibleCategories"));
  assert.ok(adminRoute.includes('router.get("/menu-categories"'));
  assert.ok(adminRoute.includes("ensureAdminMenuCategoryBelongsToHotel"));
  assert.ok(adminRoute.includes("invalidatePublicMenuCache"));
  assert.ok(adminRoute.includes('router.delete("/menu-categories/:id"'));
  assert.ok(adminRoute.includes("This category still has menu items"));
  assert.ok(adminJs.includes("data-delete-menu-category"));
  assert.ok(snapshotUtil.includes("categoryName"));
  assert.ok(migration.includes("idx_menu_items_hotel_category_available_order"));
  assert.ok(migration.includes("uq_menu_categories_active_name_per_hotel"));
  assert.ok(exists("backend/scripts/rollback-dynamic-menu-categories.sql"));
  assert.ok(exists("frontend/img/default-food.v1.webp"));
  assert.ok(exists("frontend/img/default-food.v1.jpg"));
  assert.ok(fs.statSync(path.join(ROOT, "frontend/img/default-food.v1.webp")).size < 150 * 1024);
  assert.ok(migration.includes("name_rank"));
}

function main() {
  verifyImageHierarchy();
  verifySourceContracts();
  const scale = verifyScale();
  console.log(JSON.stringify({
    ok: true,
    checks: {
      dynamicCategorySource: true,
      fixedProductionTabsRemoved: true,
      itemCategoryGlobalFallback: true,
      fallbackRecursionGuard: true,
      publicEmptyCategoriesHidden: true,
      staffCategoryOrder: true,
      safeCategoryDeleteLifecycle: true,
      categorySnapshotsAndReports: true,
      tenantScopedCategoryValidation: true,
      scale
    }
  }, null, 2));
}

main();
