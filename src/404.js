/* The site's not-found page, for a static host that answers an unknown path
 * with it. The site's backend is a service worker, and a worker only answers a
 * page it already controls - so this installs the worker and asks for the same
 * address again.
 *
 * A retry can miss: the worker is active but the page that issued the
 * navigation is not controlled yet, and under load that window is wide enough
 * to swallow more than one attempt. Once the page IS controlled the next
 * navigation is certainly intercepted, so this keeps trying for a few attempts
 * and gives up when the cap is reached - at which point the address really is
 * not part of the site.
 *
 * The attempt counter is per address, not per tab: one missing link must not
 * exhaust the budget for every later deep link opened in the same tab. */
(function () {
  'use strict';

  var KEY = 'md-404-attempts';
  var MAX_ATTEMPTS = 3;
  var WAIT_ACTIVATED_MS = 2000;
  var WAIT_CONTROL_MS = 1000;

  var target = location.pathname + location.search + location.hash;
  var msg = document.getElementById('msg');

  function giveUp(text) {
    msg.textContent = text;
    msg.insertAdjacentHTML('afterend', '<p><a href="/">Open Macro Dash</a></p>');
  }

  function readAttempts() {
    try {
      var stored = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      /* a different address starts its own count, and clears the stale one */
      if (!stored || stored.target !== target) {
        sessionStorage.setItem(KEY, JSON.stringify({ target: target, n: 0 }));
        return 0;
      }
      return stored.n || 0;
    } catch (e) {
      return 0;
    }
  }

  function writeAttempts(n) {
    try { sessionStorage.setItem(KEY, JSON.stringify({ target: target, n: n })); } catch (e) { /* private mode */ }
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  if (!('serviceWorker' in navigator)) {
    giveUp('This browser cannot open the game from a direct link.');
    return;
  }

  var attempts = readAttempts();
  if (attempts >= MAX_ATTEMPTS) {
    giveUp('This page is not part of the published site.');
    return;
  }

  navigator.serviceWorker.register('/sw.js').then(function (reg) {
    return reg.ready.then(function () {
      /* an activating worker is not yet an intercepting one */
      var active = reg.active;
      if (active && active.state !== 'activated') {
        return Promise.race([
          new Promise(function (resolve) {
            active.addEventListener('statechange', function () {
              if (active.state === 'activated') resolve();
            });
          }),
          delay(WAIT_ACTIVATED_MS)
        ]);
      }
      return null;
    }).then(function () {
      if (navigator.serviceWorker.controller) return null;
      return Promise.race([
        new Promise(function (resolve) {
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        }),
        delay(WAIT_CONTROL_MS)
      ]);
    });
  }).catch(function () {
    /* the retry below either works or the next attempt says so */
  }).then(function () {
    writeAttempts(attempts + 1);
    location.replace(target);
  });
})();
