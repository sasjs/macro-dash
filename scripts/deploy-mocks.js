/* Deploys the JS mock services (sasjs/mocks/sasjs/services) to a LOCAL
 * @sasjs/server via the Drive API (desktop mode => no auth needed).
 * The mocks shadow the .sas services because the local server runs with
 * RUN_TIMES=js (Node runtime).
 *
 * Usage: node scripts/deploy-mocks.js [serverUrl] [appLoc]
 */
"use strict";

const fs = require("fs");
const path = require("path");

const serverUrl = process.argv[2] || "http://localhost:5000";
const appLoc = process.argv[3] || "/Public/app/macrodash";
const mocksDir = path.join(__dirname, "..", "sasjs", "mocks", "sasjs", "services");

async function deployFile(filePath, relPath) {
  const drivePath = appLoc + "/services/" + relPath.split(path.sep).join("/");
  const api = serverUrl + "/SASjsApi/drive/file?_filePath=" +
    encodeURIComponent(drivePath);
  const content = fs.readFileSync(filePath);

  // delete first (POST fails if the file exists), then create
  await fetch(api, { method: "DELETE" }).catch(() => {});
  const form = new FormData();
  form.append("file", new Blob([content]), path.basename(filePath));
  const res = await fetch(api, { method: "POST", body: form });
  const body = await res.text();
  if (!res.ok) {
    throw new Error("deploy failed for " + drivePath + ": " + res.status + " " + body);
  }
  console.log("deployed", drivePath);
}

async function walk(dir, rel) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const r = rel ? rel + "/" + entry.name : entry.name;
    if (entry.isDirectory()) await walk(full, r);
    else if (entry.name.endsWith(".js")) await deployFile(full, r);
  }
}

/* after a redeploy the streamed index.html is stamped configured="false"
 * again - if the mock settings say we ARE configured, re-stamp it */
async function restampIfConfigured() {
  const settingsPath = path.join(
    __dirname, "..", "tools", "sasjs-server", "sasjs_root", "drive",
    "macrodash.settings.json");
  let rootdir = "";
  try { rootdir = JSON.parse(fs.readFileSync(settingsPath, "utf8")).rootdir; } catch (e) {}
  if (!rootdir) return;
  const api = serverUrl + "/SASjsApi/drive/file?_filePath=" +
    encodeURIComponent(appLoc + "/services/web/index.html");
  const res = await fetch(api);
  if (!res.ok) return;
  const html = await res.text();
  const stamped = html.replace('configured="false"', 'configured="true"');
  if (stamped === html) return;
  const form = new FormData();
  form.append("file", new Blob([stamped], { type: "text/html" }), "index.html");
  const patch = await fetch(api, { method: "PATCH", body: form });
  if (patch.ok) console.log("re-stamped index.html as configured");
}

walk(mocksDir, "")
  .then(restampIfConfigured)
  .then(
    () => console.log("mocks deployed to", serverUrl),
    (e) => { console.error(e.message); process.exit(1); }
  );
