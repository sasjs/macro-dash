/* Macro Dash dev environment setup.
 *
 * Downloads a local @sasjs/server binary (GitHub releases), writes a .env
 * (desktop mode, JS runtime - no SAS installation needed), starts it,
 * then deploys the app (sasjs cbd -t local) and the JS mocks.
 *
 * Idempotent: existing downloads/.env are kept, a running server is reused.
 *
 * Usage: npm run devsetup
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "tools", "sasjs-server");
const PORT = process.env.PORT || 5000;
const SERVER_URL = "http://localhost:" + PORT;

const PLATFORM_ZIP = { linux: "linux.zip", darwin: "macos.zip", win32: "windows.zip" };
const PLATFORM_BIN = { linux: "./api-linux", darwin: "./api-macos", win32: "api-win.exe" };

function log(msg) { console.log("[devsetup]", msg); }

function download(url, dest) {
  execSync(`curl -sL -o "${dest}" "${url}"`, { stdio: "inherit" });
}

async function waitForServer(url, tries) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url + "/SASjsApi/info");
      if (res.ok) return true;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  const zip = PLATFORM_ZIP[os.platform()];
  const bin = PLATFORM_BIN[os.platform()];
  if (!zip) throw new Error("unsupported platform: " + os.platform());

  fs.mkdirSync(SERVER_DIR, { recursive: true });

  // 1. binary
  const binPath = path.join(SERVER_DIR, bin.replace("./", ""));
  if (!fs.existsSync(binPath)) {
    log("downloading @sasjs/server (" + zip + ") ...");
    const zipPath = path.join(SERVER_DIR, zip);
    download("https://github.com/sasjs/server/releases/latest/download/" + zip, zipPath);
    if (os.platform() === "win32") {
      execSync(`powershell -command "Expand-Archive -Force '${zipPath}' '${SERVER_DIR}'"`, { stdio: "inherit" });
    } else {
      execSync(`unzip -o -q "${zipPath}" -d "${SERVER_DIR}"`, { stdio: "inherit" });
      fs.chmodSync(binPath, 0o755);
    }
  } else {
    log("server binary already present, skipping download");
  }

  // 2. .env (don't clobber local edits)
  const envPath = path.join(SERVER_DIR, ".env");
  if (!fs.existsSync(envPath)) {
    const nodePath = process.execPath;
    fs.writeFileSync(envPath, [
      "MODE=desktop",
      "PROTOCOL=http",
      "PORT=" + PORT,
      "RUN_TIMES=js",
      "NODE_PATH=" + nodePath,
      "CORS=enable",
      "WHITELIST=http://localhost:8000 http://localhost:8124",
      ""
    ].join("\n"));
    log("wrote " + envPath);
  }

  // 3. start server (unless already running)
  let started = false;
  if (!(await waitForServer(SERVER_URL, 2))) {
    log("starting server ...");
    const out = fs.openSync(path.join(SERVER_DIR, "server.log"), "a");
    const child = spawn(bin, [], {
      cwd: SERVER_DIR,
      stdio: ["ignore", out, out],
      detached: true,
      // a globally-set NODE_OPTIONS breaks the bundled node runtime
      env: { ...process.env, NODE_OPTIONS: "" }
    });
    child.unref();
    started = true;
  }
  if (!(await waitForServer(SERVER_URL, 30))) {
    throw new Error("server did not come up - see " + path.join(SERVER_DIR, "server.log"));
  }
  log("server is up at " + SERVER_URL + (started ? "" : " (already running)"));

  // 4. deploy app + mocks
  log("deploying app (sasjs cbd -t local) ...");
  execSync("sasjs cbd -t local", { cwd: ROOT, stdio: "inherit" });
  log("deploying mocks ...");
  execSync("node scripts/deploy-mocks.js " + SERVER_URL, { cwd: ROOT, stdio: "inherit" });

  log("done!  Play at " + SERVER_URL + "/AppStream/MacroDash/");
}

main().catch((e) => { console.error("[devsetup] ERROR:", e.message); process.exit(1); });
