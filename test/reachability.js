/* Macro Dash - reachability test.
 * Loads the REAL level + engine via a minimal DOM shim, then BFS-explores
 * every position the player can reach (walk/run/jump physics) and verifies
 * every '&' ampersand and the '|' portal can be touched.
 *
 * Run: node test/reachability.js
 */
"use strict";

// ---- minimal DOM shim for engine.js ----
var fakeCanvas = {
  getContext: function () { return {}; },
  width: 0,
  height: 0
};
global.window = global;
global.document = {
  createElement: function () { return Object.assign({}, fakeCanvas); }
};

require("../src/js/level.js");
require("../src/js/engine.js");

var GRAVITY = 0.8, RUN = 11, JUMP = -12.75, JUMP_HI = -16.25; // must match game.js
var levels = global.MACRODASH_LEVELS;
var failures = 0;

/* Jump margin checks.  The level budget is ~3 tiles (96px) for a normal jump
 * and ~5 tiles (160px) for FORMAT.  A jump that clears the budget by only a
 * pixel or two is technically reachable (the BFS below will pass) but
 * practically unmakeable by a human - so require real headroom.  The normal
 * jump must also stay BELOW 4 tiles, or the FORMAT gating breaks. */
var TILEPX = 32, MARGIN = 4;
var normalH = JUMP * JUMP / (2 * GRAVITY);
var hiH = JUMP_HI * JUMP_HI / (2 * GRAVITY);
console.log("jump heights: normal " + normalH.toFixed(1) + "px (" +
  (normalH / TILEPX).toFixed(2) + " tiles), FORMAT " + hiH.toFixed(1) +
  "px (" + (hiH / TILEPX).toFixed(2) + " tiles)");
if (normalH < 3 * TILEPX + MARGIN) {
  console.error("  FAIL normal jump too weak: " + normalH.toFixed(1) +
    "px < " + (3 * TILEPX + MARGIN) + "px (3 tiles + " + MARGIN + "px margin)");
  failures++;
}
if (normalH >= 4 * TILEPX) {
  console.error("  FAIL normal jump too strong: " + normalH.toFixed(1) +
    "px >= " + 4 * TILEPX + "px - 4-tile platforms would not need FORMAT");
  failures++;
}
if (hiH < 5 * TILEPX + MARGIN) {
  console.error("  FAIL FORMAT jump too weak: " + hiH.toFixed(1) +
    "px < " + (5 * TILEPX + MARGIN) + "px (5 tiles + " + MARGIN + "px margin)");
  failures++;
}

levels.forEach(function (level, li) {
  var eng = global.MACRODASH_ENGINE.create({ appendChild: function () {} }, level, {
    viewWidth: 800
  });
  var TILE = eng.TILE;

  // find spawn + targets
  var spawn = null, targets = [];
  for (var r = 0; r < level.length; r++) {
    for (var c = 0; c < level[r].length; c++) {
      var ch = level[r][c];
      if (ch === "P") spawn = { x: c * TILE, y: r * TILE };
      if (ch === "&") targets.push({ kind: "&", col: c, row: r,
        x: c * TILE + 8, y: r * TILE + 8, w: 16, h: 16 });
      if (ch === "|") targets.push({ kind: "|", col: c, row: r,
        x: c * TILE, y: (r - 1) * TILE, w: TILE, h: TILE * 2 });
    }
  }
  if (!spawn) { console.error("level " + li + ": no player spawn!"); failures++; return; }

  // BFS over quantized states. Actions: run left/right, optional jump when grounded.
  var PW = TILE - 6, PH = TILE - 2;
  var Q = 4; // quantization px

  function explore(jumpV) {
    var key = function (x, y, vy) { return Math.round(x / Q) + "," + Math.round(y / Q) + "," + Math.round(vy); };
    var seen = new Set();
    var queue = [{ x: spawn.x, y: spawn.y, vy: 0, onGround: false }];
    var reached = [];
    var MAX = 400000;
    while (queue.length && seen.size < MAX) {
      var s = queue.pop();
      var k = key(s.x, s.y, s.vy);
      if (seen.has(k)) continue;
      seen.add(k);
      reached.push(s);
      var dirs = [-RUN, 0, RUN];
      for (var d = 0; d < 3; d++) {
        var jumps = s.onGround ? [false, true] : [false];
        for (var j = 0; j < jumps.length; j++) {
          var e = { x: s.x, y: s.y, w: PW, h: PH, vx: dirs[d], vy: jumps[j] ? jumpV : s.vy };
          e.vy = Math.min(e.vy + GRAVITY, 16);
          eng.moveAndCollide(e);
          if (e.y > eng.worldHeight + 64) continue; // fell out
          queue.push({ x: e.x, y: e.y, vy: e.vy, onGround: e.onGround });
        }
      }
    }
    return { states: seen.size, reached: reached };
  }

  function canReach(res, t) {
    return res.reached.some(function (p) {
      return p.x < t.x + t.w && p.x + PW > t.x && p.y < t.y + t.h && p.y + PH > t.y;
    });
  }

  // mushroom-gated targets: the high & clusters (rows <= 5) must require FORMAT
  var boosted = explore(JUMP_HI);
  var normal = explore(JUMP);

  targets.forEach(function (t) {
    var gated = t.kind === "&" && t.row <= 5;
    if (!canReach(boosted, t)) {
      console.error("  FAIL " + t.kind + " at col " + t.col + " row " + t.row +
        " is UNREACHABLE even with FORMAT");
      failures++;
    } else if (gated && canReach(normal, t)) {
      console.error("  FAIL " + t.kind + " at col " + t.col + " row " + t.row +
        " should require FORMAT but is reachable with normal jump");
      failures++;
    } else {
      console.log("  OK   " + t.kind + " at col " + t.col + " row " + t.row +
        (gated ? " (FORMAT-gated)" : ""));
    }
  });
  console.log("level " + li + ": explored " + boosted.states + " boosted / " +
    normal.states + " normal states, " + targets.length + " targets checked");
});

if (failures) { console.error(failures + " FAILURE(S)"); process.exit(1); }
console.log("ALL REACHABLE");
