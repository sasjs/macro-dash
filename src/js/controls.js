/* Macro Dash - on-screen gameboy pad.
 * Binds the buttons in index.html (#pad-left/right/jump/run/start) to the
 * game's input via window.MACRODASH_PRESS (exposed by game.js), so pad
 * presses are indistinguishable from real key presses - including audio
 * unlock on first touch.  Mouse and touch both work; multi-touch is fine
 * because each button tracks its own press state.
 */
(function () {
  "use strict";

  var press = window.MACRODASH_PRESS;
  if (!press) return;

  function bind(id, code) {
    var el = document.getElementById(id);
    if (!el) return;
    var held = false;

    function down(e) {
      e.preventDefault();
      if (held) return;
      held = true;
      el.classList.add("held");
      press(code, true);
    }
    function up(e) {
      if (e) e.preventDefault();
      if (!held) return;
      held = false;
      el.classList.remove("held");
      press(code, false);
    }

    el.addEventListener("mousedown", down);
    el.addEventListener("touchstart", down, { passive: false });
    el.addEventListener("mouseup", up);
    el.addEventListener("mouseleave", up);
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", up);
    // releasing the mouse anywhere should not leave a button stuck down
    window.addEventListener("blur", up);
  }

  // brand header: click returns to the title screen (the "homepage")
  var brand = document.getElementById("brand");
  if (brand && window.MACRODASH_FORCE) {
    brand.addEventListener("click", function (e) {
      e.preventDefault();
      window.MACRODASH_FORCE("title");
    });
  }

  bind("pad-left", "ArrowLeft");
  bind("pad-right", "ArrowRight");
  bind("pad-up", "Space");       // up arrow = jump

  /* RUN doubles as action button: on title/win/dead/finale screens it acts
     as ENTER (start / retry / next level); on the setup screen it saves
     (the text-entry handler consumes that Enter); during play it is
     hold-to-run. */
  var getState = window.MACRODASH_STATE || function () { return "play"; };
  var runBtn = document.getElementById("pad-run");
  if (runBtn) {
    var runHeld = false;
    function runDown(e) {
      e.preventDefault();
      if (runHeld) return;
      runHeld = true;
      runBtn.classList.add("held");
      var s = getState();
      if (s !== "play" && s !== "pause") {
        // title, dead, win, winname, config, complete, board: RUN = ENTER
        document.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter" }));
      } else {
        press("ShiftLeft", true);
      }
    }
    function runUp(e) {
      if (e) e.preventDefault();
      if (!runHeld) return;
      runHeld = false;
      runBtn.classList.remove("held");
      press("ShiftLeft", false);
    }
    runBtn.addEventListener("mousedown", runDown);
    runBtn.addEventListener("touchstart", runDown, { passive: false });
    runBtn.addEventListener("mouseup", runUp);
    runBtn.addEventListener("mouseleave", runUp);
    runBtn.addEventListener("touchend", runUp);
    runBtn.addEventListener("touchcancel", runUp);
    window.addEventListener("blur", runUp);
  }
})();
