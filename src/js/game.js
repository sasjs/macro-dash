/* Macro Dash - game logic.  Level 1: The WORK Library; Level 2: Batch at
 * Midnight.  Levels advance on the win screen (ENTER), per-level bests are
 * kept in localStorage. */
(function () {
  "use strict";

  var LEVELS = window.MACRODASH_LEVELS;
  var LEVEL_NAMES = window.MACRODASH_LEVEL_NAMES || [];
  var levelIdx = 0;
  var level = LEVELS[levelIdx];
  var audio = window.MACRODASH_AUDIO;
  var eng = window.MACRODASH_ENGINE.create(document.getElementById("game"), level, {
    viewWidth: 800
  });
  var TILE = eng.TILE;
  var ctx = eng.ctx;

  var GRAVITY = 0.8;    // snappier, less floaty arcs (Macro Dash tuning)
  var WALK = 5.5;
  var RUN = 11;
  var JUMP = -12.75;   // ~3 tiles + margin (~102px vs 96px needed)
  var JUMP_HI = -16.25; // ~5 tiles + margin (~166px vs 160px needed)
  var BOOST_FRAMES = 720; // 12s of FORMAT power

  // ---- parse level into entities ----
  /* A game is one RUN across all levels: amps, health, error/warning counts
   * and the speedrun clock carry over; the score is only finalised when the
   * run ENDS (death, or the final portal).  init(true) starts a fresh run;
   * init(false) advances to the next level keeping the run state. */
  var player, amps = [], enemies = [], shrooms = [], portal = null, tilesRemoved = {};

  function init(newRun) {
    amps = []; enemies = []; shrooms = []; portal = null; tilesRemoved = {};
    var sx = 0, sy = 0;
    for (var r = 0; r < level.length; r++) {
      for (var c = 0; c < level[r].length; c++) {
        var ch = level[r][c];
        var x = c * TILE, y = r * TILE;
        if (ch === "P") {
          sx = x; sy = y;
        } else if (ch === "&") {
          amps.push({ x: x + 8, y: y + 8, w: 16, h: 16, taken: false });
        } else if (ch === "E" || ch === "W" || ch === "A") {
          var spd = ch === "E" ? 1.2 : ch === "A" ? 2.5 : 0.7;
          enemies.push({ x: x, y: y + 8, w: TILE - 4, h: TILE - 10,
                         vx: spd, speed: spd, vy: 0, type: ch, dead: false });
        } else if (ch === "F") {
          shrooms.push({ x: x + 4, y: y + 8, w: 24, h: 24, vx: 0, vy: 0, taken: false });
        } else if (ch === "|") {
          portal = { x: x, y: (r - 1) * TILE, w: TILE, h: TILE * 2 };
        }
      }
    }
    if (newRun || !player) {
      player = { x: sx, y: sy, w: TILE - 6, h: TILE - 2, vx: 0, vy: 0,
                 big: false, boost: 0, health: 100,
                 errs: 0, warns: 0, iframes: 0, dir: 1,
                 startT: performance.now(), endT: 0,
                 levelStartT: performance.now() };
    levelTimes = [];
    } else {
      // next level, same run: keep score/health/clock, reset position
      if (player.big) shrink();
      player.boost = 0;
      player.x = sx; player.y = sy; player.vx = 0; player.vy = 0;
      player.iframes = 90; // brief protection on level entry
      player.endT = 0;
      player.levelStartT = performance.now();
    }
  }
  init(true);

  // ---- input (keyboard + mouse) ----
  var keys = {};
  var mouseHeld = false;

  function press(code, down) {
    keys[code] = down;
    if (down) audio.unlock();
  }
  // exposed for the on-screen controls (js/controls.js)
  window.MACRODASH_PRESS = press;
  window.MACRODASH_STATE = function () { return state; };
  window.MACRODASH_LEVELIDX = function () { return levelIdx; }; // test hook
  // test hooks: read the configurator's text field + status line headlessly
  window.MACRODASH_CONFIG_INPUT = function () { return configInput; };
  window.MACRODASH_CONFIG_FIELD = function () { return configField; }; // test hook
  window.MACRODASH_VIYAAUTH = function () { return viyaAuth; }; // test hook
  /* test hook: render the full Viya configurator locally (no SAS calls) -
     seeds the contexts/identity/auth so the wizard renders, and forces
     isViya() true so the 4-step Viya layout (incl. the OPTIONS step) shows.
     Lets the 4-way execution-option UI be tested without a Viya deploy. */
  window.MACRODASH_FORCE_VIYA = function (on) {
    if (on) {
      backend.forceViya && backend.forceViya(true);
      contexts = [{ name: 'SAS Compute Context', reusable: true, runAs: 'sasdemo' }];
      accounts = ['sasdemo'];
      accountChosen = 'sasdemo';
      ctxChosen = 'SAS Compute Context';
      currentUser = { name: 'sasdemo' };
      viyaAuth = 'ok';
      configInput = '/tmp/md-test';
      configField = 'options';
      configDone = false;
      state = 'config';
    } else {
      backend.forceViya && backend.forceViya(false);
    }
  };
  window.MACRODASH_CONFIG_MSG = function () { return configMsg; };
  window.MACRODASH_CONFIG_DONE = function () { return configDone; };
  window.MACRODASH_CONFIG_LOG = function () { return configLog; };
  // test hook: drive the configurator headlessly (set the active field +
  // the rootdir text) - used by the Viya smoke test
  window.MACRODASH_CONFIG_SET = function (field, rootdir) {
    if (field) configField = field;
    if (typeof rootdir === "string") configInput = rootdir;
  };
  // test hook: force a state (used by headless smoke tests)
  window.MACRODASH_FORCE = function (s) {
    if (s === "complete") startComplete();
    if (s === "board" || s === "dump") boardT = 0;
    if (s === "title") audio.stopMusic(); // brand click goes "home"
    state = s;
  };
  /* test hook: clear all enemies + teleport the player onto the portal,
   * so the real portal-collision code path fires (level completion). */
  window.MACRODASH_REACH_PORTAL = function () {
    if (!portal) return false;
    enemies.forEach(function (e) { e.dead = true; });
    player.x = portal.x + portal.w / 2 - player.w / 2;
    player.y = portal.y + portal.h / 2 - player.h / 2;
    player.vx = 0; player.vy = 0;
    return true;
  };
  /* test hook: trigger the real death path (endRun) - the DNF save lives
   * there, not in the drawDump screen that follows. */
  window.MACRODASH_DIE = function () {
    if (state !== "play") return false;
    endRun();
    return true;
  };
  document.addEventListener("keydown", function (e) {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].indexOf(e.code) >= 0) e.preventDefault();
    press(e.code, true);
  });
  document.addEventListener("keyup", function (e) { press(e.code, false); });

  // mouse: hold left/right third of canvas to run, click upper area to jump
  eng.canvas.addEventListener("mousedown", function (e) {
    audio.unlock();
    // on title/win/dead/finale screens a canvas tap acts as ENTER (mobile)
    if (state === "config") {
      var rect0 = eng.canvas.getBoundingClientRect();
      handleConfigClick((e.clientX - rect0.left) * (eng.viewWidth / rect0.width),
        (e.clientY - rect0.top) * (eng.worldHeight / rect0.height));
      return;
    }
    if (state === "board") {
      var rectb = eng.canvas.getBoundingClientRect();
      var bx = (e.clientX - rectb.left) * (eng.viewWidth / rectb.width);
      var by = (e.clientY - rectb.top) * (eng.worldHeight / rectb.height);
      handleBoardClick(bx, by);
      return;
    }
    if (state === "title" || state === "win" || state === "dead" ||
        state === "complete" || state === "board" || state === "dump") {
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter" }));
      return;
    }
    var rect = eng.canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (my < rect.height * 0.4) keys.MouseJump = true;
    if (mx < rect.width / 2) { keys.MouseLeft = true; } else { keys.MouseRight = true; }
    mouseHeld = true;
  });
  document.addEventListener("mouseup", function () {
    if (mouseHeld) { keys.MouseJump = keys.MouseLeft = keys.MouseRight = false; mouseHeld = false; }
  });

  function input() {
    return {
      left: keys.ArrowLeft || keys.KeyA || keys.MouseLeft,
      right: keys.ArrowRight || keys.KeyD || keys.MouseRight,
      jump: keys.ArrowUp || keys.KeyW || keys.Space || keys.MouseJump,
      run: keys.ShiftLeft || keys.ShiftRight
    };
  }

  // ---- pixel-art running man (12x16, 2-frame run cycle) ----
  // "." = transparent, "#" = SAS blue body
  var RUNNER = [
    [ // frame 0: stride
      "....#####...",
      "...#######..",
      "...###.###..",
      "...#######..",
      "....#####...",
      "..#######...",
      ".#########..",
      "#.####.###.#",
      "#..###...#..",
      "...#####....",
      "..###.###...",
      "..##...##...",
      ".##.....##..",
      ".#.......#..",
      "##.......##.",
      "............"
    ],
    [ // frame 1: legs scissored
      "....#####...",
      "...#######..",
      "...###.###..",
      "...#######..",
      "....#####...",
      "...######...",
      "..########..",
      "#.#########.",
      "#...###...#.",
      "....###.....",
      "...#####....",
      "..###.###...",
      ".##.....##..",
      "##.......##.",
      "#.........#.",
      "............"
    ]
  ];

  // frames 2-3: exaggerated wide stride for full-speed running
  RUNNER.push(
    [
      "....#####...",
      "...#######..",
      "...###.###..",
      "...#######..",
      "....#####...",
      "..#######...",
      ".#########..",
      "#.####.####.",
      "#..###....#.",
      "...#####....",
      "..###..###..",
      ".##.....##..",
      "##.......##.",
      "#.........#.",
      "............",
      "............"
    ],
    [
      "....#####...",
      "...#######..",
      "...###.###..",
      "...#######..",
      "....#####...",
      "...######...",
      "..########..",
      "#.#########.",
      "#...###...#.",
      "....###.....",
      "...###......",
      "....####....",
      "......###...",
      ".......##...",
      "......##....",
      "............"
    ]
  );

  function drawSprite(grid, x, y, w, h, flip, color) {
    var pw = w / grid[0].length;
    var ph = h / grid.length;
    ctx.fillStyle = color;
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      for (var c = 0; c < row.length; c++) {
        if (row[c] !== "#") continue;
        var cc = flip ? row.length - 1 - c : c;
        ctx.fillRect(Math.round(x + cc * pw), Math.round(y + r * ph),
                     Math.ceil(pw), Math.ceil(ph));
      }
    }
  }

  // ---- particles ----
  var parts = [];
  function burst(x, y, color, n, spread) {
    for (var i = 0; i < n; i++) {
      parts.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * (spread || 6),
        vy: -Math.random() * 5 - 1,
        life: 30 + Math.random() * 20,
        color: color
      });
    }
  }
  function updateParts() {
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.3; p.life--;
      if (p.life <= 0) parts.splice(i, 1);
    }
  }
  function drawParts() {
    parts.forEach(function (p) {
      ctx.globalAlpha = Math.min(1, p.life / 20);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 4, 4);
    });
    ctx.globalAlpha = 1;
  }

  // ---- update ----
  var state = "title"; // title | play | dead | win | winname | pause | config
  var jingled = false;

  // ---- backend leaderboard ----
  var backend = window.MACRODASH_BACKEND;
  var backendOn = false;
  var leaderboard = [];
  var playerRank = null;
  var scoresPending = false; // a saveScore is in flight (board shows "saving...")
  var initials = "";
  var configInput = "";
  var configMsg = "";
  var configDone = false; // configure succeeded - RUN becomes "go to game"
  var configLog = ""; // SAS log from the configure response (download link)
  var contexts = null; // Viya compute contexts: null = loading, [] = none
  var contextIdx = 0; // index into the FILTERED context list
  var ctxFilter = ""; // search text for the context picker
  var ctxChosen = null; // the context picked with ENTER (name)
  var ctxTest = {}; // context id -> "testing" | "ok" | "fail"
  var currentUser = null; // { id, name } - the account jobs will run as
  var configField = "rootdir"; // which config field has keyboard focus
  // (the options step uses a derived 4-way highlight, no longer a row var)
  var accounts = [];       // distinct runAs identities from the contexts
  var accountIdx = 0;      // index into the FILTERED account list
  var accountFilter = ""; // search text for the account picker
  var accountChosen = null;
  // click targets, repopulated every drawConfig (canvas coords)
  var cfgHits = { account: [], context: [], fields: {} };
  var boardHits = { again: null, home: null }; // board button hit boxes

  /* contexts matching the chosen account + search text.  Only contexts
   * that are reusable AND carry a runAs (batch) identity are offered -
   * the configure job creates files as that account, not as the
   * interactive user, and a reusable server makes the test/execute cycle
   * cheap. */
  function filteredContexts() {
    if (!contexts) return [];
    var f = ctxFilter.toLowerCase();
    return contexts.filter(function (c) {
      return c.runAs && c.reusable &&
        (!accountChosen || c.runAs === accountChosen) &&
        (!f || c.name.toLowerCase().indexOf(f) >= 0);
    });
  }

  /* accounts matching the search text */
  function filteredAccounts() {
    var f = accountFilter.toLowerCase();
    return accounts.filter(function (a) {
      return !f || a.toLowerCase().indexOf(f) >= 0;
    });
  }

  /* download the SAS log captured from the configure response.  CSP-safe:
     a Blob URL with a fixed text type is allowed under default-src 'self'
     (no data: URIs, no inline scripts).  Revoked after the click. */
  function downloadLog() {
    if (!configLog) return;
    var blob = new Blob([configLog], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "macro-dash-configure.log";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function handleConfigClick(x, y) {
    // step headers (re)open that step
    if (cfgHits.step1 && y >= cfgHits.step1[0] && y <= cfgHits.step1[1]) {
      configField = "account"; return;
    }
    if (cfgHits.step2 && y >= cfgHits.step2[0] && y <= cfgHits.step2[1]) {
      if (accountChosen || !accounts.length) configField = "context";
      return;
    }
    if (cfgHits.step3 && y >= cfgHits.step3[0] && y <= cfgHits.step3[1]) {
      configField = "rootdir"; return;
    }
    var f = cfgHits.fields;
    if (f.rootdir && y >= f.rootdir[0] && y <= f.rootdir[1]) {
      configField = "rootdir"; return;
    }
    if (f.context && y >= f.context[0] && y <= f.context[1]) {
      configField = "context"; return;
    }
    if (f.account && y >= f.account[0] && y <= f.account[1]) {
      configField = "account"; return;
    }
    for (var i = 0; i < cfgHits.account.length; i++) {
      var a = cfgHits.account[i];
      if (y >= a.y0 && y <= a.y1) {
        accountChosen = a.name;
        contextIdx = 0; configField = "context";
        // drop a chosen context that does not belong to this account
        if (ctxChosen && contexts && !contexts.some(function (c) {
          return c.name === ctxChosen && c.runAs === accountChosen;
        })) ctxChosen = null;
        return;
      }
    }
    for (i = 0; i < cfgHits.context.length; i++) {
      var c = cfgHits.context[i];
      if (y >= c.y0 && y <= c.y1) {
        ctxChosen = c.name; configField = "rootdir";
        return;
      }
    }
    for (i = 0; i < cfgHits.opt.length; i++) {
      var o = cfgHits.opt[i];
      if (y >= o.y0 && y <= o.y1) {
        backend.setApiMode(o.idx === 2 ? "compute" :
          o.idx === 1 ? "jes" : "web");
        backend.setRunAsTask(o.idx === 3);
        configField = "options";
        return;
      }
    }
    if (cfgHits.step4 && y >= cfgHits.step4[0] && y <= cfgHits.step4[1]) {
      configField = "options"; return;
    }
    /* the "download SAS log" link, shown after configure (success or
       failure) when a log was captured */
    if (cfgHits.log && y >= cfgHits.log[0] && y <= cfgHits.log[1]) {
      downloadLog(); return;
    }
  }

  /* board button hit-testing: PLAY AGAIN restarts, HOME returns to title */
  function handleBoardClick(x, y) {
    var b;
    if (boardHits.again && x >= boardHits.again[2] && x <= boardHits.again[3] &&
        y >= boardHits.again[0] && y <= boardHits.again[1]) b = "again";
    else if (boardHits.home && x >= boardHits.home[2] && x <= boardHits.home[3] &&
        y >= boardHits.home[0] && y <= boardHits.home[1]) b = "home";
    if (!b) return;
    clearBoardHash();
    if (b === "again") {
      levelIdx = 0; level = LEVELS[levelIdx]; eng.setLevel(level);
      startPlay(true);
    } else {
      state = "title";
    }
  }

  function refreshScores() {
    if (!backendOn) return;
    backend.getScores(function (rows) { leaderboard = rows || []; });
  }

  /* the configured attribute stamped into index.html by the configure
     service tells us synchronously whether a backend exists - when it does
     not, we call NO services at all (a getconfig round trip is pointless:
     the stamp IS the answer, and on platforms like Viya where the streamed
     html cannot self-update, the stamp is maintained at build/deploy time).
     The only service reachable while unconfigured is configure itself. */
  backendOn = backend.isConfigured ? backend.isConfigured() : false;
  if (backendOn) refreshScores();
  /* on Viya, fetch the interactive identity up front so the username is
     available even when the app loaded already-configured (the config
     wizard only sets it when the user re-enters setup). */
  if (backendOn && backend.isViya && backend.isViya() && backend.getCurrentUser) {
    backend.getCurrentUser(function (u) { if (u) currentUser = u; });
  }

  // text entry handler for winname / config states
  document.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    if (state === "winname") {
      if (e.code === "Enter") {
        e._sbHandled = true; // don't let the restart handler see this Enter
        if (initials.length > 0) {
          // local mode: the just-finished run was already saved to
          // localStorage by finalizeRun() - stamp the entered initials onto
          // it (the most recent entry), then go to the finale.
          try {
            var all = loadBests();
            if (all.length) all[all.length - 1].name = initials;
            localStorage.setItem(BEST_KEY, JSON.stringify(all));
          } catch (e) {}
        }
        state = runEnd || "title";
        if (state === "complete") startComplete();
      } else if (e.code === "Backspace") {
        initials = initials.slice(0, -1);
      } else if (e.code === "Escape") {
        state = runEnd || "title"; // skip submission
        if (state === "complete") startComplete();
      } else if (!e.ctrlKey && !e.metaKey &&
          /^[a-zA-Z0-9]$/.test(e.key) && initials.length < 12) {
        initials += e.key.toUpperCase();
      }
    } else if (state === "config") {
      // swallow keys we handle so the hosting page (JES chrome) and the
      // browser itself (e.g. "/" quick-find) never steal them - but NOT
      // modifier chords (Ctrl/Cmd+V must reach the browser so the paste
      // event below fires)
      if (!e.ctrlKey && !e.metaKey && (e.key.length === 1 ||
          ["Backspace", "Tab", "Enter", "Escape",
          "ArrowUp", "ArrowDown"].indexOf(e.code) >= 0)) {
        e.preventDefault(); e.stopPropagation();
      }
      var isViya = backend.isViya && backend.isViya();
      var filtered = filteredContexts();
      var FIELDS = isViya ? ["account", "context", "rootdir", "options"] : ["rootdir"];
      if (isViya && viyaAuth === "login") {
        if (e.code === "Escape") state = "title";
        else if (e.code === "KeyL") {
          window.open(backend.serverUrl() + "/SASLogon/login", "_blank");
        } else if (e.code !== "Tab") {
          viyaAuth = "checking";
          checkViyaAuth();
        }
      } else if (e.code === "Tab") {
        configField = FIELDS[(FIELDS.indexOf(configField) + 1) % FIELDS.length];
      } else if (e.code === "Escape") {
        state = "title";
      } else if (isViya && configField === "account") {
        var faccts = filteredAccounts();
        if (e.code === "ArrowUp" || e.code === "ArrowDown") {
          if (faccts.length) {
            var astep = e.code === "ArrowDown" ? 1 : -1;
            accountIdx = (accountIdx + astep + faccts.length) % faccts.length;
          }
        } else if (e.code === "Backspace") {
          accountFilter = accountFilter.slice(0, -1); accountIdx = 0;
        } else if (e.code === "Enter") {
          e._sbHandled = true;
          if (faccts[accountIdx]) {
            accountChosen = faccts[accountIdx];
            contextIdx = 0;
            configField = "context";
            if (ctxChosen && contexts && !contexts.some(function (c) {
              return c.name === ctxChosen && c.runAs === accountChosen;
            })) ctxChosen = null;
          }
        } else if (!e.ctrlKey && !e.metaKey &&
            /^[\x20-\x7e]$/.test(e.key) && accountFilter.length < 40) {
          accountFilter += e.key; accountIdx = 0;
        }
      } else if (isViya && configField === "context") {
        if (e.code === "ArrowUp" || e.code === "ArrowDown") {
          if (filtered.length) {
            var step = e.code === "ArrowDown" ? 1 : -1;
            contextIdx = (contextIdx + step + filtered.length) % filtered.length;
          }
        } else if (e.code === "Backspace") {
          ctxFilter = ctxFilter.slice(0, -1); contextIdx = 0;
        } else if (e.code === "Enter") {
          e._sbHandled = true;
          if (filtered[contextIdx]) {
            ctxChosen = filtered[contextIdx].name;
            configField = "rootdir";
          }
        } else if (e.code === "KeyT") {
          // test the highlighted context by running a deployed job in it
          var tc = filtered[contextIdx];
          if (tc && !ctxTest[tc.name]) {
            ctxTest[tc.name] = "testing";
            backend.testContext(tc.name, function (ok) {
              ctxTest[tc.name] = ok ? "ok" : "fail";
            });
          }
        } else if (!e.ctrlKey && !e.metaKey &&
            /^[\x20-\x7e]$/.test(e.key) && ctxFilter.length < 40) {
          ctxFilter += e.key; contextIdx = 0;
        }
      } else if (isViya && configField === "options") {
        // single 4-way list: up/down moves the highlight, Enter/click picks
        if (e.code === "ArrowUp" || e.code === "ArrowDown") {
          e._sbHandled = true;
          var cur = (backend.getApiMode() === "web" && backend.isRunAsTask()) ? 3
            : backend.getApiMode() === "compute" ? 2
            : backend.getApiMode() === "jes" ? 1 : 0;
          var ns = (cur + (e.code === "ArrowDown" ? 1 : -1) + 4) % 4;
          backend.setApiMode(ns === 2 ? "compute" : ns === 1 ? "jes" : "web");
          backend.setRunAsTask(ns === 3);
        } else if (e.code === "Enter" || e.code === "Space") {
          e._sbHandled = true;
          configField = "rootdir"; // ready to save
        }
      } else if (e.code === "Enter") {
        e._sbHandled = true;
        /* after a successful configure, RUN/Enter is a deliberate "go to
           game" - re-running configure would fail (the stamp already
           landed), so we leave the config screen instead.  The user stays
           here after configure so they can view the log first. */
        if (configDone) {
          state = "title";
          return;
        }
        if (isViya && ctxChosen) backend.setContext(ctxChosen);
        configMsg = "configuring...";
        backend.configure(configInput, function (res) {
          if (res && res.STATUS === "configured") {
            backendOn = true;
            if (backend.setConfigured) backend.setConfigured();
            configDone = true;
            configLog = res.log || "";
            configMsg = "NOTE: results folder configured."
              + (configLog ? " - press L for the SAS log" : "");
            refreshScores();
          } else {
            configLog = res && res.log ? res.log : "";
            configMsg = "ERROR: could not configure (check folder/permissions)."
              + (configLog ? " - press L for the SAS log" : "");
          }
        });
      } else if (e.code === "KeyL") {
        /* download the SAS log (or the raw response) from the configure call.
           Always available after a configure attempt - debug is ON. */
        e._sbHandled = true;
        downloadLog();
      } else if (e.code === "Backspace") {
        configInput = configInput.slice(0, -1);
      } else if (e.code === "Escape") {
        state = "title";
      } else if (!e.ctrlKey && !e.metaKey &&
          /^[\x20-\x7e]$/.test(e.key) && configInput.length < 200) {
        configInput += e.key;
      }
    } else if (state === "title" && e.code === "KeyC" && !backendOn) {
      // locked once configured - the backend is set up, no need to re-enter
      configInput = "";
      configMsg = "";
      configDone = false;
      configLog = "";
      state = "config";
      // Viya: fetch the compute contexts and the interactive identity, then
      // start by choosing the ACCOUNT (runAs), then the context, then the
      // folder
      if (backend.isViya && backend.isViya()) {
        configField = "account";
        contexts = null;
        ctxFilter = "";
        contextIdx = 0;
        ctxChosen = backend.getContext ? backend.getContext() : null;
        accounts = [];
        accountIdx = 0;
        accountFilter = "";
        accountChosen = null;
        currentUser = null;
        // first check the Viya session (adapter checkSession); only load
        // contexts once we know we are logged in
        viyaAuth = "checking";
        checkViyaAuth();
      } else {
        configField = "rootdir";
      }
    }
  });

  /* paste support for the configurator text fields (the CSP-safe canvas UI
     has no <input>, so we listen for the document-level paste event; the
     keydown handler above deliberately lets Ctrl/Cmd+V through) */
  function pasteIntoConfig(txt) {
    if (!txt) return;
    // strip newlines and non-printable chars
    txt = txt.replace(/[^\x20-\x7e]/g, "");
    var isViya = backend.isViya && backend.isViya();
    if (isViya && viyaAuth !== "ok") return;
    if (isViya && configField === "account") {
      accountFilter = (accountFilter + txt).slice(0, 40); accountIdx = 0;
    } else if (isViya && configField === "context") {
      ctxFilter = (ctxFilter + txt).slice(0, 40); contextIdx = 0;
    } else if (configField === "rootdir") {
      configInput = (configInput + txt).slice(0, 200);
    }
  }

  document.addEventListener("paste", function (e) {
    if (state !== "config") return;
    e.preventDefault();
    pasteIntoConfig((e.clipboardData || window.clipboardData).getData("text"));
  });

  /* right-click paste: the canvas has no native context menu worth keeping
     on the config screen, so a right-click reads the clipboard (async
     Clipboard API - Chrome prompts for permission on first use) and pastes
     into the focused field. */
  eng.canvas.addEventListener("contextmenu", function (e) {
    if (state !== "config") return;
    e.preventDefault();
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(pasteIntoConfig, function () {});
    }
  });

  /* Viya session gate for the configurator.  viyaAuth: "checking" | "ok"
   * | "login".  On "login" the user opens SASLogon (L key / click), signs
   * in (same-origin cookie), then any key retries. */
  var viyaAuth = "ok";

  function checkViyaAuth() {
    backend.checkLogin(function (r) {
      if (!r || !r.isLoggedIn) { viyaAuth = "login"; return; }
      viyaAuth = "ok";
      /* checkSession's userName can be the COMPUTE account (e.g. sasbatch)
         - the interactive identity comes from the identities service */
      backend.getCurrentUser(function (u) {
        currentUser = u || { id: r.userName, name: r.userName };
      });
      backend.listContexts(function (list) {
        contexts = list || [];
        accounts = contexts.filter(function (c) { return c.runAs && c.reusable; })
          .map(function (c) { return c.runAs; })
          .filter(function (v, i, a) { return a.indexOf(v) === i; });
        // preselect the account of the persisted context, if any
        if (ctxChosen) contexts.forEach(function (c) {
          if (c.name === ctxChosen && c.runAs) accountChosen = c.runAs;
        });
        if (!accountChosen && accounts.length === 1) accountChosen = accounts[0];
        accountIdx = Math.max(0, accounts.indexOf(accountChosen));
      });
    });
  }
  document.addEventListener("keydown", function () {
    if (state === "title" && !jingled) { jingled = true; audio.unlock(); audio.jingle(); }
  });

  var deathT = 0;

  function update() {
    // death animation: the runner turns red and floats skyward
    if (state === "dying") {
      if (player.iframes > 0) player.iframes--;
      player.y += player.vy;
      player.vy = Math.min(player.vy + 0.08, -2.5); // easing into the ascent
      deathT++;
      if (deathT === 1 || deathT % 12 === 0) {
        burst(player.x + player.w / 2, player.y + player.h, "#b71c1c", 6, 4);
      }
      if (deathT > 110) endRun(); // ~2s, then the log verdict
      return;
    }
    if (state !== "play") return;
    var inp = input();

    var speed = inp.run ? RUN : WALK;
    if (inp.left) { player.vx = -speed; player.dir = -1; }
    else if (inp.right) { player.vx = speed; player.dir = 1; }
    else player.vx = 0;
    player.moving = !!player.vx;
    player.animTick = (player.animTick || 0) + Math.abs(player.vx);
    if (inp.jump && player.onGround) {
      player.vy = player.boost > 0 ? JUMP_HI : JUMP;
      audio.jump();
    }
    if (player.boost > 0) {
      player.boost--;
      if (player.boost === 0 && player.big) shrink(); // FORMAT wore off
    }
    player.vy = Math.min(player.vy + GRAVITY, 16);
    eng.moveAndCollide(player);
    if (player.iframes > 0) player.iframes--;

    // fell out of the world
    if (player.y > eng.worldHeight + 64) { damage(100, "E"); }

    // ampersands: pure macro food (+15 health each) - no score, the
    // leaderboard is measured on time only
    amps.forEach(function (a) {
      if (!a.taken && eng.overlap(player, a)) {
        a.taken = true; audio.collect();
        player.health = Math.min(100, player.health + 15);
        burst(a.x + a.w / 2, a.y + a.h / 2, "#ffd54d", 10);
      }
    });

    // the clock eats the log: -2 health every second - keep moving!
    player.drainTick = (player.drainTick || 0) + 1;
    if (player.drainTick >= 30) {
      player.drainTick = 0;
      player.health = Math.max(0, player.health - 1);
      checkDeath();
    }

    // format mushroom
    shrooms.forEach(function (s) {
      if (!s.taken) {
        s.vy = Math.min(s.vy + GRAVITY, 16);
        eng.moveAndCollide(s);
        if (eng.overlap(player, s)) {
          s.taken = true;
          if (!player.big) {
            player.big = true;
            player.h *= 1.6; player.w *= 1.4; player.y -= player.h * 0.4;
          }
          player.boost = BOOST_FRAMES;
          audio.powerup();
          burst(s.x + 12, s.y + 12, "#ff8a65", 16, 8);
        }
      }
    });

    // enemies
    enemies.forEach(function (e) {
      if (e.dead) return;
      e.vy = Math.min(e.vy + GRAVITY, 16);
      eng.moveAndCollide(e);
      if (e.hitWall) e.vx = -e.vx || e.speed * (e.hitWall > 0 ? -1 : 1);
      e.hitWall = 0;
      // turn around at ledges
      if (e.onGround) {
        var aheadCol = Math.floor((e.x + (e.vx > 0 ? e.w + 2 : -2)) / TILE);
        var belowRow = Math.floor((e.y + e.h + 2) / TILE);
        if (!eng.solidAt(aheadCol, belowRow)) e.vx = -e.vx;
      }
      if (eng.overlap(player, e)) {
        // stomp kills if falling onto enemy.  Judge by LAST frame's position
        // (player bottom above enemy top) - at high fall speeds the player can
        // tunnel deep into the enemy in a single frame, and a penetration-depth
        // test would wrongly count a clean stomp as a side hit.
        var prevBottom = player.y - player.vy + player.h;
        if (player.vy > 0 && prevBottom <= e.y + 8) {
          e.dead = true; player.vy = JUMP * 0.6; audio.hurt();
          burst(e.x + e.w / 2, e.y + e.h / 2,
            e.type === "E" ? "#e53935" : e.type === "A" ? "#880e4f" : "#ffb300", 14, 8);
          if (e.type === "A") {
            // killing an ABORT cleans up the log: +25 health
            player.health = Math.min(100, player.health + 25);
            burst(player.x + player.w / 2, player.y, "#43a047", 12, 6);
            audio.powerup();
          }
        } else if (player.iframes === 0) {
          // side hit: the enemy is resolved too, but takes a life with it
          // (touching an ABORT ends the job immediately)
          e.dead = true;
          burst(e.x + e.w / 2, e.y + e.h / 2,
            e.type === "E" ? "#e53935" : e.type === "A" ? "#880e4f" : "#ffb300", 14, 8);
          damage(e.type === "E" ? 34 : e.type === "A" ? 100 : 12, e.type);
        }
      }
    });

    // portal - blocked until the log is clean (every ERROR, WARNING and
    // ABORT stomped); the job cannot complete with anything outstanding
    if (portal && eng.overlap(player, portal)) {
      var leftE = 0, leftW = 0, leftA = 0;
      enemies.forEach(function (e) {
        if (e.dead) return;
        if (e.type === "E") leftE++; else if (e.type === "W") leftW++; else leftA++;
      });
      if (leftE + leftW + leftA > 0) {
        gateMsg = 90; // frames to show the refusal
        gateDetail = (leftE ? " ERRORS=" + leftE : "") +
                     (leftW ? " WARNINGS=" + leftW : "") +
                     (leftA ? " ABORTS=" + leftA : "");
        audio.hurt();
        player.vx = -player.dir * 4; // bounce the runner back
      } else {
      gateMsg = 0;
      burst(player.x + player.w / 2, player.y + player.h / 2, "#7C4DFF", 24, 10);
      burst(player.x + player.w / 2, player.y + player.h / 2, "#ffd54d", 12, 8);
      player.endT = performance.now();
      audio.stopMusic();
      audio.win();

      // record this level's time (shown as a stat on the win/finale screens)
      levelTimes[levelIdx] =
        parseFloat(((player.endT - player.levelStartT) / 1000).toFixed(1));

      var final = levelIdx + 1 >= LEVELS.length;
      runEnd = final ? "complete" : "win";
      if (final) finalizeRun(); // only a completed run records a time
      // multiplayer (backend) mode: the SAS service records the run under
      // the logged-in user (mf_getuser) - no initials prompt, go straight
      // to the finale.  Local mode keeps the initials prompt (winname) so
      // the local best-run history has a name.
      if (final && backendOn) {
        scoresPending = true;
        backend.saveScore({ name: "", time: elapsed(), score: 0, amps: 0, done: 1 },
          function (res) {
            scoresPending = false;
            if (res) { leaderboard = res.scores; playerRank = res.rank; }
          });
        state = runEnd || "complete";
        if (state === "complete") startComplete();
      } else if (final) { initials = ""; state = "winname"; }
      else {
        state = runEnd;
        if (state === "complete") startComplete();
      }
      }
    }
  }

  var gateMsg = 0; // frames remaining for the portal refusal
  var gateDetail = ""; // outstanding enemy counts for the refusal message

  /* where to go after the initials screen: dead (job aborted), win (next
   * level) or complete (finale) */
  var runEnd = null;
  var levelTimes = []; // per-level seconds for the current run

  /* record a run at the final portal.  Best = fastest time - the log
   * must be clean to finish, so time is all that counts.  Deaths are
   * DNF and never recorded. */
  function finalizeRun() {
    var entry = { time: parseFloat(elapsed()), lvl: levelTimes.slice(),
                  done: true, when: Date.now() };
    var prev = loadBest();
    player.newRecord = !prev || entry.time < prev.time;
    saveRun(entry);
  }

  // ---- finale: "completed" animation -> high score board ----
  var compT = 0, boardT = 0, confetti = [];
  var CONFETTI_COLORS = ["#4da3ff", "#ffd54d", "#43a047", "#e53935", "#7C4DFF", "#ff8a65"];

  function startComplete() {
    compT = 0;
    confetti = [];
    for (var i = 0; i < 80; i++) {
      confetti.push({
        x: Math.random() * eng.viewWidth,
        y: -Math.random() * eng.worldHeight,
        vx: (Math.random() - 0.5) * 1.5,
        vy: 1 + Math.random() * 2.5,
        w: 4 + Math.random() * 4,
        h: 3 + Math.random() * 4,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        spin: Math.random() * Math.PI,
        semi: i % 4 !== 3 // 3/4 of the confetti is semicolons - it IS SAS
      });
    }
  }

  function shrink() {
    player.big = false;
    player.boost = 0;
    player.w /= 1.4; player.h /= 1.6;
  }

  function damage(n, type) {
    player.health -= n;
    if (type === "W") player.warns++; else if (type) player.errs++;
    player.iframes = 60;
    audio.hurt();
    if (player.big) shrink(); // FORMAT wears off first
    checkDeath();
  }

  function checkDeath() {
    if (player.health <= 0) {
      player.health = 0;
      player.endT = performance.now();
      audio.stopMusic();
      if (player.y > eng.worldHeight) {
        endRun(); // fell into a pit: he's already gone, no farewell rise
      } else {
        // death animation first: blood red, rises to the sky (state "dying")
        state = "dying";
        deathT = 0;
        player.vy = -8;
        player.iframes = 0; // or the blink check would keep him invisible
      }
    }
  }

  /* wrap up a run that ended in death.  No time is recorded - only
   * completed runs (final portal reached) earn a place on the board. */
  function endRun() {
    player.newRecord = false;
    runEnd = "dead";
    /* record the DNF run so it shows on the leaderboard ranked after every
    finisher, by recency.  Backend (multiplayer) mode sends it to the SAS
    service under the logged-in user (mf_getuser) - no initials prompt.
    Local-only mode writes it to localStorage and prompts for initials
    (winname), the same way a finish does, so the entry has a name. */
    var entry = { time: null, lvl: levelTimes.slice(), done: false, when: Date.now() };
    if (backendOn) {
      backend.saveScore({ name: "", time: "", score: 0, amps: 0, done: 0 },
        function (res) { if (res) { leaderboard = res.scores; } });
      state = "dead";
    } else {
      saveRun(entry);
      initials = "";
      state = "winname"; // collect initials for the DNF entry
    }
  }

  function elapsed() {
    var end = player.endT || performance.now(); // frozen on win/death
    return ((end - player.startT) / 1000).toFixed(1);
  }

  // ---- persistent bests (localStorage; same-origin => CSP-safe) ----
  // every finished run is APPENDED (a run spans all levels; the score
  // counts at the end) and the list is capped at the last 10, so the
  // finish pages can show the full recent history
  var BEST_KEY = "macrodash_best";

  function loadBests() {
    try {
      var raw = localStorage.getItem(BEST_KEY);
      if (!raw) return [];
      var v = JSON.parse(raw);
      if (!Array.isArray(v)) v = [v]; // migrate the old single-best format
      // keep both finishes (done:true) and DNFs (done:false) - the board
      // sorts finishes first by time, DNFs after by recency.  Entries from
      // before the done flag (legacy) are treated as finishes.
      return v.filter(function (b) { return b && typeof b === "object"; });
    } catch (e) { return []; }
  }

  function loadBest() {
    // best = fastest finisher (DNFs never count as a best)
    var finishes = loadBests().filter(function (b) { return b.done; });
    if (!finishes.length) return null;
    return finishes.reduce(function (a, b) { return b.time < a.time ? b : a; });
  }

  var BEST_MAX = 10;

  function saveRun(b) {
    try {
      localStorage.setItem(BEST_KEY,
        JSON.stringify(loadBests().concat(b).slice(-BEST_MAX)));
    } catch (e) {}
  }

  /* DDMMMYY hh:mm (SAS DATE7.-style date, e.g. 04JUL26 14:32) for a stored
   * best run; older entries may predate the `when` field */
  var MONTHS3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                 "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  function fmtWhen(b) {
    if (!b || !b.when) return "";
    var d = new Date(b.when);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getDate()) + MONTHS3[d.getMonth()] +
      String(d.getFullYear()).slice(-2) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* shared renderer for the offline personal-best history, newest first.
   * returns the y of the last row drawn */
  function drawBestHistory(W, y, max) {
    // finishers first (fastest time first), DNFs after (most recent first) -
    // the same ranking the backend leaderboard uses
    var all = loadBests().slice().sort(function (a, b) {
      if (a.done && !b.done) return -1;
      if (!a.done && b.done) return 1;
      if (a.done) return a.time - b.time;       // finishes: fastest first
      return b.when - a.when;                  // DNFs: most recent first
    });
    if (!all.length) {
      ctx.fillStyle = "#44597a";
      ctx.font = "13px monospace";
      ctx.fillText("(no runs recorded yet)", W / 2, y);
      return y;
    }
    var best = loadBest();
    all.slice(0, max).forEach(function (b, i) {
      var when = fmtWhen(b);
      var nm = b.name ? (b.name + "            ").slice(0, 12) : "            ";
      var timeStr = b.done ? b.time.toFixed(1) + "s" : "DNF";
      var row = nm + timeStr + (when ? "  " + when : "");
      var isBest = best && b.done && best.time === b.time && best.when === b.when;
      ctx.fillStyle = isBest ? "#ffd54d" : (b.done ? "#dbe7ff" : "#8aa8d8");
      ctx.font = (isBest ? "bold " : "") + "14px monospace";
      ctx.fillText((isBest ? "BEST  " : "      ") + row, W / 2, y);
      y += 20;
    });
    return y - 20;
  }



  // ---- render ----
  function drawTitle() {
    ctx.fillStyle = "#061224";
    ctx.fillRect(0, 0, eng.viewWidth, eng.worldHeight);
    ctx.textAlign = "center";

    ctx.fillStyle = "#4da3ff";
    ctx.font = "bold 48px monospace";
    ctx.fillText("MACRO DASH", eng.viewWidth / 2, 120);

    ctx.fillStyle = "#ffd54d";
    ctx.font = "16px monospace";
    ctx.fillText("Level 1: The WORK Library", eng.viewWidth / 2, 160);

    // our hero, mid-stride
    drawSprite(RUNNER[Math.floor(Date.now() / 200) % 2],
      eng.viewWidth / 2 - 24, 190, 48, 64, false, "#ffffff");

    ctx.fillStyle = "#dbe7ff";
    ctx.font = "14px monospace";
    ctx.fillText("You are the DATA stepper.", eng.viewWidth / 2, 290);
    ctx.fillText("Eliminate ERRORs and WARNINGs.", eng.viewWidth / 2, 312);
    ctx.fillText("Grab ampersands for health - fastest clean run wins.", eng.viewWidth / 2, 334);
    ctx.fillText("Grab the FORMAT 10.2 mushroom for super jumps.", eng.viewWidth / 2, 356);

    ctx.fillStyle = "#8aa8d8";
    ctx.font = "13px monospace";
    ctx.fillText("Arrows/WASD move  -  Space jump  -  Shift run  -  Mouse works too",
      eng.viewWidth / 2, 376);

    var best = loadBest();
    ctx.font = "14px monospace";
    var y0 = 398;
    if (best) {
      ctx.fillStyle = "#ffd54d";
      var bestWhen = fmtWhen(best);
      ctx.fillText("PERSONAL BEST: " + best.time.toFixed(1) + "s" +
        (bestWhen ? "  on " + bestWhen : ""), eng.viewWidth / 2, y0);
      y0 += 22;
    }
    if (backendOn && leaderboard.length) {
      ctx.fillStyle = "#4da3ff";
      ctx.fillText("LEADERBOARD:", eng.viewWidth / 2, y0);
      ctx.fillStyle = "#dbe7ff";
      // fewer rows when a personal best line is shown, so we never collide
      // with the ENTER prompt below (canvas bottom is 480)
      leaderboard.slice(0, best ? 2 : 3).forEach(function (s, i) {
        y0 += 16;
        ctx.fillText((i + 1) + ". " + s.NAME + "  " + s.TIME.toFixed(1) + "s",
          eng.viewWidth / 2, y0);
      });
    } else if (!backendOn) {
      ctx.fillStyle = "#8aa8d8";
      y0 += 8; // extra gap so this hint doesn't touch the line above
      ctx.fillText("press C to configure the backend leaderboard", eng.viewWidth / 2, y0);
    }

    ctx.fillStyle = "#43a047";
    ctx.font = "bold 18px monospace";
    ctx.fillText("press ENTER or tap RUN to submit", eng.viewWidth / 2, 472);
    ctx.textAlign = "left";
  }

  function drawConfig() {
    ctx.fillStyle = "#061224";
    ctx.fillRect(0, 0, eng.viewWidth, eng.worldHeight);
    ctx.textAlign = "center";
    var isViya = backend.isViya && backend.isViya();
    var W2 = eng.viewWidth / 2;
    ctx.fillStyle = "#4da3ff";
    ctx.font = "bold 22px monospace";
    ctx.fillText("MACRO DASH SETUP", W2, 42);

    // logged-in identity, top right
    if (currentUser) {
      ctx.textAlign = "right";
      ctx.fillStyle = "#44597a";
      ctx.font = "11px monospace";
      ctx.fillText(currentUser.name, eng.viewWidth - 16, 24);
      ctx.textAlign = "center";
    }

    // Viya session gate: checking / not-logged-in states replace the wizard
    if (isViya && viyaAuth !== "ok") {
      ctx.font = "14px monospace";
      if (viyaAuth === "checking") {
        ctx.fillStyle = "#8aa8d8";
        ctx.fillText("checking Viya session...", W2, 200);
      } else {
        ctx.fillStyle = "#e53935";
        ctx.fillText("NOT LOGGED IN to Viya", W2, 180);
        ctx.fillStyle = "#dbe7ff";
        ctx.fillText("press L to open SASLogon in a new tab and sign in", W2, 220);
        ctx.fillStyle = "#8aa8d8";
        ctx.font = "12px monospace";
        ctx.fillText("(same-origin cookie - it counts here immediately)", W2, 242);
        ctx.fillText("then come back and press any key to retry - ESC cancels", W2, 264);
      }
      ctx.textAlign = "left";
      return;
    }

    cfgHits.account = []; cfgHits.context = []; cfgHits.fields = {};
    cfgHits.log = null;
    var blink = Math.floor(Date.now() / 500) % 2;

    /* a step header: number, title, current value/status.  Clicking it
     * (re)opens that step. */
    function stepHeader(num, title, value, done, active, y) {
      ctx.fillStyle = active ? "#122a4d" : "rgba(0,0,0,0)";
      ctx.fillRect(40, y - 16, eng.viewWidth - 80, 24);
      ctx.fillStyle = done ? "#43a047" : active ? "#ffd54d" : "#8aa8d8";
      ctx.font = "bold 14px monospace";
      ctx.textAlign = "left";
      ctx.fillText((done ? "[x] " : "[ ] ") + num + ". " + title, 60, y);
      ctx.fillStyle = active ? "#ffd54d" : "#dbe7ff";
      ctx.textAlign = "right";
      ctx.fillText(value || "", eng.viewWidth - 60, y);
      ctx.textAlign = "center";
      return [y - 16, y + 8];
    }

    function searchBox(value, focused, ly) {
      ctx.fillStyle = "#000";
      ctx.fillRect(W2 - 300, ly, 600, 24);
      ctx.fillStyle = focused ? "#43a047" : "#2f7a3e";
      ctx.font = "14px monospace";
      ctx.fillText(value + (focused && blink ? "_" : " "), W2, ly + 17);
      if (focused) {
        ctx.strokeStyle = "#43a047";
        ctx.lineWidth = 1;
        ctx.strokeRect(W2 - 300.5, ly + 0.5, 601, 25);
      }
      return [ly, ly + 24];
    }

    /* post-configure footer: the SAS log download link (when a log was
       captured) and the contextual next-step hint.  Rendered at yHint
       (text baseline).  Populates cfgHits.log with the link's hit box. */
    function drawConfigFooter(yHint) {
      var ly = yHint;
      if (configLog) {
        ctx.fillStyle = "#4da3ff";
        ctx.font = "bold 12px monospace";
        ctx.fillText("\u2193 download SAS log", W2, ly);
        cfgHits.log = [ly - 12, ly + 4];
        ly += 20;
      }
      ctx.fillStyle = configMsg ? "#ffb300" : "#8aa8d8";
      ctx.font = "12px monospace";
      var hint = configDone
        ? "RUN / ENTER to play - ESC to cancel"
        : (isViya
            ? "click a step to open it - TAB switches step - ENTER saves - ESC cancels"
            : "ENTER to save - ESC to cancel");
      ctx.fillText(configMsg || hint, W2, ly);
    }

    if (!isViya) {
      ctx.fillStyle = "#dbe7ff";
      ctx.font = "13px monospace";
      ctx.fillText("RESULTS FOLDER (scores.sas7bdat):", W2, 105);
      cfgHits.fields.rootdir = searchBox(configInput, true, 115);
      ctx.fillStyle = "#ffb300";
      ctx.font = "13px monospace";
      ctx.fillText(configMsg, W2, 280);
      ctx.fillStyle = "#8aa8d8";
      ctx.font = "12px monospace";
      ctx.fillText(configMsg ? "" :
        "ENTER to save - ESC to cancel", W2, 320);
      if (configMsg) {
        ctx.fillStyle = "#ffb300";
        ctx.fillText(configMsg, W2, 320);
      }
      drawConfigFooter(340);
      ctx.textAlign = "left";
      return;
    }

    var y = 74;
    var filtered, start, i;

    // ---- STEP 1: account (batch id) ----
    cfgHits.step1 = stepHeader(1, "ACCOUNT (batch id)",
      accountChosen || "(choose)", !!accountChosen,
      configField === "account", y);

    y += 34;
    /* filter line with ghost autocomplete: typed text bold, the rest of
       the highlighted item dimmed (it is the default on ENTER) */
    function filterLine(typedS, items, selIdx, fy) {
      var lx = W2 - 290;
      ctx.textAlign = "left";
      ctx.fillStyle = "#8aa8d8";
      ctx.font = "12px monospace";
      ctx.fillText("type to filter:", lx, fy);
      var lw = ctx.measureText("type to filter: ").width;
      ctx.font = "bold 13px monospace";
      ctx.fillStyle = "#43a047";
      ctx.fillText(typedS, lx + lw, fy + 1);
      var tw = ctx.measureText(typedS + (blink && !items.length ? "_" : "")).width;
      var cur = items[selIdx] || items[0];
      if (cur) {
        var ghost = "";
        if (!typedS) ghost = cur; // the default, shown in full
        else if (cur.toLowerCase().indexOf(typedS.toLowerCase()) === 0)
          ghost = cur.substring(typedS.length);
        if (ghost) {
          ctx.font = "13px monospace";
          ctx.fillStyle = "#44597a";
          ctx.fillText((blink && typedS ? "_" : "") + ghost, lx + lw + tw, fy + 1);
        }
      }
      ctx.textAlign = "center";
    }

    if (configField === "account") {
      var faccts = filteredAccounts();
      filterLine(accountFilter, faccts, accountIdx, y);
      y += 8;
      ctx.font = "14px monospace";
      if (!accounts.length) {
        ctx.fillStyle = "#8aa8d8";
        ctx.fillText(contexts === null ? "loading contexts..." :
          "(no reusable contexts with a runAs identity on this Viya)", W2, y + 14);
        y += 26;
      } else if (!faccts.length) {
        ctx.fillStyle = "#8aa8d8";
        ctx.fillText("(no accounts match)", W2, y + 14);
        y += 26;
      } else {
        start = Math.max(0, Math.min(accountIdx - 2, faccts.length - 5));
        faccts.slice(start, start + 5).forEach(function (a, i2) {
          var sel = start + i2 === accountIdx || accountChosen === a;
          var ry = y + i2 * 20;
          ctx.fillStyle = sel ? "#43a047" : "#8aa8d8";
          ctx.textAlign = "left";
          ctx.fillText((sel ? "> " : "  ") + a, W2 - 200, ry + 14);
          ctx.textAlign = "center";
          cfgHits.account.push({ y0: ry, y1: ry + 19, name: a });
        });
        y += Math.min(faccts.length, 5) * 20 + 6;
        if (faccts.length > 5) {
          ctx.fillStyle = "#44597a";
          ctx.font = "11px monospace";
          ctx.fillText((start + 1) + "-" + Math.min(start + 5, faccts.length) +
            " of " + faccts.length, W2, y + 8);
          y += 14;
        }
      }
      y += 8;
    }

    // ---- STEP 2: compute context ----
    cfgHits.step2 = stepHeader(2, "COMPUTE CONTEXT",
      ctxChosen || (accountChosen ? "(choose)" : "(pick account first)"),
      !!ctxChosen, configField === "context", y);
    y += 34;
    if (configField === "context") {
      filtered = filteredContexts();
      filterLine(ctxFilter,
        filtered.map(function (c) { return c.name; }), contextIdx, y);
      y += 8;
      ctx.font = "14px monospace";
      if (contexts !== null && !filtered.length) {
        ctx.fillStyle = "#8aa8d8";
        ctx.fillText("(no contexts match - clear the search)", W2, y + 14);
        y += 26;
      }
      start = Math.max(0, Math.min(contextIdx - 2, filtered.length - 5));
      filtered.slice(start, start + 5).forEach(function (c, i2) {
        var sel = start + i2 === contextIdx;
        var t = ctxTest[c.name];
        var ry = y + i2 * 20;
        ctx.fillStyle = t === "fail" ? "#e53935" : sel ? "#43a047" : "#8aa8d8";
        ctx.textAlign = "left";
        ctx.fillText((sel ? "> " : "  ") + c.name, W2 - 240, ry + 14);
        ctx.textAlign = "right";
        ctx.fillText(t === "testing" ? "testing..." : t === "ok" ? "OK" :
          t === "fail" ? "UNUSABLE" : "", W2 + 240, ry + 14);
        ctx.textAlign = "center";
        cfgHits.context.push({ y0: ry, y1: ry + 19, name: c.name });
      });
      y += Math.min(Math.max(filtered.length, 1), 5) * 20 + 6;
      ctx.fillStyle = "#44597a";
      ctx.font = "11px monospace";
      ctx.fillText("only reusable contexts (reuseServerProcesses) with a batch identity " +
        "(runServerAs) - T tests the highlighted one", W2, y + 8);
      y += 22;
    }

    // ---- STEP 3: results folder ----
    cfgHits.step3 = stepHeader(3, "RESULTS FOLDER",
      configInput || "(type the path)", !!configInput,
      configField === "rootdir", y);
    y += 34;
    if (configField === "rootdir") {
      cfgHits.fields.rootdir = searchBox(configInput, true, y);
      y += 44; // box is 24px tall + breathing room before the next header
    }

    // ---- STEP 4: execution option (Viya) ----
    /* The adapter's useComputeApi is three-state (web/jes/compute) and
       runAsTask only applies in web mode.  We collapse them into four
       concrete execution strategies the user picks by name: */
    var OPTS = [
      { name: "JES Web",      mode: "web",     task: false,
        json: "{useComputeApi:null, runAsTask:false}",
        desc: "reliable, streamed web app" },
      { name: "JES API",      mode: "jes",     task: false,
        json: "{useComputeApi:false, runAsTask:false}",
        desc: "jobs visible in Environment Manager" },
      { name: "Compute API", mode: "compute", task: false,
        json: "{useComputeApi:true, runAsTask:false}",
        desc: "fastest, not in Env Manager" },
      { name: "Run As Task", mode: "web",     task: true,
        json: "{useComputeApi:null, runAsTask:true}",
        desc: "JES web + _EXECUTIONTASKS (batch)" }
    ];
    /* derive the currently-selected option from the backend state so the
       highlight matches whatever was stamped/persisted */
    var curMode = backend.getApiMode ? backend.getApiMode() : "web";
    var curTask = backend.isRunAsTask();
    var optSel = (curMode === "web" && curTask) ? 3
      : curMode === "compute" ? 2
      : curMode === "jes" ? 1 : 0;
    if (configField !== "options") optSel = -1; // nothing highlighted
    var optLabel = OPTS[(optSel < 0 ?
      (curMode === "web" && curTask ? 3 : curMode === "compute" ? 2 :
       curMode === "jes" ? 1 : 0) : optSel)].name;
    cfgHits.step4 = stepHeader(4, "EXECUTION",
      optLabel + (curMode === "web" && !curTask ? "" : ""),
      true, configField === "options", y);
    cfgHits.options = null; cfgHits.opt = [];
    if (configField === "options") {
      var oy = y + 26;
      ctx.font = "14px monospace";
      ctx.textAlign = "left";
      OPTS.forEach(function (o, i) {
        var ry = oy + i * 22;
        var sel = i === optSel;
        ctx.fillStyle = sel ? "#43a047" : "#8aa8d8";
        ctx.fillText((sel ? "> " : "  ") + o.name, 60, ry + 14);
        // the adapter config object this option produces (educational)
        ctx.fillStyle = sel ? "#7fd08a" : "#5a7a9e";
        ctx.font = (sel ? "" : "") + "11px monospace";
        ctx.fillText(o.json, 175, ry + 14);
        ctx.fillStyle = sel ? "#7fd08a" : "#44597a";
        ctx.fillText(o.desc, 380, ry + 14);
        ctx.font = "14px monospace";
        cfgHits.opt.push({ y0: ry, y1: ry + 21, idx: i });
      });
      oy += OPTS.length * 22;
      ctx.textAlign = "center";
      ctx.fillStyle = "#44597a";
      ctx.font = "11px monospace";
      ctx.fillText("up/down or click to choose - ENTER saves", W2, oy + 8);
      y = oy + 16;
    } else {
      y += 26;
    }

    // verdict line
    ctx.font = "13px monospace";
    ctx.fillStyle = accountChosen && ctxChosen && configInput ? "#43a047" : "#44597a";
    var verdict = accountChosen && ctxChosen && configInput
      ? "READY - files will be created by " + accountChosen + " via \"" + ctxChosen + "\""
      : "files will be created by " + (accountChosen || "?") +
        " in context " + (ctxChosen || "?");
    ctx.fillText(verdict, W2, Math.max(y + 24, 420));

    ctx.fillStyle = configMsg ? "#ffb300" : "#8aa8d8";
    ctx.font = "12px monospace";
    drawConfigFooter(462);
    ctx.textAlign = "left";
  }


  // ---- finale screens ----
  function drawComplete() {
    compT++;
    var W = eng.viewWidth, H = eng.worldHeight;
    ctx.fillStyle = "#061224";
    ctx.fillRect(0, 0, W, H);

    // confetti
    confetti.forEach(function (f) {
      f.x += f.vx; f.y += f.vy; f.spin += 0.05;
      if (f.y > H) { f.y = -10; f.x = Math.random() * W; }
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.spin);
      ctx.fillStyle = f.color;
      if (f.semi) {
        ctx.font = "bold " + (16 + Math.round(f.w * 1.5)) + "px monospace";
        ctx.textAlign = "center";
        ctx.fillText(";", 0, 6);
      } else {
        ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
      }
      ctx.restore();
    });
    ctx.textAlign = "left";

    ctx.textAlign = "center";

    // runner slides in and takes a bow (bounces)
    var rx = Math.min(W / 2 - 24, -48 + compT * 6);
    var bounce = rx >= W / 2 - 24 ? Math.abs(Math.sin(compT / 12)) * 10 : 0;
    drawSprite(RUNNER[Math.floor(Date.now() / 200) % 2],
      rx, 300 - bounce, 48, 64, false, "#ffffff");

    // banner
    if (compT > 20) {
      ctx.globalAlpha = Math.min(1, (compT - 20) / 30);
      ctx.fillStyle = "#43a047";
      ctx.font = "bold 40px monospace";
      ctx.fillText("JOB COMPLETE", W / 2, 110);
      ctx.globalAlpha = 1;
    }

    // stats count in one by one
    var stats = [
      "NOTE: PROC PRINT completed - report teleported to HQ (Cary, NC).",
      "NOTE: Log is clean - every ERROR, WARNING and ABORT was stomped.",
      "TIME " + elapsed() + "s" +
        (player.newRecord ? "   *** NEW RECORD ***" : "") +
        "   (" + levelTimes.map(function (t, i) {
          return "L" + (i + 1) + " " + t.toFixed(1) + "s";
        }).join("  ") + ")"
    ];
    ctx.font = "16px monospace";
    stats.forEach(function (s, i) {
      var at = 70 + i * 45;
      if (compT === at) audio.collect();
      if (compT > at) {
        ctx.fillStyle = i === 0 ? "#dbe7ff" : i === 1 ? "#ffd54d" : "#4da3ff";
        fitText(s, 165 + i * 30, "", 16);
      }
    });

    // clean-log stamp
    if (player.errs === 0 && player.warns === 0 && compT > 210) {
      var flash = Math.floor(compT / 15) % 2;
      ctx.fillStyle = flash ? "#43a047" : "#7fd08a";
      ctx.font = "bold 22px monospace";
      ctx.fillText("0 ERRORS, 0 WARNINGS", W / 2, 290);
    }

    if (compT > 120 && Math.floor(Date.now() / 500) % 2) {
      ctx.fillStyle = "#8aa8d8";
      ctx.font = "14px monospace";
      ctx.fillText("ENTER / RUN for the high score board", W / 2, 430);
    }

    // auto-advance after ~7s
    if (compT > 420) { setBoardHash(); showBoard(); }
    ctx.textAlign = "left";
  }

  function drawBoard() {
    boardT++;
    boardHits.again = null; boardHits.home = null;
    var W = eng.viewWidth, H = eng.worldHeight;
    ctx.fillStyle = "#061224";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";

    ctx.fillStyle = "#ffd54d";
    ctx.font = "bold 32px monospace";
    ctx.fillText("HIGH SCORES", W / 2, 80);
    ctx.fillStyle = "#4da3ff";
    ctx.font = "14px monospace";
    ctx.fillText("MACRO DASH - FINAL RESULTS", W / 2, 110);

    var y = 155;
    if (backendOn && leaderboard.length) {
      ctx.fillStyle = "#8aa8d8";
      ctx.font = "13px monospace";
      ctx.fillText("RANK   NAME           TIME", W / 2, y);
      y += 14;
      leaderboard.slice(0, 8).forEach(function (s, i) {
        y += 24;
        var me = playerRank === i + 1;
        ctx.fillStyle = me ? "#43a047" : "#dbe7ff";
        ctx.font = (me ? "bold " : "") + "15px monospace";
        /* DNF rows show DNF instead of a time (finishers sort first) */
        var timeStr = (s.DONE === 0) ? "DNF" : s.TIME.toFixed(1) + "s";
        var row = (i + 1) + ".      " +
          (s.NAME + "            " ).slice(0, 12) + "  " + timeStr;
        fitText(row, y, me ? "bold " : "", 15);
      });
    } else {
      // offline: no shared leaderboard - just the local best run
      ctx.fillStyle = "#8aa8d8";
      ctx.font = "13px monospace";
      ctx.fillText(backendOn ? (scoresPending ? "saving run..." : "no scores yet - be the first!")
        : "personal bests (local only)", W / 2, y);
      y += 30;
      y = drawBestHistory(W, y, BEST_MAX);
      y += 30;
      ctx.fillStyle = "#dbe7ff";
      ctx.font = "16px monospace";
      ctx.fillText("THIS RUN:  " + elapsed() + "s", W / 2, y);
    }

    /* two on-screen buttons: PLAY AGAIN (restart) and HOME (title) */
    var by = 430;
    boardHits.again = [by - 16, by + 12, W / 2 - 140, W / 2 - 20];
    boardHits.home = [by - 16, by + 12, W / 2 + 20, W / 2 + 140];
    ctx.fillStyle = "#43a047";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.fillText("\u25B6 PLAY AGAIN", W / 2 - 80, by);
    ctx.fillStyle = "#4da3ff";
    ctx.fillText("\u2302 HOME", W / 2 + 80, by);
    ctx.textAlign = "left";
  }

  /* the ABEND dump: finish page for runs that ended in death.  Styled
   * like a SAS log dump (left-aligned log lines), with the high scores
   * (leaderboard when configured, personal best otherwise) underneath. */
  function drawDump() {
    boardT++;
    var W = eng.viewWidth, H = eng.worldHeight;
    ctx.fillStyle = "#061224";
    ctx.fillRect(0, 0, W, H);

    // log dump header
    ctx.textAlign = "left";
    var lines = [
      { t: "ERROR: Job aborted.  The SAS System stopped processing this job.", c: "#e53935" },
      { t: "NOTE: Dump of the WORK library follows.", c: "#8aa8d8" },
      { t: "      TIME " + elapsed() + "s" +
           (player.newRecord ? "   *** NEW RECORD ***" : ""), c: "#dbe7ff" }
    ];
    if (player.errs > 0 || player.warns > 0) {
      lines.push({ t: "      hits taken: " + player.errs + " ERROR, " +
        player.warns + " WARNING", c: "#e57373" });
    }
    ctx.font = "14px monospace";
    var ly = 70; // log lines start here
    lines.forEach(function (l, i) {
      var at = i * 20;
      if (boardT === at) audio.collect();
      if (boardT < at) return;
      ctx.fillStyle = l.c;
      ctx.fillText(l.t, 40, ly);
      ly += 24;
    });

    // high scores
    var y = ly + 46;
    ctx.textAlign = "center";
    if (boardT > 100) {
      ctx.fillStyle = "#ffd54d";
      ctx.font = "bold 24px monospace";
      ctx.fillText("HIGH SCORES", W / 2, y);
      y += 30;
      if (backendOn && leaderboard.length) {
        ctx.fillStyle = "#8aa8d8";
        ctx.font = "13px monospace";
        ctx.fillText("RANK   NAME           TIME", W / 2, y);
        y += 10;
        leaderboard.slice(0, 5).forEach(function (s, i) {
          y += 22;
          var me = playerRank === i + 1;
          ctx.fillStyle = me ? "#43a047" : "#dbe7ff";
          var row = (i + 1) + ".      " +
            (s.NAME + "            ").slice(0, 12) + "  " +
            s.TIME.toFixed(1) + "s";
          fitText(row, y, me ? "bold " : "", 15);
        });
      } else {
        ctx.fillStyle = "#8aa8d8";
        ctx.font = "13px monospace";
        ctx.fillText(backendOn ? (scoresPending ? "saving run..." : "no scores yet - be the first!")
          : "personal bests (local only)", W / 2, y);
        y += 26;
        drawBestHistory(W, y, 4);
      }
    }

    if (boardT > 120 && Math.floor(Date.now() / 500) % 2) {
      ctx.fillStyle = "#e53935";
      ctx.font = "bold 16px monospace";
      ctx.fillText("ENTER / RUN to resubmit the job", W / 2, 450);
    }
    ctx.textAlign = "left";
  }

  function draw() {
    if (state === "title") { drawTitle(); return; }
    if (state === "dump") { drawDump(); return; }
    if (state === "config") { drawConfig(); return; }
    if (state === "complete") { drawComplete(); return; }
    if (state === "board") { drawBoard(); return; }
    var cam = eng.cameraX(player.x);
    ctx.save();
    ctx.translate(-cam, 0);

    // background
    ctx.fillStyle = "#061224";
    ctx.fillRect(cam, 0, eng.viewWidth, eng.worldHeight);

    // tiles: base fill per cell, then decorate each contiguous run as a
    // mainframe rack (blinking lights), a keyboard (keycap rows) or a
    // terminal (screen glint) - deterministic per run
    var tileBlink = Math.floor(Date.now() / 350) % 2;
    var r, c, ch;
    for (r = 0; r < level.length; r++) {
      for (c = 0; c < level[r].length; c++) {
        ch = level[r][c];
        if (ch === "#" || ch === "=") {
          ctx.fillStyle = ch === "#" ? "#1a3a66" : "#2f5d9e";
          ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
          ctx.fillStyle = "#4da3ff";
          ctx.fillRect(c * TILE, r * TILE, TILE, 3);
        }
      }
    }
    for (r = 0; r < level.length; r++) {
      for (c = 0; c < level[r].length; c++) {
        ch = level[r][c];
        if (ch !== "#" && ch !== "=") continue;
        if (c > 0 && level[r][c - 1] === ch) continue; // run start only
        var len = 0;
        while (c + len < level[r].length && level[r][c + len] === ch) len++;
        var x0 = c * TILE, y0 = r * TILE, w0 = len * TILE;
        var kind = (r * 7 + c) % 3;
        if (ch === "#") {
          // ground = data-centre floor: drive bays with activity lights
          // (decorate only the topmost # of each column run)
          if (r > 0 && level[r - 1][c] === "#") continue;
          ctx.fillStyle = "#0f2745";
          for (var b = 0; b < len; b++)
            ctx.fillRect(x0 + b * TILE + 1, y0 + 10, 1, TILE - 14); // bay seams
          var lights = ["#43a047", "#ffb300"];
          for (var l = 0; l < len; l++) {
            ctx.fillStyle = ((l + tileBlink) % 2) ? lights[l % 2] : "#2f4a6e";
            ctx.fillRect(x0 + l * TILE + 22, y0 + 6, 3, 3);          // LEDs
          }
        } else if (kind === 0) {
          // mainframe rack: vent + blinking rack lights
          ctx.fillStyle = "#0f2745";
          ctx.fillRect(x0 + 3, y0 + TILE - 7, w0 - 6, 3);
          var rack = ["#e53935", "#43a047", "#ffb300"];
          for (var m = 0; m < Math.min(len * 2, 6); m++) {
            ctx.fillStyle = (m === (tileBlink ? 1 : 0)) ? rack[m % 3] : "#1a3a66";
            ctx.fillRect(x0 + 4 + m * 8, y0 + 5, 4, 3);
          }
        } else if (kind === 1) {
          // keyboard: two keycap rows
          ctx.fillStyle = "#16345c";
          for (var k = 0; k < len * 4; k++) {
            ctx.fillRect(x0 + 4 + k * 7, y0 + 8, 5, 4);
            ctx.fillRect(x0 + 6 + k * 7, y0 + 15, 5, 4);
          }
        } else {
          // terminal: dark screen with a pale glint
          ctx.fillStyle = "#0b1f3a";
          ctx.fillRect(x0 + 3, y0 + 6, w0 - 6, 12);
          ctx.fillStyle = tileBlink ? "#7fd08a" : "#2f5d9e";
          ctx.fillRect(x0 + 6, y0 + 8, 8, 2);
        }
      }
    }

    // portal (PROC PRINT)
    if (portal) {
      ctx.fillStyle = "#7C4DFF";
      ctx.fillRect(portal.x, portal.y, portal.w, portal.h);
      ctx.fillStyle = "#fff";
      ctx.font = "10px monospace";
      ctx.fillText("PRINT", portal.x - 6, portal.y - 6);
    }

    // ampersands (glyph centred on the tile, so the collect burst matches)
    ctx.fillStyle = "#ffd54d";
    ctx.font = "bold 20px monospace";
    ctx.textAlign = "center";
    amps.forEach(function (a) {
      if (!a.taken) ctx.fillText("&", a.x + a.w / 2, a.y + 16);
    });
    ctx.textAlign = "left";

    // format mushrooms
    shrooms.forEach(function (s) {
      if (s.taken) return;
      ctx.fillStyle = "#d32f2f";
      ctx.fillRect(s.x, s.y, s.w, s.h * 0.6);
      ctx.fillStyle = "#ffe0b2";
      ctx.fillRect(s.x + s.w * 0.3, s.y + s.h * 0.6, s.w * 0.4, s.h * 0.4);
      ctx.fillStyle = "#fff";
      ctx.font = "8px monospace";
      ctx.fillText("10.2", s.x + 2, s.y + 12);
    });

    // enemies: ERROR (red) / WARNING (amber) / ABORT (dark magenta, fast)
    enemies.forEach(function (e) {
      if (e.dead) return;
      ctx.fillStyle = e.type === "E" ? "#e53935" : e.type === "A" ? "#880e4f" : "#ffb300";
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = e.type === "A" ? "#fff" : "#000";
      ctx.font = e.type === "A" ? "bold 7px monospace" : "bold 9px monospace";
      ctx.fillText(e.type === "E" ? "ERR" : e.type === "A" ? "ABORT" : "WARN",
        e.x - 1, e.y + 12);
    });

    // player: pixelated SAS running man, blinking on iframes
    if (!(player.iframes > 0 && Math.floor(player.iframes / 4) % 2)) {
      var running = Math.abs(player.vx) > 5;
      var cycle = running ? [2, 3] : [0, 1];
      var frameIdx = player.moving
        ? cycle[Math.floor(player.animTick / (running ? 14 : 10)) % 2]
        : 0;
      drawSprite(RUNNER[frameIdx], player.x, player.y, player.w, player.h,
                 player.dir < 0, state === "dying" ? "#b71c1c" : "#ffffff");
    }

    // particles are stored in WORLD coordinates - draw them before the
    // camera restore, or they drift right by the camera offset
    drawParts();

    ctx.restore();

    // HUD: log status bar
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, eng.viewWidth, 24);
    ctx.fillStyle = "#333";
    ctx.fillRect(4, 4, eng.viewWidth - 8, 16);
    ctx.fillStyle = player.health > 50 ? "#43a047" : player.health > 20 ? "#ffb300" : "#e53935";
    ctx.fillRect(4, 4, (eng.viewWidth - 8) * (player.health / 100), 16);
    ctx.fillStyle = "#fff";
    ctx.font = "12px monospace";
    // live ERROR / WARNING counts for this level, reduced as you stomp them
    var liveE = 0, liveW = 0, liveA = 0;
    enemies.forEach(function (e) {
      if (e.dead) return;
      if (e.type === "E") liveE++; else if (e.type === "W") liveW++; else liveA++;
    });
    var hud = "LOG: ERRORS=" + liveE + " WARNINGS=" + liveW +
              (liveA ? " ABORTS=" + liveA : "") +
              "   TIME " + elapsed() + "s   " +
              (audio.state() === "running" ? "(sound on)" : "(SOUND " + audio.state().toUpperCase() + " - click canvas)");
    if (player.boost > 0) hud += "   [FORMAT 10.2: " + Math.ceil(player.boost / 60) + "s]";
    ctx.fillText(hud, 10, 17);

    // portal refusal: an ABORT is still outstanding
    if (gateMsg > 0) {
      gateMsg--;
      ctx.fillStyle = Math.floor(gateMsg / 8) % 2 ? "#e53935" : "#fff";
      ctx.font = "bold 16px monospace";
      ctx.textAlign = "center";
      ctx.fillText("ERROR: log not clean (" + gateDetail.trim() +
        ") - the job cannot complete", eng.viewWidth / 2, 60);
      ctx.textAlign = "left";
    }

    // level-name banner, first ~3s of play
    if (state === "play" && bannerT > 0) {
      bannerT--;
      ctx.globalAlpha = Math.min(1, bannerT / 40);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, 60, eng.viewWidth, 60);
      ctx.fillStyle = "#4da3ff";
      ctx.font = "bold 22px monospace";
      ctx.textAlign = "center";
      ctx.fillText("LEVEL " + (levelIdx + 1) + ": " + (LEVEL_NAMES[levelIdx] || ""),
        eng.viewWidth / 2, 96);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }

    if (state === "dead") {
      overlay("ERROR: Job aborted.",
        "TIME " + elapsed() + "s" +
        (player.newRecord ? "  *** NEW RECORD ***" : "") +
        "  [ENTER / RUN for the dump]");
    } else if (state === "winname") {
      overlay(runEnd === "dead" ? "ERROR: Job aborted." : "NOTE: PROC PRINT completed.",
        "SYSUSERID: " + initials + (Math.floor(Date.now() / 500) % 2 ? "_" : " ") +
        "   [ENTER saves, ESC skips]");
    } else if (state === "win") {
      var best = loadBest();
      var line2 = "LEVEL TIME " + levelTimes[levelIdx].toFixed(1) + "s" +
        "   RUNNING TOTAL " + elapsed() + "s";
      if (best) line2 += "  (BEST " + best.time.toFixed(1) + "s)";
      if (playerRank) line2 += "  RANK #" + playerRank;
      var prompt = levelIdx + 1 < LEVELS.length
        ? "[ENTER / RUN for Level " + (levelIdx + 2) + ": " +
          (LEVEL_NAMES[levelIdx + 1] || "") + "]"
        : "[ENTER / RUN]";
      overlay("NOTE: PROC PRINT completed.", line2, prompt);
    }
  }

  /* centered overlay with up to 3 lines; each line auto-shrinks until it
     fits the view width (long win stats used to spill off both edges) */
  function fitText(text, y, weight, px) {
    while (px > 8) {
      ctx.font = weight + px + "px monospace";
      if (ctx.measureText(text).width <= eng.viewWidth - 40) break;
      px--;
    }
    ctx.fillText(text, eng.viewWidth / 2, y);
  }

  function overlay(line1, line2, line3) {
    var h = line3 ? 110 : 80;
    var cy = eng.worldHeight / 2;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, cy - h / 2, eng.viewWidth, h);
    ctx.textAlign = "center";
    ctx.fillStyle = state === "dead" ? "#e53935" : "#43a047";
    fitText(line1, cy - (line3 ? 28 : 5), "bold ", 20);
    ctx.fillStyle = "#fff";
    fitText(line2, cy + (line3 ? 2 : 22), "", 14);
    if (line3) {
      ctx.fillStyle = "#8aa8d8";
      fitText(line3, cy + 30, "", 14);
    }
    ctx.textAlign = "left";
  }

  // Esc pauses/resumes (clock excludes paused time, music stops while paused)
  document.addEventListener("keydown", function (e) {
    if (e.code !== "Escape" || e.repeat) return;
    if (state === "play") {
      state = "pause";
      player.pauseT = performance.now();
      audio.stopMusic();
    } else if (state === "pause") {
      state = "play";
      player.startT += performance.now() - player.pauseT;
      player.levelStartT += performance.now() - player.pauseT;
      audio.startMusic();
    }
  });

  // title -> play, and restart after death/win, on a fresh Enter/R press
  // (e.repeat guards against keys still held from gameplay)
  var bannerT = 0; // frames remaining for the level-name banner

  function startPlay(newRun) {
    audio.unlock();
    init(newRun);
    parts = [];
    bannerT = 180; // ~3s
    state = "play";
    audio.startMusic();
  }

  document.addEventListener("keydown", function (e) {
    if (e._sbHandled) return; // consumed by the text-entry handler
    // H = HOME (title screen) from the board
    if (e.code === "KeyH" && !e.repeat && state === "board") { clearBoardHash(); state = "title"; return; }
    if (e.repeat || !(e.code === "Enter" || e.code === "KeyR")) return;
    if (state === "title") {
      levelIdx = 0; level = LEVELS[levelIdx]; eng.setLevel(level);
      startPlay(true); // fresh run from level 1
    } else if (state === "dead") {
      setBoardHash(); state = "dump"; boardT = 0; // the ABEND dump finish page
    } else if (state === "dump") {
      clearBoardHash();
      levelIdx = 0; level = LEVELS[levelIdx]; eng.setLevel(level);
      startPlay(true); // death ends the run - start again from level 1
    } else if (state === "win") {
      levelIdx++; level = LEVELS[levelIdx]; eng.setLevel(level);
      startPlay(false); // next level, same run (score/health/clock carry)
    } else if (state === "complete") {
      setBoardHash(); showBoard(); // skip the rest of the animation
    } else if (state === "board") {
      // ENTER / RUN = play again (the primary action); H = home (title)
      clearBoardHash();
      levelIdx = 0; level = LEVELS[levelIdx]; eng.setLevel(level);
      startPlay(true);
    }
  });

  // ---- main loop ----
  /* hash routing: #scores makes the high-score board a refreshable page.
   * We only manage the hash for the board state - play/title/etc keep a clean
   * URL.  On load and on hashchange (back/forward/refresh) we drive state
   * from the hash; when the game enters the board we set the hash, and clear
   * it when leaving. */
  function showBoard() {
    boardT = 0;
    playerRank = null;
    if (backendOn) refreshScores();
    state = "board";
  }
  function applyHash() {
    if (location.hash === "#scores") showBoard();
    else if (state === "board") state = "title";
  }
  function setBoardHash() {
    if (location.hash !== "#scores")
      history.replaceState(null, "", "#scores");
  }
  function clearBoardHash() {
    if (location.hash === "#scores")
      history.replaceState(null, "", location.pathname + location.search);
  }
  window.addEventListener("hashchange", applyHash);

  function frame() {
    if (state !== "pause") {
      update();
      updateParts();
      draw();
      // (particles draw inside draw(), under the camera transform)
    }
    if (state === "pause") {
      overlay("NOTE: Job suspended.", "press ESC to resume");
    }
    requestAnimationFrame(frame);
  }
  applyHash(); // deep-link: #scores on load shows the board
  frame();
})();
