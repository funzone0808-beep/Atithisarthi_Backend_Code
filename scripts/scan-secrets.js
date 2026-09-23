"use strict";

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const excludedDirectories = new Set([".git", "node_modules", ".wrangler"]);
const excludedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".jfif", ".gif", ".ico"]);
const detectors = [
  ["private-key-material", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["postgres-connection-url", /postgres(?:ql)?:\/\/[^\s"']+/i],
  ["razorpay-live-key-id", /rzp_live_[A-Za-z0-9]+/],
  ["jwt-like-token", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["assigned-secret", /(?:SUPABASE_SERVICE_ROLE_KEY|JWT_SECRET|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET|SMTP_PASS|CLOUDFLARE_API_TOKEN|RAILWAY_TOKEN)\s*=\s*[^\s#]+/i]
];

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, output);
    else if (!excludedExtensions.has(path.extname(entry.name).toLowerCase())) output.push(absolute);
  }
  return output;
}

const findings = [];
for (const file of walk(projectRoot)) {
  let content;
  try { content = fs.readFileSync(file, "utf8"); } catch { continue; }
  content.split(/\r?\n/).forEach((line, index) => {
    for (const [detector, pattern] of detectors) {
      if (!pattern.test(line)) continue;
      pattern.lastIndex = 0;
      const isExample = /(?:your_|replace|changeme|example|redacted|<[^>]+>)/i.test(line);
      const isIgnoredLocalEnv = /(?:^|[\\/])\.env$/i.test(file);
      findings.push({
        detector,
        file: path.relative(projectRoot, file).replace(/\\/g, "/"),
        line: index + 1,
        status: isExample ? "placeholder/example" : isIgnoredLocalEnv ? "ignored-local-env-review-rotation" : "manual-review"
      });
    }
  });
}

for (const finding of findings) {
  console.log(`${finding.status} ${finding.detector} ${finding.file}:${finding.line}`);
}
console.log(`Secret scan completed with ${findings.length} metadata-only findings; matched values were not printed.`);
if (findings.some((finding) => finding.status === "manual-review")) process.exitCode = 1;
