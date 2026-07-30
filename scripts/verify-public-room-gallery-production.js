"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const html = read("frontend/index.html");
const css = read("frontend/css/style.css");
const js = read("frontend/js/main.js");
const publicRoomsRoute = read("backend/routes/public-room-booking.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertMatch(source, pattern, message) {
  assert(pattern.test(source), message);
}

const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(
  (match) => match[1]
);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);

assert(duplicateIds.length === 0, `Duplicate IDs: ${[...new Set(duplicateIds)].join(", ")}`);
[
  "publicRoomGalleryDialog",
  "publicRoomGalleryTitle",
  "publicRoomGalleryStage",
  "publicRoomGalleryImage",
  "publicRoomGalleryLoading",
  "publicRoomGalleryError",
  "publicRoomGalleryCounter",
  "publicRoomGalleryThumbnails",
  "publicRoomGalleryPrevious",
  "publicRoomGalleryNext",
  "publicRoomGalleryClose",
  "publicRoomGalleryFullscreen",
  "publicRoomGalleryBook"
].forEach((id) => assert(html.includes(`id="${id}"`), `Missing gallery ID ${id}`));

assertMatch(html, /class="public-room-gallery room-gallery"/, "Gallery compatibility class changed.");
assertMatch(html, /aria-modal="true"/, "Gallery modal semantics are missing.");
assertMatch(html, /aria-describedby="publicRoomGalleryCaption"/, "Gallery description binding is missing.");
assertMatch(html, /id="publicRoomGalleryStage"[^>]+aria-busy="true"/, "Gallery busy state is missing.");
assertMatch(html, /Loading room photo…/, "Gallery loading copy is missing.");
assertMatch(html, /This room photo could not be loaded\./, "Gallery failure copy is missing.");
assertMatch(html, /id="publicRoomGalleryThumbnails"[^>]+role="listbox"/, "Thumbnail list semantics are missing.");
assertMatch(html, /id="publicRoomGalleryImage"[^>]+loading="eager"[^>]+fetchpriority="high"/, "Clicked image priority is missing.");

const hardeningStart = css.indexOf("PUBLIC ROOM GALLERY PRODUCTION HARDENING");
const hardeningEnd = css.indexOf("PUBLIC FRONTEND MOTION SAFETY", hardeningStart);
assert(hardeningStart >= 0 && hardeningEnd > hardeningStart, "Gallery hardening CSS is missing.");
const galleryCss = css.slice(hardeningStart, hardeningEnd);
assertMatch(galleryCss, /width:\s*min\(1180px,\s*calc\(100vw - 40px\)\)/, "Desktop gallery width is not viewport-safe.");
assertMatch(galleryCss, /height:\s*min\(900px,\s*calc\(100dvh - 40px\)\)/, "Desktop gallery height is not viewport-safe.");
assertMatch(galleryCss, /\.room-gallery__image[\s\S]*?object-fit:\s*contain/, "Main room image must use object-fit contain.");
assertMatch(galleryCss, /env\(safe-area-inset-top\)/, "Mobile safe-area support is missing.");
assertMatch(galleryCss, /@media\s*\(max-width:\s*700px\)/, "Mobile gallery breakpoint is missing.");
assertMatch(galleryCss, /@media\s*\(max-height:\s*560px\)\s*and\s*\(orientation:\s*landscape\)/, "Short landscape layout is missing.");
assertMatch(galleryCss, /prefers-reduced-motion:\s*reduce/, "Reduced-motion support is missing.");
assert(!/z-index:\s*[1-9]\d{4,}/.test(galleryCss), "Gallery uses an arbitrary extreme z-index.");
assert(!/object-fit:\s*cover/.test(galleryCss.match(/\.room-gallery__image[\s\S]*?\}/)?.[0] || ""), "Main room image is cropped.");

