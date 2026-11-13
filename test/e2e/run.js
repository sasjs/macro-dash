/* Runs every test/e2e/*.test.js in sequence, collecting pass/fail.  Exits
 * non-zero if any test fails.
 *
 * The backend is the app's own mocked build: `npm run mock:build` writes
 * sasjsbuild/mock, a static site whose service worker answers /SASjsApi/*
 * from @sasjs/api.  This runner serves that folder with python's http.server
 * and points the suite at it - no SAS, no @sasjs/server, no devsetup.
 *
 * The no-backend case is covered too: src/ is served separately and the tests
 * that exercise localStorage mode use it.
 *
 * Usage: node test/e2e/run.js
 *        MD_APP=http://localhost:5000/AppStream/MacroDash/ node test/e2e/run.js
 *                                                    (to point at a real server)
 */
"use strict";
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");

const dir = __dirname;
const tests = fs.readdirSync(dir)
  .filter(f => f.endsWith(".test.js"))
  .sort();

const srcDir = path.join(dir, "..", "..", "src");
const mockDir = path.join(dir, "..", "..", "sasjsbuild", "mock");

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function answers(port, p) {
  return new Promise(resolve => {
    const req = http.get({ host: "127.0.0.1", port, path: p || "/" }, res => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

async function serve(folder, port) {
  const out = fs.openSync(path.join(os.tmpdir(), "macrodash-e2e-" + port + ".log"), "w");
  const child = spawn("python3", ["-m", "http.server", String(port)], {
    cwd: folder, stdio: ["ignore", out, out], detached: true
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    if (await answers(port, "/index.html")) return child;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error("nothing answering on " + port + " from " + folder);
}

(async () => {
  const children = [];
  try {
    if (!fs.existsSync(path.join(mockDir, "sw.js"))) {
      console.error("[run] sasjsbuild/mock has no sw.js - run `npm run mock:build` first");
      process.exit(1);
    }
    if (!process.env.MD_APP) {
      const port = await freePort();
      children.push(await serve(mockDir, port));
      process.env.MD_APP = "http://localhost:" + port + "/";
      console.log("[run] mocked build served on " + process.env.MD_APP);
    }
    if (!process.env.MD_SRC) {
      const port = await freePort();
      children.push(await serve(srcDir, port));
      process.env.MD_SRC = "http://localhost:" + port + "/index.html";
      console.log("[run] no-backend src served on " + process.env.MD_SRC);
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
    process.exitCode = failed ? 1 : 0;
  } finally {
    for (const c of children) {
      try { process.kill(-c.pid); } catch (e) { try { c.kill(); } catch (e2) {} }
    }
  }
})();
