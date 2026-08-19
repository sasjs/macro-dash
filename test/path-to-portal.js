/* BFS with parent pointers through the real engine physics, to find a
 * concrete move sequence (per-frame actions) that lands the player on the
 * level-1 portal. Output: a JSON array of action codes the browser test
 * can replay via MACRODASH_PRESS. */
"use strict";
var fakeCanvas = { getContext: function () { return {}; }, width: 0, height: 0 };
global.window = global;
global.document = { createElement: function () { return Object.assign({}, fakeCanvas); } };
require("../src/js/level.js");
require("../src/js/engine.js");
var GRAVITY = 0.8, RUN = 11, JUMP = -12.75, JUMP_HI = -16.25;
var level = global.MACRODASH_LEVELS[0];
var eng = global.MACRODASH_ENGINE.create({ appendChild: function () {} }, level, { viewWidth: 800 });
var TILE = eng.TILE;
var PW = TILE - 6, PH = TILE - 2, Q = 4;
var spawn = null, portalT = null;
for (var r = 0; r < level.length; r++) for (var c = 0; c < level[r].length; c++) {
  if (level[r][c] === "P") spawn = { x: c * TILE, y: r * TILE };
  if (level[r][c] === "|") portalT = { x: c * TILE, y: (r - 1) * TILE, w: TILE, h: TILE * 2 };
}
function overlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function key(x, y, vy) { return Math.round(x / Q) + "," + Math.round(y / Q) + "," + Math.round(vy); }
// BFS storing parent + action
var start = { x: spawn.x, y: spawn.y, vy: 0, onGround: false, parent: null, act: null };
var queue = [start];
var seen = new Set(); seen.add(key(start.x, start.y, start.vy));
var goal = null;
var dirs = [[-RUN,"L"],[0,""],[RUN,"R"]];
var MAX = 600000;
while (queue.length && seen.size < MAX) {
  var s = queue.shift();
  var body = { x: s.x, y: s.y, w: PW, h: PH };
  if (overlap(body, portalT)) { goal = s; break; }
  for (var d = 0; d < 3; d++) {
    var jumps = s.onGround ? [false, true] : [false];
    for (var j = 0; j < jumps.length; j++) {
      var e = { x: s.x, y: s.y, w: PW, h: PH, vx: dirs[d][0], vy: jumps[j] ? JUMP : s.vy };
      e.vy = Math.min(e.vy + GRAVITY, 16);
      eng.moveAndCollide(e);
      if (e.y > eng.worldHeight + 64) continue;
      var k = key(e.x, e.y, e.vy);
      if (seen.has(k)) continue;
      seen.add(k);
      var act = dirs[d][1] + (jumps[j] ? "J" : "");
      queue.push({ x: e.x, y: e.y, vy: e.vy, onGround: e.onGround, parent: s, act: act });
    }
  }
}
if (!goal) { console.error("no path found"); process.exit(1); }
// walk back to collect actions
var path = [];
for (var n = goal; n.parent; n = n.parent) path.unshift(n.act);
console.log("path length:", path.length);
require("fs").writeFileSync(__dirname + "/level1-path.json", JSON.stringify(path));