assertMatch(js, /const PUBLIC_ROOM_GALLERY_STATE = \{[\s\S]*?scrollSnapshot:[\s\S]*?preloadedUrls:\s*new Set\(\)/, "Reusable gallery state is incomplete.");
assertMatch(js, /function normalizePublicRoomImageUrl[\s\S]*?\^\[a-z\]\[a-z0-9\+\.\-\]\*:/, "Frontend gallery URL scheme guard is missing.");
assertMatch(js, /function lockPublicRoomGalleryScroll[\s\S]*?body\.style\.position = "fixed"/, "Background scroll lock is missing.");
assertMatch(js, /function unlockPublicRoomGalleryScroll[\s\S]*?window\.scrollTo\(snapshot\.scrollX, snapshot\.scrollY\)/, "Exact scroll restoration is missing.");
assertMatch(js, /function trapPublicRoomGalleryFocus[\s\S]*?event\.key !== "Tab"/, "Gallery focus trap is missing.");
assertMatch(js, /event\.key === "ArrowLeft"[\s\S]*?event\.key === "ArrowRight"/, "Keyboard image navigation is missing.");
assertMatch(js, /dialog\.addEventListener\("cancel"[\s\S]*?closePublicRoomGallery/, "Escape close handling is missing.");
assertMatch(js, /stage\?\.addEventListener\([\s\S]*?"touchstart"[\s\S]*?"touchend"/, "Stage-scoped swipe handling is missing.");
assertMatch(js, /Math\.abs\(deltaX\) > Math\.abs\(deltaY\) \* 1\.2/, "Swipe direction guard is missing.");
assertMatch(js, /function preloadPublicRoomGalleryAdjacentImages[\s\S]*?navigator\.connection\?\.saveData/, "Save-data-aware adjacent preload is missing.");
assertMatch(js, /keepPublicRoomGalleryThumbnailVisible[\s\S]*?scrollIntoView/, "Active thumbnail visibility is missing.");
assertMatch(js, /images\.every\(\(item\) => item\.hasOptimizedThumbnail\)/, "Original images may be used as thumbnails.");
assertMatch(js, /thumbnails\.hidden = !canUseThumbnailStrip/, "Single-image or unoptimized thumbnail simplification is missing.");
assertMatch(js, /previous\.disabled = images\.length < 2[\s\S]*?next\.disabled = images\.length < 2/, "Single-image navigation controls are not disabled.");
assertMatch(js, /dialog\.dataset\.bound === "true"[\s\S]*?dialog\.dataset\.bound = "true"/, "One-instance binding guard is missing.");
assertMatch(js, /thumbnails\?\.addEventListener\("click"/, "Delegated thumbnail interaction is missing.");
assertMatch(js, /image\?\.addEventListener\("load", handlePublicRoomGalleryImageLoaded\)/, "Gallery loading completion is missing.");
assertMatch(js, /showPublicRoomGalleryImageError\(\)/, "Gallery final image error state is missing.");
assertMatch(js, /closePublicRoomGallery\(\{ returnFocus: false \}\)[\s\S]*?openPublicRoomBookingForm\(room\)/, "Existing booking handoff changed.");
assertMatch(js, /PUBLIC_ROOM_GALLERY_STATE\.trigger\?\.focus\?\.\(\)/, "Trigger focus return is missing.");
assert(!/setInterval[\s\S]{0,500}PublicRoomGallery/i.test(js), "Gallery autoplay is not allowed.");

const gallerySlice = js.slice(
  js.indexOf("const PUBLIC_ROOM_GALLERY_STATE"),
  js.indexOf("function getPublicRoomAmenities")
);
assert(!/reset\(/.test(gallerySlice), "Gallery must not reset booking forms.");
assert(!/loadPublicRooms|fetchPublicRooms|submitPublicRoomBooking/.test(gallerySlice), "Gallery must not refetch or submit booking state.");

assertMatch(publicRoomsRoute, /\.eq\("hotel_slug", hotelSlug\)\.eq\("is_active", true\)/, "Managed room images are not hotel-scoped and active-only.");
assertMatch(publicRoomsRoute, /return \["http:", "https:"\]\.includes\(parsed\.protocol\)/, "Backend public image scheme filter is missing.");
assertMatch(publicRoomsRoute, /room_images[\s\S]*?thumbnail_url/, "Optimized thumbnail response is missing.");

console.log("Public room gallery production verification passed.");
console.log(
  JSON.stringify(
    {
      htmlBytes: Buffer.byteLength(html),
      cssBytes: Buffer.byteLength(css),
      jsBytes: Buffer.byteLength(js),
      ids: ids.length,
      galleryImportantCount: (galleryCss.match(/!important/g) || []).length,
      galleryExtremeZIndexCount: (galleryCss.match(/z-index:\s*[1-9]\d{4,}/g) || []).length
    },
    null,
    2
  )
);
