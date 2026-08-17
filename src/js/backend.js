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
  var serverType = (el && el.getAttribute("serverType")) || "SASJS";

  /* debug switch (toggled on the setup screen, persisted in localStorage) */
  var debug = false;
  try { debug = localStorage.getItem("macrodash_debug") === "1"; } catch (e) {}

  /* Viya compute context, chosen on the setup screen (persisted) */
  var contextName = null;
  try { contextName = localStorage.getItem("macrodash_context"); } catch (e) {}

  /* the configure service rewrites index.html itself, flipping this
     attribute - so the page knows synchronously whether it is configured,
     without waiting for a getConfig round trip. */
  var configured = !!(el && el.getAttribute("configured") === "true");

  /* LAZY adapter load: sasjs.js is a big UMD bundle and a blocking
     <script src> tag delayed the title screen by seconds on slow
     connections.  It is injected only when a backend call actually
     happens (same-origin, so CSP-safe under script-src 'self'). */
  var sasjs = null;
  var adapterPromise = null;

  function loadAdapter() {
    if (adapterPromise) return adapterPromise;
    adapterPromise = new Promise(function (resolve) {
      if (window.SASjs) { resolve(true); return; }
      var s = document.createElement("script");
      s.src = "sasjs.js";
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
    return adapterPromise;
  }

  function buildAdapter() {
    try {
      sasjs = new window.SASjs.default({
        serverUrl: (el && el.getAttribute("serverUrl")) || undefined,
        appLoc: (el && el.getAttribute("appLoc")) || "/Public/app/macrodash",
        serverType: serverType,
        contextName: contextName || undefined, // Viya only
        debug: debug
      });
      if (sasjs && sasjs.setDebugState) sasjs.setDebugState(debug);
    } catch (e) {
      sasjs = null;
    }
  }

  function withAdapter(cb) {
    if (sasjs) { cb(sasjs); return; }
    loadAdapter().then(function (ok) {
      if (!ok || !window.SASjs) { cb(null); return; }
      buildAdapter();
      cb(sasjs);
    });
  }

  /* hard timeout on every backend call: when the server is down (or the
     network drops), XHRs to it hang until the TCP timeout (minutes), which
     would leave the UI waiting.  A hung request degrades to local mode. */
  var REQUEST_TIMEOUT_MS = 5000;

  /* adapter.request() resolves with the webout JSON already unwrapped -
   * tables are arrays of row objects directly on it (including a table
   * named `result`). */
  function call(service, data, cb) {
    withAdapter(function (a) {
      if (!a) { cb(null); return; }
      var done = false;
      var timer = setTimeout(function () {
        done = true;
        cb(null);
      }, REQUEST_TIMEOUT_MS);
      a.request("services/common/" + service, data)
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
    });
  }

  /* Viya compute contexts: the adapter exposes no public contexts API, so
     we hit the REST endpoint directly.  Same-origin when streamed by the
     SAS Job Execution web app (cookie auth), so 'same-origin' credentials
     suffice and CSP (connect-src 'self') is untouched.  Resolves with a
     list of { id, name } or null on any failure. */
  function listContexts(cb) {
    if (serverType !== "SASVIYA") { cb(null); return; }
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, REQUEST_TIMEOUT_MS);
    var base = (el && el.getAttribute("serverUrl")) || "";
    fetch(base + "/compute/contexts?limit=100", {
      credentials: "same-origin",
      headers: { "Accept": "application/json" },
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (j) {
      clearTimeout(timer);
      var items = (j && j.items) || [];
      cb(items.map(function (c) { return { id: c.id, name: c.name }; }));
    }).catch(function () {
      clearTimeout(timer);
      cb(null);
    });
  }

  window.MACRODASH_BACKEND = {
    isConfigured: function () { return configured; },

    /* update the in-memory flag after a successful configure() call (the
       page itself is only re-stamped on disk, not reloaded) */
    setConfigured: function () { configured = true; },
    isViya: function () { return serverType === "SASVIYA"; },
    listContexts: listContexts,
    getContext: function () { return contextName; },
    setContext: function (name) {
      contextName = name || null;
      try {
        if (contextName) localStorage.setItem("macrodash_context", contextName);
        else localStorage.removeItem("macrodash_context");
      } catch (e) {}
      sasjs = null; // rebuild the adapter with the new context on next call
    },
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
