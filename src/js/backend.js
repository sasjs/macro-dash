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
  var forceViya = false; // test-only: render the Viya configurator locally

  /* debug ON on every platform: the adapter captures the per-request SAS
     log (getSasRequests()[n].logFile) which the frontend surfaces as a
     download link.  As with every SASjs app, the initial configure step
     ships debug ON so any setup failure (folder permissions, context
     choice, stamp not landing) can be triaged fast from the downloaded log.
     On Viya this requires a non-JES-web apiMode (compute or jes) - the JES
     web path wraps webout JSON in an HTML page when _debug=128, which the
     adapter cannot parse, so JES web is avoided for now. */
  var debug = true;

  /* Viya compute context, chosen on the setup screen (persisted) */
  var contextName = null;
  try { contextName = localStorage.getItem("macrodash_context"); } catch (e) {}

  /* three-state attribute: "true" -> true, "false" -> false, else undefined */
  function attr3(name) {
    var v = el && el.getAttribute(name);
    return v === "true" ? true : v === "false" ? false : undefined;
  }

  /* Viya execution options (setup screen; persisted in localStorage, with
     the attributes stamped into this page by the configure service as the
     shared default).  Adapter contract (see @sasjs/adapter README) -
     useComputeApi is THREE-state:
       - null/undefined = JES web app (most reliable, slowest); the ONLY
         mode where runAsTask applies (adds _EXECUTIONTASKS=true)
       - false          = JES API (jobs visible in Environment Manager)
       - true           = Compute API (fastest, not in Env Manager)
     We model this as apiMode: "web" | "jes" | "compute". */
  function apiModeFromAttr() {
    var v = attr3("useComputeApi");
    return v === true ? "compute" : v === false ? "jes" : "web";
  }
  var apiMode = apiModeFromAttr();
  try {
    var am = localStorage.getItem("macrodash_apimode");
    if (am === "web" || am === "jes" || am === "compute") apiMode = am;
  } catch (e) {}
  var runAsTask = attr3("runAsTask") !== false; // default ON (web mode only)
  try {
    var rt = localStorage.getItem("macrodash_runastask");
    if (rt !== null) runAsTask = rt === "true";
  } catch (e) {}

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

  /* the defer'd adapter tag carries the build-rewritten (absolute on Viya
     JES) URL.  We run during document parsing, before deferred scripts
     execute - remove it so the bundle only ever loads/executes on demand. */
  var adapterTag = document.getElementById("sasjs-adapter");
  var adapterSrc = (adapterTag && adapterTag.getAttribute("src")) || "sasjs.js";
  if (adapterTag && adapterTag.parentNode) adapterTag.parentNode.removeChild(adapterTag);

  function loadAdapter() {
    if (adapterPromise) return adapterPromise;
    adapterPromise = new Promise(function (resolve) {
      if (window.SASjs) { resolve(true); return; }
      var s = document.createElement("script");
      s.src = adapterSrc;
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
        // user-picked (localStorage) wins; otherwise the attribute stamped
        // into this page by the configure service
        contextName: contextName || (el && el.getAttribute("contextName")) || undefined, // Viya only
        // three-state: web -> undefined, jes -> false, compute -> true
        useComputeApi: serverType !== "SASVIYA" || apiMode === "web"
          ? undefined : apiMode === "compute",
        // runAsTask only applies to the JES web approach
        runAsTask: serverType === "SASVIYA" && apiMode === "web" && runAsTask
          ? true : undefined,
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
     would leave the UI waiting.  A hung request degrades to local mode.
     On Viya a request spins up a compute session, which can take a minute
     or more on a cold estate - 5s would declare every call dead.  configure
     (folder validation + Drive rewrites) gets even longer. */
  var REQUEST_TIMEOUT_MS = serverType === "SASVIYA" ? 120000 : 5000;
  var CONFIGURE_TIMEOUT_MS = serverType === "SASVIYA" ? 300000 : 30000;

  /* adapter.request() resolves with the webout JSON already unwrapped -
   * tables are arrays of row objects directly on it (including a table
   * named `result`). */
  function call(service, data, cb, timeoutMs) {
    withAdapter(function (a) {
      if (!a) { cb(null); return; }
      var done = false;
      var timer = setTimeout(function () {
        done = true;
        cb(null);
      }, timeoutMs || REQUEST_TIMEOUT_MS);
      a.request("services/common/" + service, data)
        .then(function (res) {
          if (done) return;
          clearTimeout(timer);
          /* debug is ON, so the adapter keeps a per-request debug log
             accessible via getSasRequests() (the DC pattern).  The log
             lives there as `logFile` - capture it for the matching service
             so callers (configure) can offer a download link. */
          var saslog = "";
          try {
            var reqs = a.getSasRequests && a.getSasRequests();
            if (reqs && reqs.length) {
              var link = "services/common/" + service;
              var match = null;
              for (var i = reqs.length - 1; i >= 0; i--) {
                if (reqs[i] && reqs[i].serviceLink === link) { match = reqs[i]; break; }
              }
              if (match && typeof match.logFile === "string") saslog = match.logFile;
            }
          } catch (e) {}
          /* Viya wraps the webout JSON in a `result` property; SASjs server
             gives the tables directly.  Unwrap only when on Viya - a table
             or property actually NAMED `result` must pass through untouched. */
          if (serverType === "SASVIYA" && res && res.result &&
              typeof res.result === "object" &&
              !Array.isArray(res.result)) res = res.result;
          if (saslog) {
            if (typeof res === "object" && res !== null) res.log = saslog;
            else res = { result: res, log: saslog };
          }
          cb(res || null);
        })
        .catch(function () {
          if (done) return;
          clearTimeout(timer);
          /* even on failure, try to surface the SAS log so the user can
             diagnose (debug is ON - the adapter keeps logFile) */
          var saslog = "";
          try {
            var reqs = a.getSasRequests && a.getSasRequests();
            if (reqs && reqs.length) {
              var link = "services/common/" + service;
              var match = null;
              for (var i = reqs.length - 1; i >= 0; i--) {
                if (reqs[i] && reqs[i].serviceLink === link) { match = reqs[i]; break; }
              }
              if (match && typeof match.logFile === "string") saslog = match.logFile;
            }
          } catch (e) {}
          cb(saslog ? { log: saslog, error: true } : null);
        });
    });
  }

  /* Viya REST helper: the adapter exposes no public API for contexts or
     identities, so we hit the endpoints directly.  Same-origin when
     streamed by the SAS Job Execution web app (cookie auth), so
     'same-origin' credentials suffice and CSP (connect-src 'self') is
     untouched. */
  /* metadata calls (contexts list + one detail per context) can total
     several MB over a slow link - 5s truncates them mid-JSON */
  var META_TIMEOUT_MS = 30000;

  function viyaFetch(path, opts, cb) {
    if (serverType !== "SASVIYA") { cb(null); return; }
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); },
      (opts && opts.timeout) || META_TIMEOUT_MS);
    var base = (el && el.getAttribute("serverUrl")) || "";
    opts = opts || {};
    opts.credentials = "same-origin";
    opts.headers = Object.assign({ "Accept": "application/json" }, opts.headers);
    if (ctrl) opts.signal = ctrl.signal;
    fetch(base + path, opts).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) { cb(null, r.status); return; }
      if (r.status === 204 || opts.method === "DELETE") { cb({}, r.status); return; }
      r.json().then(function (j) { cb(j, r.status); },
                    function () { cb({}, r.status); });
    }).catch(function () {
      clearTimeout(timer);
      cb(null, 0);
    });
  }

  /* pull the runAs (batch) identity out of a compute context, wherever
     this Viya version puts it (not all expose one) */
  function extractRunAs(j) {
    var a = j.attributes || {};
    return a.runServerAs || j.runAsUserId || a.runAsUserId || a.runAs ||
           a.runas || a.RUNAS ||
           (j.environment && j.environment.runAsUserId) || null;
  }

  /* list compute contexts -> [{ id, name, runAs }] (null on failure).
     The list view is minimal, so each context is fetched in full (in
     parallel) to pick up its runAs identity. */
  function listContexts(cb) {
    viyaFetch("/compute/contexts?limit=100", null, function (j) {
      if (!j) { cb(null); return; }
      var items = (j && j.items) || [];
      if (!items.length) { cb([]); return; }
      var out = new Array(items.length), left = items.length;
      items.forEach(function (c, i) {
        viyaFetch("/compute/contexts/" + c.id, null, function (d) {
          var a = (d && d.attributes) || {};
          out[i] = { id: c.id, name: c.name,
                     runAs: d ? extractRunAs(d) : null,
                     reusable: a.reuseServerProcesses === "true" };
          if (--left === 0) cb(out);
        });
      });
    });
  }

  /* the identity the compute session (and any files it creates) will
     belong to - shown on the setup screen so the batch account is obvious */
  function getCurrentUser(cb) {
    viyaFetch("/identities/users/@currentUser", null, function (j) {
      cb(j && (j.name || j.id) ? { id: j.id, name: j.name || j.id } : null);
    });
  }

  /* is this context usable?  Run a fixed DEPLOYED job in it (never an
     ad-hoc compute session - that would be a code-injection surface).
     Same mechanism the adapter uses: _PROGRAM + _contextname on the SAS
     Job Execution web app.  cb(true/false) */
  function testContext(name, cb) {
    if (serverType !== "SASVIYA") { cb(false); return; }
    var appLoc = (el && el.getAttribute("appLoc")) || "/Public/app/macrodash";
    viyaFetch("/SASJobExecution/?_PROGRAM=" + encodeURIComponent(appLoc +
        "/services/common/getscores") + "&_output_type=json&_contextname=" +
        encodeURIComponent(name),
      { method: "POST" },
      function (j, status) {
        cb(!!(j && (j.scores || j._PROGRAM))); // webout JSON came back
      });
  }

  window.MACRODASH_BACKEND = {
    isConfigured: function () { return configured; },

    /* update the in-memory flag after a successful configure() call (the
       page itself is only re-stamped on disk, not reloaded) */
    setConfigured: function () { configured = true; },
    isViya: function () { return forceViya || serverType === "SASVIYA"; },
    /* test-only override: render the Viya configurator locally */
    forceViya: function (on) { forceViya = !!on; },
    serverUrl: function () { return (el && el.getAttribute("serverUrl")) || ""; },
    /* Viya session check via the adapter (lazy-loads sasjs.js).  Resolves
       with { isLoggedIn, userName } or null on failure. */
    checkLogin: function (cb) {
      withAdapter(function (a) {
        if (!a || !a.checkSession) { cb(null); return; }
        a.checkSession()
          .then(function (r) { cb(r || null); })
          .catch(function () { cb(null); });
      });
    },
    listContexts: listContexts,
    getCurrentUser: getCurrentUser,
    testContext: testContext,
    getContext: function () { return contextName; },
    setContext: function (name) {
      contextName = name || null;
      try {
        if (contextName) localStorage.setItem("macrodash_context", contextName);
        else localStorage.removeItem("macrodash_context");
      } catch (e) {}
      sasjs = null; // rebuild the adapter with the new context on next call
    },
    isRunAsTask: function () { return runAsTask; },
    setRunAsTask: function (on) {
      runAsTask = !!on;
      try { localStorage.setItem("macrodash_runastask", runAsTask ? "true" : "false"); } catch (e) {}
      sasjs = null; // rebuild the adapter with the new setting
    },
    getApiMode: function () { return apiMode; }, // "web" | "jes" | "compute"
    setApiMode: function (mode) {
      if (mode !== "web" && mode !== "jes" && mode !== "compute") return;
      apiMode = mode;
      try { localStorage.setItem("macrodash_apimode", apiMode); } catch (e) {}
      sasjs = null; // rebuild the adapter with the new setting
    },
    isDebug: function () { return debug; },
    configure: function (rootdir, cb) {
      var row = { rootdir: rootdir };
      if (serverType === "SASVIYA") {
        row.runastask = runAsTask ? "true" : "false";
        /* not an automatic variable - must be sent so the configure
           service can stamp it into MacroDash.html for future sessions.
           THREE-state: "true" (compute) / "false" (JES API) / "null"
           (JES web - the attr3 reader maps anything else to undefined) */
        row.usecomputeapi = apiMode === "compute" ? "true"
          : apiMode === "jes" ? "false" : "null";
        /* JES request params (like _contextname) are NOT auto-promoted to
           macro variables, so the service cannot read it via %symexist.
           Send it as a column instead so it can be stamped into the HTML. */
        row.contextname = contextName || "";
      }
      call("configure", { config: [row] }, function (j) {
        /* the adapter's request() resolves with { result, log, ... } on
           Viya (log populated when debug is on - pending an adapter fix to
           ship it without _debug=128 breaking the webout JSON).  Thread
           the log through so the frontend can offer a download link. */
        var out = j && j.result ? j.result[0] : null;
        if (out && j && j.log) out.log = j.log;
        cb(out);
      }, CONFIGURE_TIMEOUT_MS);
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
