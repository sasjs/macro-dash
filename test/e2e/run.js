/* Runs every test/e2e/*.test.js in sequence, collecting pass/fail.  Exits
 * non-zero if any test fails.  Assumes the local SASjs Server is up and the
 * app + mocks are deployed (`npm run devsetup` does both).
 *
 * Usage: node test/e2e/run.js
 *        MD_APP=http://localhost:5000/AppStream/MacroDash/ node test/e2e/run.js */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const dir = __dirname;
const tests = fs.readdirSync(dir)
  .filter(f => f.endsWith(".test.js"))
  .sort();

// the no-backend SRC build is served by `npm start` (python http.server on :8123)
// - start it if not already up
const SRC_URL = process.env.MD_SRC || "http://localhost:8123/index.html";
try { execSync(`curl -s -o /dev/null "${SRC_URL}"`, { stdio: "ignore", timeout: 3000 }); }
catch (e) {
  console.log("[run] starting the no-backend SRC server (python http.server :8123) ...");
  const src = path.join(__dirname, "..", "..", "src");
  const out = fs.openSync(path.join(__dirname, "src-server.log"), "w");
  const child = require("child_process").spawn("python3", ["-m", "http.server", "8123"], { cwd: src, stdio: ["ignore", out, out], detached: true });
  child.unref();
  execSync(`for i in 1..10; do curl -s -o /dev/null "${SRC_URL}" && break; sleep 0.5; done`, { stdio: "inherit" });
}

let failed = 0;
for (const t of tests) {
  console.log("\n=== " + t + " ===");
  try {
    execSync(`node ${path.join(dir, t)}`, { stdio: "inherit", env: process.env });
  } catch (e) {
    failed++;
    console.log("  (exited " + e.status + ")");
  }
}

console.log("\n==================");
console.log(failed === 0
  ? "ALL E2E TESTS PASSED (" + tests.length + " suites)"
  : failed + " / " + tests.length + " e2e suites FAILED");
process.exit(failed ? 1 : 0);
