const path = require("path");
const util = require("util");

const scriptsDirectory = __dirname;

const requiredChecks = [
  ["Staff Orders UI", "verify-staff-orders-ui.js"],
  ["Staff billing permissions", "verify-staff-billing-permissions.js"],
  ["Staff reports", "verify-staff-reports-module.js"],
  ["Hotel-wise modules and reporting", "verify-hotel-module-system.js"],
  ["Staff-assisted ordering", "verify-staff-table-ordering.js"],
  ["Take Order home and cart", "verify-staff-take-order-home.js"],
  ["Take Order View Tables flow", "verify-staff-view-tables-flow.js"],
  ["Active table concurrency guard", "verify-staff-active-table-ordering.js"],
  ["Active table Add More Items", "verify-staff-add-more-items-flow.js"],
  ["Staff API rate limits", "verify-staff-rate-limits.js"],
  ["Take Order responsive accessibility", "verify-staff-take-order-responsive.js"],
  ["Take Order KDS and large-menu regressions", "verify-staff-take-order-regressions.js"],
  ["Login page branding and security", "verify-login-page-branding.js"],
  ["Menu combo lifecycle", "verify-menu-combos-flow.js"],
  ["Tenant/domain trust", "verify-tenant-domain-trust.js"]
];

function runScript(scriptName) {
  const scriptPath = path.join(scriptsDirectory, scriptName);
  const stdout = [];
  const stderr = [];
  const originalExit = process.exit;
  const originalExitCode = process.exitCode;
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  };
  const exitSignal = Symbol("release-preflight-exit");
  let error = null;
  let status = 0;

  const capture = (target) => (...args) => {
    target.push(util.format(...args));
  };

  try {
    process.exitCode = 0;
    process.exit = (code = 0) => {
      status = Number.isInteger(code) ? code : 0;
      throw exitSignal;
    };
    console.log = capture(stdout);
    console.info = capture(stdout);
    console.warn = capture(stderr);
    console.error = capture(stderr);

    delete require.cache[require.resolve(scriptPath)];
    require(scriptPath);
    status = Number(process.exitCode || 0);
  } catch (caughtError) {
    if (caughtError !== exitSignal) {
      error = caughtError;
      status = 1;
    }
  } finally {
    process.exit = originalExit;
    process.exitCode = originalExitCode;
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }

  return {
    ok: status === 0 && !error,
    status,
    stdout: stdout.join("\n").trim(),
    stderr: stderr.join("\n").trim(),
    error
  };
}

function printResult(label, result) {
  const marker = result.ok ? "PASS" : "FAIL";
  console.log(`[${marker}] ${label}`);

  if (!result.ok) {
    const output = [result.stdout, result.stderr, result.error?.message]
      .filter(Boolean)
      .join("\n");
    if (output) console.log(output);
  }
}

function main() {
  let failed = false;

  console.log("Staff Orders release preflight");
  console.log("==============================");

  requiredChecks.forEach(([label, scriptName]) => {
    const result = runScript(scriptName);
    printResult(label, result);
    if (!result.ok) failed = true;
  });

  const configuredRuntime = runScript("verify-frontend-runtime-config.js");
  const neutralRuntime = configuredRuntime.ok
    ? null
    : runScript("verify-frontend-runtime-config-neutral.js");
  const sourceSafeRuntime = configuredRuntime.ok || neutralRuntime?.ok
    ? null
    : runScript("verify-frontend-runtime-config-source-safe.js");

  if (configuredRuntime.ok) {
    console.log("[PASS] Frontend runtime mode: explicitly configured");
  } else if (neutralRuntime?.ok) {
    console.log("[PASS] Frontend runtime mode: neutral repository state");
    console.log("[INFO] Neutral mode is suitable for source control but must be configured before deployment.");
  } else if (sourceSafeRuntime?.ok) {
    console.log("[PASS] Frontend runtime mode: source-safe with explicit feature policies");
    console.log("[INFO] No environment URLs are embedded; configure deployment URLs before production.");
  } else {
    failed = true;
    console.log("[FAIL] Frontend runtime mode is mixed or incomplete.");
    console.log("Choose one supported state before release:");
    console.log("- Neutral repository metadata, verified by verify:frontend-runtime-config-neutral");
    console.log("- Source-safe metadata with consistent feature policies, verified by verify:frontend-runtime-config-source-safe");
    console.log("- Explicit environment-specific metadata, verified by verify:frontend-runtime-config");

    const configuredOutput = [configuredRuntime.stdout, configuredRuntime.stderr]
      .filter(Boolean)
      .join("\n");
    const neutralOutput = [neutralRuntime?.stdout, neutralRuntime?.stderr]
      .filter(Boolean)
      .join("\n");
    const sourceSafeOutput = [sourceSafeRuntime?.stdout, sourceSafeRuntime?.stderr]
      .filter(Boolean)
      .join("\n");

    if (configuredOutput) {
      console.log("\nConfigured-mode diagnostics:");
      console.log(configuredOutput);
    }

    if (neutralOutput) {
      console.log("\nNeutral-mode diagnostics:");
      console.log(neutralOutput);
    }

    if (sourceSafeOutput) {
      console.log("\nSource-safe-mode diagnostics:");
      console.log(sourceSafeOutput);
    }
  }

  if (failed) {
    console.log("\nStaff Orders release preflight failed. No files or environment values were changed.");
    process.exit(1);
  }

  console.log("\nStaff Orders offline release preflight passed.");
  console.log("Authenticated responsive and end-to-end QA is still required before production sign-off.");
}

main();
