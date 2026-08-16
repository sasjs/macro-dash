/* Macro Dash - backend client via @sasjs/adapter (UMD bundle: src/sasjs.js,
 * copied from node_modules by `npm run prepare`).
 *
 * Config comes from the hidden <sasjs> element in index.html (same pattern
 * as the sasjs seed app).  When the game is streamed by SAS itself, no
 * serverUrl is needed - same-origin requests just work, which keeps us
 * CSP-safe (default-src 'self').
 *
 * Adapter contract: request() inputs are TABLES (arrays of objects) which
 * arrive in SAS as work datasets.  Outputs come back on response.result,
 * with UPPERCASE column names.  Any failure (offline dev, unconfigured
 * backend) degrades gracefully to localStorage-only mode.
 */
(function () {
  "use strict";

  var el = document.querySelector("sasjs");
  var sasjs = null;

  /* debug switch (toggled on the setup screen, persisted in localStorage) */
  var debug = false;
  try { debug = localStorage.getItem("macrodash_debug") === "1"; } catch (e) {}

  /* the configure service rewrites index.html itself, flipping this
     attribute - so the page knows synchronously whether it is configured,
     without waiting for a getConfig round trip. */
  var configured = !!(el && el.getAttribute("configured") === "true");

  try {
    sasjs = new window.SASjs.default({
      serverUrl: (el && el.getAttribute("serverUrl")) || undefined,
      appLoc: (el && el.getAttribute("appLoc")) || "/Public/app/macrodash",
      serverType: (el && el.getAttribute("serverType")) || "SASJS",
      debug: debug
    });
    if (sasjs && sasjs.setDebugState) sasjs.setDebugState(debug);
  } catch (e) {
    sasjs = null;
  }

  /* hard timeout on every backend call: when the server is down (or the
     network drops), XHRs to it hang until the TCP timeout (minutes), which
     would leave the UI waiting.  A hung request degrades to local mode. */
  var REQUEST_TIMEOUT_MS = 5000;

  /* adapter.request() resolves with the webout JSON already unwrapped -
   * tables are arrays of row objects directly on it (including a table
   * named `result`). */
  function call(service, data, cb) {
    if (!sasjs) { cb(null); return; }
    var done = false;
    var timer = setTimeout(function () {
      done = true;
      cb(null);
    }, REQUEST_TIMEOUT_MS);
    sasjs.request("services/common/" + service, data)
      .then(function (res) {
        if (done) return;
        clearTimeout(timer);
        cb(res || null);
      })
      .catch(function () {
        if (done) return;
        clearTimeout(timer);
        cb(null);
      });
  }

  window.MACRODASH_BACKEND = {
    isConfigured: function () { return configured; },

    /* update the in-memory flag after a successful configure() call (the
       page itself is only re-stamped on disk, not reloaded) */
    setConfigured: function () { configured = true; },
    isDebug: function () { return debug; },
    setDebug: function (on) {
      debug = !!on;
      try { localStorage.setItem("macrodash_debug", debug ? "1" : "0"); } catch (e) {}
      if (sasjs && sasjs.setDebugState) sasjs.setDebugState(debug);
    },
    getConfig: function (cb) {
      call("getconfig", null, function (j) {
        var row = j && j.config && j.config[0];
        cb(row ? { configured: !!row.CONFIGURED, rootdir: row.ROOTDIR } : null);
      });
    },
    configure: function (rootdir, cb) {
      call("configure", { config: [{ rootdir: rootdir }] }, function (j) {
        cb(j && j.result ? j.result[0] : null);
      });
    },
    getScores: function (cb) {
      call("getscores", null, function (j) {
        cb(j && j.scores ? j.scores : []);
      });
    },
    saveScore: function (entry, cb) {
      call("savescore", { savescore: [entry] }, function (j) {
        cb(j ? { scores: j.scores || [], rank: j.result ? j.result[0].RANK : null } : null);
      });
    }
  };
})();
