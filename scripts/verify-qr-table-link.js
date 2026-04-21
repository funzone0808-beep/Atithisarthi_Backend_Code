function usage() {
  console.log("Usage: node scripts/verify-qr-table-link.js \"menu.html?hotel=hotel-example&table=T5&source=qr\"");
}

function normalizeValue(value = "") {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
}

function main() {
  const rawUrl = process.argv[2];

  if (!rawUrl) {
    usage();
    process.exit(1);
  }

  const url = new URL(rawUrl, "https://example.local/");
  const page = url.pathname.split("/").pop() || "index.html";
  const hotelSlug = normalizeValue(url.searchParams.get("hotel"));
  const tableNumber = normalizeValue(
    url.searchParams.get("table") || url.searchParams.get("tableNumber")
  );
  const source = normalizeValue(url.searchParams.get("source")) || "qr";

  const errors = [];
  if (!["menu.html", "index.html"].includes(page)) {
    errors.push("Page must be menu.html or index.html.");
  }
  if (page === "index.html" && url.hash !== "#menu") {
    errors.push("Homepage QR links must include #menu.");
  }
  if (!hotelSlug) {
    errors.push("Missing hotel query parameter.");
  }
  if (!tableNumber) {
    errors.push("Missing table or tableNumber query parameter.");
  }

  if (errors.length) {
    console.error("QR table link is not ready:");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  console.log("QR table link looks ready.");
  console.log(`Hotel: ${hotelSlug}`);
  console.log(`Table: ${tableNumber}`);
  console.log(`Source: ${source}`);
  console.log(`Page: ${page}`);
}

try {
  main();
} catch (error) {
  console.error(`QR table link is not valid: ${error.message}`);
  process.exit(1);
}
