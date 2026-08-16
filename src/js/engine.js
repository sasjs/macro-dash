/* Macro Dash - tiny canvas platformer engine (CSP-safe: no inline styles,
 * canvas sized via width/height attributes). */
(function () {
  "use strict";

  var TILE = 32;

  function createEngine(container, levelRows, opts) {
    var cols = 0;
    levelRows.forEach(function (r) { cols = Math.max(cols, r.length); });
    var rows = levelRows.length;

    var canvas = document.createElement("canvas");
    canvas.width = opts.viewWidth;
    canvas.height = rows * TILE;
    container.appendChild(canvas);
    var g = canvas.getContext("2d");

    function tileAt(col, row) {
      if (row < 0 || row >= rows) return ".";
      if (col < 0 || col >= cols) return "#"; // walls at edges
      var ch = levelRows[row][col];
      return ch === undefined ? "." : ch;
    }

    function solidAt(col, row) {
      var t = tileAt(col, row);
      return t === "#" || t === "=";
    }

    // AABB vs tilemap resolution
    function moveAndCollide(e) {
      // horizontal
      e.x += e.vx;
      var left = Math.floor(e.x / TILE);
      var right = Math.floor((e.x + e.w - 1) / TILE);
      var top = Math.floor(e.y / TILE);
      var bottom = Math.floor((e.y + e.h - 1) / TILE);
      for (var r = top; r <= bottom; r++) {
        if (e.vx > 0 && solidAt(right, r)) { e.x = right * TILE - e.w; e.vx = 0; e.hitWall = 1; }
        if (e.vx < 0 && solidAt(left, r)) { e.x = (left + 1) * TILE; e.vx = 0; e.hitWall = -1; }
      }
      // vertical
      e.y += e.vy;
      e.onGround = false;
      left = Math.floor(e.x / TILE);
      right = Math.floor((e.x + e.w - 1) / TILE);
      top = Math.floor(e.y / TILE);
      bottom = Math.floor((e.y + e.h - 1) / TILE);
      for (var c = left; c <= right; c++) {
        if (e.vy > 0 && solidAt(c, bottom)) { e.y = bottom * TILE - e.h; e.vy = 0; e.onGround = true; }
        if (e.vy < 0 && solidAt(c, top)) { e.y = (top + 1) * TILE; e.vy = 0; }
      }
    }

    function overlap(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    var api = {
      TILE: TILE,
      canvas: canvas,
      ctx: g,
      viewWidth: opts.viewWidth,
      tileAt: tileAt,
      solidAt: solidAt,
      moveAndCollide: moveAndCollide,
      overlap: overlap,
      cameraX: function (targetX) {
        var cam = targetX - opts.viewWidth / 2;
        return Math.max(0, Math.min(cam, cols * TILE - opts.viewWidth));
      },
      // swap in a new level map (same TILE size; canvas height adjusts)
      setLevel: function (newRows) {
        levelRows = newRows;
        cols = 0;
        newRows.forEach(function (r) { cols = Math.max(cols, r.length); });
        rows = newRows.length;
        canvas.height = rows * TILE;
        api.worldWidth = cols * TILE;
        api.worldHeight = rows * TILE;
      }
    };
    api.worldWidth = cols * TILE;
    api.worldHeight = rows * TILE;
    return api;
  }

  window.MACRODASH_ENGINE = { create: createEngine };
})();
