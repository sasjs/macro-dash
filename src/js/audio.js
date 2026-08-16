/* Macro Dash - WebAudio sound (all synthesized, no assets => CSP-safe).
 * AudioContext starts on first user gesture (autoplay policy). */
(function () {
  "use strict";

  var ctx = null;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function beep(freq, dur, type, gain) {
    var c = ensure();
    if (!c) return;
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || "square";
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.08, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur);
  }

  // ---- funky music loop (E-minor funk: bass, kick, snare, hats, lead) ----
  var BPM = 112;
  var STEP = 60 / BPM / 4; // 16th note
  var musicTimer = null;
  var nextStep = 0;
  var stepTime = 0;

  // 2-bar loop, 32 sixteenths. Bass: E E G E | A G E D (funk walk)
  var BASS = [
    41.2, 0, 41.2, 0, 49, 0, 41.2, 0, 41.2, 0, 55, 49, 41.2, 0, 36.7, 0,
    55, 0, 49, 0, 41.2, 0, 49, 0, 36.7, 0, 41.2, 0, 49, 0, 55, 61.7
  ];
  // lead riff (sparse, funky) - E5 pentatonic-ish
  var LEAD = [
    0, 0, 659, 0, 0, 587, 0, 0, 0, 0, 523, 587, 0, 0, 0, 0,
    0, 0, 784, 0, 0, 659, 0, 587, 0, 523, 0, 587, 0, 0, 0
  ];

  var noiseBuf = null;
  function noise(c) {
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 0.2, c.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var src = c.createBufferSource();
    src.buffer = noiseBuf;
    return src;
  }

  function playStep(step, t) {
    var c = ctx;
    // kick: beats 0 & 2 of each bar (steps 0,8,16,24)
    if (step % 8 === 0) {
      var k = c.createOscillator(), kg = c.createGain();
      k.type = "sine";
      k.frequency.setValueAtTime(120, t);
      k.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      kg.gain.setValueAtTime(0.25, t);
      kg.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      k.connect(kg); kg.connect(c.destination);
      k.start(t); k.stop(t + 0.16);
    }
    // snare: beats 1 & 3 (steps 4,12,20,28)
    if (step % 8 === 4) {
      var s = noise(c), sg = c.createGain(), sf = c.createBiquadFilter();
      sf.type = "highpass"; sf.frequency.value = 1500;
      sg.gain.setValueAtTime(0.15, t);
      sg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      s.connect(sf); sf.connect(sg); sg.connect(c.destination);
      s.start(t); s.stop(t + 0.12);
    }
    // hats: offbeat 8ths
    if (step % 2 === 1) {
      var h = noise(c), hg = c.createGain(), hf = c.createBiquadFilter();
      hf.type = "highpass"; hf.frequency.value = 7000;
      hg.gain.setValueAtTime(0.05, t);
      hg.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      h.connect(hf); hf.connect(hg); hg.connect(c.destination);
      h.start(t); h.stop(t + 0.05);
    }
    // bass
    var bf = BASS[step];
    if (bf) {
      var b = c.createOscillator(), bg = c.createGain(), blf = c.createBiquadFilter();
      b.type = "sawtooth";
      b.frequency.value = bf;
      blf.type = "lowpass"; blf.frequency.value = 400;
      bg.gain.setValueAtTime(0.2, t);
      bg.gain.exponentialRampToValueAtTime(0.001, t + STEP * 0.9);
      b.connect(blf); blf.connect(bg); bg.connect(c.destination);
      b.start(t); b.stop(t + STEP);
    }
    // lead
    var lf = LEAD[step];
    if (lf) {
      var l = c.createOscillator(), lg = c.createGain();
      l.type = "square";
      l.frequency.value = lf;
      lg.gain.setValueAtTime(0.07, t);
      lg.gain.exponentialRampToValueAtTime(0.001, t + STEP * 1.8);
      l.connect(lg); lg.connect(c.destination);
      l.start(t); l.stop(t + STEP * 2);
    }
  }

  function startMusic() {
    var c = ensure();
    if (!c || musicTimer) return;
    nextStep = 0;
    stepTime = c.currentTime + 0.1;
    musicTimer = setInterval(function () {
      // lookahead scheduler (schedule ~0.15s ahead)
      while (stepTime < c.currentTime + 0.15) {
        playStep(nextStep, stepTime);
        stepTime += STEP;
        nextStep = (nextStep + 1) % 32;
      }
    }, 40);
  }

  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  window.MACRODASH_AUDIO = {
    unlock: ensure,
    startMusic: startMusic,
    stopMusic: stopMusic,
    state: function () { return ctx ? ctx.state : "off"; },
    jingle: function () { // title screen: %LET %LET %LET arpeggio
      [330, 415, 494, 659, 494, 415].forEach(function (f, i) {
        setTimeout(function () { beep(f, 0.14, "triangle", 0.09); }, i * 90);
      });
    },
    jump: function () { beep(440, 0.12, "square", 0.12); },
    collect: function () { beep(880, 0.08, "sine"); beep(1320, 0.12, "sine", 0.05); },
    hurt: function () { beep(160, 0.25, "sawtooth", 0.12); },
    powerup: function () { [523, 659, 784, 1047].forEach(function (f, i) {
      setTimeout(function () { beep(f, 0.1, "square", 0.06); }, i * 70);
    }); },
    win: function () { [392, 523, 659, 784].forEach(function (f, i) {
      setTimeout(function () { beep(f, 0.15, "triangle", 0.08); }, i * 120);
    }); }
  };
})();
