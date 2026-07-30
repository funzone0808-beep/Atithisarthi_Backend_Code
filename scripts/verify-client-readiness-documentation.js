const fs = require("fs");
const path = require("path");

const scriptsDir = __dirname;
const audit = fs.readFileSync(path.join(scriptsDir, "FULL-SAAS-CLIENT-READINESS-AUDIT.md"), "utf8");
const runbook = fs.readFileSync(path.join(scriptsDir, "FIRST-CLIENT-OPERATIONS-RUNBOOK.md"), "utf8");

function requireText(source, text, label) {
  if (!source.includes(text)) throw new Error("Missing " + label + ": " + text);
}

[
  ["NO-GO for unrestricted production", "honest launch decision"],
  ["## 6. Public room-gallery production hardening", "gallery assessment"],
  ["## 7. Financial correctness evidence", "finance assessment"],
  ["## 8. Security assessment", "security assessment"],
  ["## 10. Backup, recovery, and continuity", "backup assessment"],
  ["## 13. Performance and scale", "performance assessment"],
  ["## 16. Severity register", "P0-P4 register"],
  ["## 20. Files changed by this audit", "change inventory"],
  ["## 21. Rollback plan", "rollback plan"],
  ["## 22. Launch gate and freeze rule", "freeze rule"],
  ["Do not freeze the product based on this audit.", "no premature freeze"]
].forEach(([text, label]) => requireText(audit, text, label));

[
  ["## 4. Backup and restore drill", "restore drill"],
  ["## 5. Core release smoke", "release smoke"],
  ["## 6. Finance and end-of-day", "financial operations"],
  ["## 7. Monitoring and alert drill", "alert drill"],
  ["## 8. Performance acceptance", "performance acceptance"],
  ["## 9. Training and acceptance", "training"],
  ["## 11. Incident and rollback", "incident rollback"],
  ["## 12. Final authorization", "authorization"]
].forEach(([text, label]) => requireText(runbook, text, label));

console.log("Client readiness documentation verification: PASS");
console.log(JSON.stringify({
  auditSections: (audit.match(/^## /gm) || []).length,
  auditBytes: Buffer.byteLength(audit),
  runbookSections: (runbook.match(/^## /gm) || []).length,
  runbookBytes: Buffer.byteLength(runbook)
}));
