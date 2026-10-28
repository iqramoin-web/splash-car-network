(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =====================================================================
     Tunnel scene
     A car rolls up to a dark tunnel, the tunnel's light ribs ignite in a
     wave, and the camera tracks the car through the tube of light. Inside,
     it passes five wash stations (pre-soak, snow foam, soft-touch brushes,
     rinse, air dry), then emerges gleaming and drives off. Loops every LOOP s.
     ===================================================================== */

  var scene = document.querySelector('.scene');
  var back = scene.querySelector('.tunnel-back');
  var front = scene.querySelector('.tunnel-front');
  var car = scene.querySelector('.car');
  var sheen = scene.querySelector('.car-sheen');
  var foamCanvas = scene.querySelector('.car-foam');
  var wheels = scene.querySelectorAll('.wheel');
  var spins = scene.querySelectorAll('.spin');
  var stageEl = scene.querySelector('.wash-stage');
  var stepEl = scene.querySelector('.wash-step');
  var stageNameEl = scene.querySelector('.wash-name');
  var pauseBtn = scene.querySelector('.pause');
  var bctx = back.getContext('2d');
  var fctx = front.getContext('2d');
  var sctx = sheen.getContext('2d');
  var foctx = foamCanvas.getContext('2d');

  var CAR_RATIO = 809 / 1942;
  var LOOP = 12;

  // Timeline (seconds)
  var T = {
    approachEnd: 2.2,   // car decelerates to centre
    rampStart: 1.2,     // world starts moving (camera follows car)
    rampEnd: 2.4,
    cruiseEnd: 7.3,
    stopEnd: 8.7,
    clear: 8.0,         // car's tail leaves the exit gate
    revealStart: 8.2,
    revealEnd: 9.4,
    leaveStart: 10.1,
    leaveEnd: 11.4,
    fadeOutStart: 10.5,
    fadeOutEnd: 11.6
  };

  // Wash stations: the moment the car's centre reaches each one, and how long it is
  var STATIONS = [
    { key: 'spray', name: 'Pre-soak', at: 2.75, len: 0.7 },
    { key: 'foam', name: 'Snow foam', at: 3.55, len: 0.5 },
    { key: 'brush', name: 'Soft-touch clean', at: 4.75, len: 0.32 },
    { key: 'rinse', name: 'High-pressure rinse', at: 5.75, len: 0.42 },
    { key: 'dry', name: 'Air dry & shine', at: 6.75, len: 0.1 }
  ];
  var ST = {};

  var W, H, dpr, carW, carH, groundY, R, Hw, rise, camD, camY, horizonY, S, V;
  var portalIn, portalOut, wheelR;
  var colors = {};
  var streaks = [];
  var bubbles = [], droplets = [], drips = [], rain = [];
  var bubbleSprite = makeBubbleSprite();
  var currentStage = -1;

  var t = reduceMotion ? 5 : 0;
  var running = !reduceMotion;
  // ?t=4.5 freezes the scene at that moment (handy for screenshots and review)
  var frozenAt = parseFloat(new URLSearchParams(location.search).get('t'));
  if (frozenAt >= 0) { t = frozenAt % LOOP; running = false; }
  var visible = true;
  var wheelAngle = 0;
  var last = 0;

  function readColors() {
    var cs = getComputedStyle(root);
    ['rib', 'rib-hot', 'streak', 'floor', 'bloom', 'water'].forEach(function (k) {
      colors[k] = cs.getPropertyValue('--' + k).trim();
    });
    colors.blend = cs.getPropertyValue('--tunnel-blend').trim() || 'source-over';
    colors.strength = parseFloat(cs.getPropertyValue('--rib-strength')) || 1;
    colors.dark = root.dataset.theme === 'dark';
  }

  function rgba(key, a) {
    return 'rgba(' + colors[key] + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
  }

  function layout() {
    var rect = scene.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    carW = W < 600 ? W * 0.86 : Math.min(W * 0.58, 900);
    carH = carW * CAR_RATIO;
    groundY = H * (W < 600 ? 0.84 : 0.83);
    wheelR = carW * 0.1586 / 2;

    R = carW * 0.62;        // tunnel half-depth
    Hw = carH * 0.66;       // wall height
    rise = R * 0.5;         // ceiling arch height above the walls
    camD = R * 2.6;         // camera distance from the car plane
    camY = carH * 0.42;     // eye height
    horizonY = groundY - camY;
    S = carW * 0.19;        // rib spacing
    V = carW * 0.85;        // cruise speed (px/s in the car plane), slow enough to read the wash

    farHalf = profile(1);
    nearHalf = profile(-1);
    nearFloorPts = nearFloor();

    portalIn = carW * 0.12;
    portalOut = offsetAt(T.clear) - carW * 0.56;

    STATIONS.forEach(function (st) {
      ST[st.key] = { x: offsetAt(st.at) + carXAt(st.at) - st.len * carW / 2, len: st.len * carW };
    });

    [back, front].forEach(function (c) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    });
    sheen.width = foamCanvas.width = Math.round(carW * dpr);
    sheen.height = foamCanvas.height = Math.round(carH * dpr);
    car.style.width = carW + 'px';

    streaks = [];
    var n = W < 600 ? 34 : 64;
    for (var i = 0; i < n; i++) {
      var z = (Math.random() * 2 - 1) * R * 0.85;
      var ceil = Hw + rise * Math.sqrt(1 - (z / R) * (z / R));
      streaks.push({
        u: Math.random(),
        z: z,
        y: ceil * (0.08 + Math.random() * 0.86),
        len: 0.5 + Math.random(),
        a: 0.35 + Math.random() * 0.65
      });
    }

    // Foam bubbles on the bodywork (car-local px), denser on the upper surfaces
    bubbles = [];
    var nb = W < 600 ? 260 : 460;
    for (i = 0; i < nb; i++) {
      var by = Math.pow(Math.random(), 1.6);
      bubbles.push({
        x: Math.random() * carW,
        y: carH * (0.13 + by * 0.62),
        r: carW * (0.006 + Math.random() * Math.random() * 0.022),
        ph: Math.random() * 6.28
      });
    }
    droplets = [];
    for (i = 0; i < 140; i++) droplets.push({ x: Math.random() * carW, y: carH * (0.15 + Math.random() * 0.6), r: 0.6 + Math.random() * 1.6 });
    drips = [];
    for (i = 0; i < 60; i++) drips.push({ x: Math.random() * carW, ph: Math.random(), len: 0.04 + Math.random() * 0.07 });
    // Falling water / foam inside the stations (u across the station, z across the tunnel)
    rain = [];
    for (i = 0; i < 260; i++) rain.push({ u: Math.random(), z: (Math.random() * 2 - 1) * R * 0.85, ph: Math.random(), k: Math.random() });
  }

  function makeBubbleSprite() {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(26, 24, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(246,249,255,.96)');
    grad.addColorStop(0.85, 'rgba(205,218,240,.9)');
    grad.addColorStop(1, 'rgba(180,196,225,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(32, 32, 31, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  /* ---------- Motion curves ---------- */

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smooth(a, b, x) { x = clamp01((x - a) / (b - a)); return x * x * (3 - 2 * x); }
  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
  function easeInCubic(x) { return x * x * x; }

  // Car position in the car plane, relative to the scene centre
  function carXAt(time) {
    var start = -(W / 2 + carW * 0.65);
    if (time < T.approachEnd) return start * (1 - easeOutCubic(time / T.approachEnd));
    if (time < T.leaveStart) return 0;
    var p = clamp01((time - T.leaveStart) / (T.leaveEnd - T.leaveStart));
    return easeInCubic(p) * (W / 2 + carW * 0.65);
  }

  // How far the world has scrolled past the camera (integral of speed)
  function offsetAt(time) {
    var a = T.rampStart, b = T.rampEnd, c = T.cruiseEnd, d = T.stopEnd;
    var ramp = b - a, stop = d - c;
    if (time <= a) return 0;
    if (time <= b) return V * Math.pow(time - a, 2) / (2 * ramp);
    var wb = V * ramp / 2;
    if (time <= c) return wb + V * (time - b);
    var wc = wb + V * (c - b);
    var u = Math.min(time, d) - c;
    return wc + V * (u - u * u / (2 * stop));
  }

  function speedAt(time) {
    if (time <= T.rampStart || time >= T.stopEnd) return 0;
    if (time <= T.rampEnd) return V * (time - T.rampStart) / (T.rampEnd - T.rampStart);
    if (time <= T.cruiseEnd) return V;
    return V * (1 - (time - T.cruiseEnd) / (T.stopEnd - T.cruiseEnd));
  }

  // Ribs light up in a wave running down the tunnel
  function igniteFront(time) {
    var f = (time - 0.45) * W * 0.95;
    if (time > 1.7) f += Math.pow(time - 1.7, 2) * W * 8;
    return f;
  }

  function tunnelAlpha(time) {
    return smooth(0, 0.7, time) * (1 - smooth(T.fadeOutStart, T.fadeOutEnd, time));
  }

  /* ---------- Projection ---------- */

  function px(x, z) { return W / 2 + x * camD / (camD + z); }
  function py(y, z) { return horizonY - (y - camY) * camD / (camD + z); }

  // Rib cross-section: half-profiles from ceiling centre down to the floor.
  var PROFILE_STEPS = 18;
  function profile(side) { // side = +1 far half, -1 near half
    var pts = [];
    for (var i = 0; i <= PROFILE_STEPS; i++) {
      var a = (Math.PI / 2) * (1 - i / PROFILE_STEPS);
      pts.push([side * R * Math.cos(a), Hw + rise * Math.sin(a)]);
    }
    if (side > 0) pts.push([R, 0]);
    return pts; // [z, y]
  }
  // Near-side floor strip (the near wall is left out so it never crosses the car)
  function nearFloor() { return [[-R, 0], [-R * 0.25, 0]]; }
  var farHalf, nearHalf, nearFloorPts;

  function strokeRib(ctx, x, pts, width, alpha, hot) {
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var z = pts[i][0], y = pts[i][1];
      var sx = px(x, z), sy = py(y, z);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.lineWidth = width * 6;
    ctx.strokeStyle = rgba('rib', alpha * 0.16);
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = rgba(hot ? 'rib-hot' : 'rib', alpha);
    ctx.stroke();
  }

  function line3(ctx, x1, x2, y, z, width, color) {
    ctx.beginPath();
    ctx.moveTo(px(x1, z), py(y, z));
    ctx.lineTo(px(x2, z), py(y, z));
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  function glow(ctx, x, y, r, key, a) {
    if (a <= 0.002) return;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(key, a));
    g.addColorStop(1, rgba(key, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /* ---------- Frame ---------- */

  function render(time, dt) {
    var off = offsetAt(time);
    var speed = speedAt(time);
    var carX = carXAt(time);
    var carVel = (carXAt(time + 0.01) - carX) / 0.01;
    var alpha = tunnelAlpha(time) * colors.strength;
    var reveal = smooth(T.revealStart, T.revealStart + 0.5, time) * (1 - smooth(T.leaveStart + 0.4, T.fadeOutEnd, time));
    var inIn = portalIn - off, inOut = portalOut - off; // gate positions relative to camera
    var lim = (W / 2 + 120) * (camD + R) / camD;
    var igniteAt = igniteFront(time);

    // Car transform + wheels
    var bob = speed > 0 ? Math.sin(time * 38) * 0.35 * (speed / V) : 0;
    car.style.transform = 'translate3d(' + (W / 2 - carW / 2 + carX).toFixed(2) + 'px,' + (groundY - carH * 0.883 + bob).toFixed(2) + 'px,0)';
    var ground = carVel + speed;
    wheelAngle += ground * dt / wheelR;
    var deg = (wheelAngle * 57.2958) % 360;
    var blur = smooth(6, 26, Math.abs(ground / wheelR)).toFixed(2); // rad/s -> motion blur
    for (var w = 0; w < wheels.length; w++) {
      wheels[w].style.transform = 'rotate(' + deg.toFixed(1) + 'deg)';
      spins[w].style.opacity = blur;
    }

    [bctx, fctx].forEach(function (c) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, W, H);
      c.globalCompositeOperation = colors.blend;
      c.lineCap = 'round';
      c.lineJoin = 'round';
    });

    var x1 = Math.max(inIn, -lim), x2 = Math.min(inOut, lim);
    var tunnelOnScreen = x2 > x1;

    // Is the camera (and car) currently inside the tube?
    var inside = smooth(-carW * 0.3, carW * 0.2, -inIn) * smooth(-carW * 0.3, carW * 0.2, inOut);

    // Ambient light inside the tunnel
    glow(bctx, W / 2 + carX, groundY - carH * 0.5, carW * 0.9, 'bloom', 0.16 * alpha * inside);

    if (tunnelOnScreen) {
      // Floor slab
      var fg = bctx.createLinearGradient(0, py(0, R), 0, py(0, -R));
      fg.addColorStop(0, rgba('floor', 0));
      fg.addColorStop(1, rgba('floor', (colors.dark ? 0.35 : 0.5) * alpha));
      bctx.fillStyle = fg;
      bctx.beginPath();
      bctx.moveTo(px(x1, R), py(0, R));
      bctx.lineTo(px(x2, R), py(0, R));
      bctx.lineTo(px(x2, -R), py(0, -R));
      bctx.lineTo(px(x1, -R), py(0, -R));
      bctx.closePath();
      bctx.fill();

      // Longitudinal light rails
      var rail = rgba('rib', 0.45 * alpha * smooth(0.6, 2.2, time));
      line3(bctx, x1, x2, Hw + rise, 0, 1.2, rail);
      line3(bctx, x1, x2, Hw, R, 1, rail);
      line3(bctx, x1, x2, 0, R, 1, rail);
      line3(bctx, x1, x2, carH * 0.08, R * 0.55, 2, rgba('rib-hot', 0.5 * alpha * smooth(1, 2.4, time))); // floor guide light
      line3(fctx, x1, x2, Hw, -R, 1.4, rgba('rib', 0.18 * alpha));
      line3(fctx, x1, x2, 0, -R, 1.4, rgba('rib', 0.18 * alpha));

      // Ribs
      var kStart = Math.max(0, Math.ceil((x1 - inIn) / S));
      var kEnd = Math.min(Math.floor((portalOut - portalIn) / S), Math.floor((x2 - inIn) / S));
      var kLast = Math.floor((portalOut - portalIn) / S);
      for (var k = kStart; k <= kEnd; k++) {
        var xw = portalIn + k * S;
        var xr = xw - off;
        var lit = smooth(0, S * 1.5, igniteAt - k * S);
        var gate = k === 0 || k === kLast;
        var a = alpha * (0.14 + 0.86 * lit);
        var width = gate ? 3.4 : 1.6;
        strokeRib(bctx, xr, farHalf, width, a, gate);
        strokeRib(fctx, xr, nearHalf, width * 1.5, a * 0.3, gate);
        strokeRib(bctx, xr, nearFloorPts, width * 1.4, a * 0.45, gate);
      }

      // Gate blooms
      glow(bctx, px(inIn, 0), py(Hw * 0.7, 0), R * 0.9, 'bloom', 0.28 * alpha * smooth(0.4, 1.0, time));
    }
    // Light at the end of the tunnel / open space after the exit
    var exitGlowA = alpha * smooth(-W, 0, -(inOut - W / 2)) * 0.4 + 0.22 * reveal * colors.strength;
    glow(bctx, Math.max(px(inOut, 0), W * 0.25), py(Hw * 0.5, 0), R * 1.05, 'bloom', exitGlowA * (colors.dark ? 0.32 : 0.3));

    // Ground glow under the car
    glow(bctx, W / 2 + carX, groundY, carW * 0.55, 'bloom', (0.14 * inside * alpha + 0.3 * reveal) * (colors.dark ? 1 : 0.6));

    // Speed streaks
    if (speed > 1) {
      var span = lim * 2;
      var sp = speed / V;
      for (var i = 0; i < streaks.length; i++) {
        var p = streaks[i];
        var rel = ((p.u * span - off) % span + span) % span - span / 2;
        if (rel < x1 || rel > x2) continue;
        var ctx = bctx;
        var s = camD / (camD + p.z);
        var sx = px(rel, p.z), sy = py(p.y, p.z);
        var len = (12 + speed * 0.12 * p.len) * s;
        var g = ctx.createLinearGradient(sx, 0, sx + len, 0);
        g.addColorStop(0, rgba('streak', p.a * sp * alpha));
        g.addColorStop(1, rgba('streak', 0));
        ctx.strokeStyle = g;
        ctx.lineWidth = Math.max(1, 1.6 * s);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + len, sy);
        ctx.stroke();
      }
    }

    drawWash(time, off, carX, alpha);

    // Light passing over the bodywork
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.clearRect(0, 0, carW, carH);
    var skew = -0.35;
    sctx.transform(1, 0, skew, 1, -skew * carH, 0);
    if (tunnelOnScreen) {
      var bw = carW * 0.045;
      var k0 = Math.max(0, Math.ceil((carX - carW - inIn) / S));
      var k1 = Math.min(kLast, Math.floor((carX + carW - inIn) / S));
      for (var j = k0; j <= k1; j++) {
        var lx = portalIn + j * S - off - carX + carW / 2;
        var la = 0.42 * alpha * smooth(0, S * 1.5, igniteAt - j * S);
        bandOnCar(lx, bw, la);
      }
    }
    var rp = clamp01((time - T.revealStart) / (T.revealEnd - T.revealStart));
    if (rp > 0 && rp < 1) bandOnCar(-carW * 0.2 + rp * carW * 1.5, carW * 0.16, 0.75 * Math.sin(Math.PI * rp));
  }

  /* ---------- Wash ---------- */

  function ceilingAt(z) { return Hw + rise * Math.sqrt(Math.max(0, 1 - (z / R) * (z / R))); }

  function drawWash(time, off, carX, alpha) {
    var cw = carW;
    // A station's start, in car-local x: points right of it have already passed it
    function edge(st) { return st.x - off - carX + cw / 2; }
    var eSpray = edge(ST.spray), eFoam = edge(ST.foam), eRinse = edge(ST.rinse), eDry = edge(ST.dry);
    var dark = colors.dark;

    // --- Equipment and falling water in the tunnel ---
    STATIONS.forEach(function (meta) {
      var st = ST[meta.key];
      var sx0 = st.x - off, sx1 = sx0 + st.len;
      if (sx1 < -W || sx0 > W) return;
      var a = alpha * smooth(0, S * 3, igniteFront(time) - (st.x - portalIn)); // switches on with the tunnel lights

      // Nozzle ring on the gantry
      for (var n = 0; n <= 10; n++) {
        var pz = farHalf[Math.round(n * (farHalf.length - 2) / 10)];
        bctx.fillStyle = rgba('rib-hot', 0.9 * a);
        bctx.beginPath();
        bctx.arc(px(sx0, pz[0]), py(pz[1], pz[0]), 2.2, 0, 6.283);
        bctx.fill();
      }

      if (meta.key === 'brush') return drawBrushes(time, sx0, st.len, a);
      if (meta.key === 'dry') return drawAirBlade(time, sx0, a);

      // Soft curtain of spray / foam
      var curtainA = { spray: 0.1, foam: dark ? 0.16 : 0.22, rinse: 0.22 }[meta.key] * a;
      var top = py(ceilingAt(0), 0), bottom = py(0, -R);
      var cg = bctx.createLinearGradient(0, top, 0, bottom);
      var key = meta.key === 'foam' ? '255,255,255' : colors.water;
      cg.addColorStop(0, 'rgba(' + key + ',0)');
      cg.addColorStop(0.35, 'rgba(' + key + ',' + curtainA.toFixed(3) + ')');
      cg.addColorStop(1, 'rgba(' + key + ',' + (curtainA * 0.5).toFixed(3) + ')');
      bctx.fillStyle = cg;
      bctx.fillRect(px(sx0, 0), top, px(sx1, 0) - px(sx0, 0), bottom - top);
      if (meta.key === 'rinse') {
        // a brighter high-pressure sheet in front of the car
        fctx.fillStyle = 'rgba(' + colors.water + ',' + (0.12 * a).toFixed(3) + ')';
        fctx.fillRect(px(sx0 + st.len * 0.35, -R * 0.4), py(ceilingAt(0) * 0.9, -R * 0.4), st.len * 0.25, py(0, -R * 0.4) - py(ceilingAt(0) * 0.9, -R * 0.4));
      }

      // Falling drops
      var count = meta.key === 'rinse' ? 260 : meta.key === 'foam' ? 150 : 170;
      var fall = meta.key === 'foam' ? 0.9 : 1.9;
      for (var i = 0; i < count; i++) {
        var d = rain[i];
        var ceil = ceilingAt(d.z);
        var y = ceil * (1 - ((d.ph + time * fall * (0.8 + d.k * 0.4)) % 1));
        var xr = sx0 + d.u * st.len;
        var ctx = d.z < 0 ? fctx : bctx;
        var s = camD / (camD + d.z);
        var dx = px(xr, d.z), dy = py(y, d.z);
        var da = a * (d.z < 0 ? 0.45 : 0.8) * (0.4 + d.k * 0.6);
        if (meta.key === 'foam') {
          ctx.fillStyle = 'rgba(255,255,255,' + (da * (dark ? 0.85 : 1)).toFixed(3) + ')';
          if (!dark) { ctx.strokeStyle = 'rgba(120,150,210,' + (da * 0.5).toFixed(3) + ')'; ctx.lineWidth = 0.8; }
          ctx.beginPath();
          ctx.arc(dx, dy, (1.5 + d.k * 3.5) * s, 0, 6.283);
          ctx.fill();
          if (!dark) ctx.stroke();
        } else {
          ctx.strokeStyle = 'rgba(' + colors.water + ',' + da.toFixed(3) + ')';
          ctx.lineWidth = Math.max(0.8, (meta.key === 'rinse' ? 1.6 : 1.1) * s);
          ctx.beginPath();
          ctx.moveTo(dx, dy);
          ctx.lineTo(dx - 3 * s, dy - (meta.key === 'rinse' ? 26 : 16) * s);
          ctx.stroke();
        }
      }
      // Splashes on the floor
      for (var j = 0; j < 24; j++) {
        var q = rain[j + 100];
        var life = (q.ph + time * 2.4) % 1;
        var fx = px(sx0 + q.u * st.len, q.z), fy = py(0, q.z);
        var rr = (2 + life * 9) * camD / (camD + q.z);
        bctx.strokeStyle = 'rgba(' + (meta.key === 'foam' ? '255,255,255' : colors.water) + ',' + ((1 - life) * 0.5 * a).toFixed(3) + ')';
        bctx.lineWidth = 1;
        bctx.beginPath();
        bctx.ellipse(fx, fy, rr, rr * 0.28, 0, Math.PI, 0);
        bctx.stroke();
      }
    });

    // --- On the car itself ---
    foctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    foctx.clearRect(0, 0, cw, carH);
    if (alpha <= 0.01) return;

    // Foam blanket: builds from the foam gantry, is washed off at the rinse
    var span = eRinse + cw * 0.12 - eFoam;
    if (eFoam < cw && eRinse + cw * 0.12 > 0 && span > 0) {
      var g = foctx.createLinearGradient(eFoam, 0, eRinse + cw * 0.12, 0);
      var A = (dark ? 0.62 : 0.7) * alpha;
      g.addColorStop(0, 'rgba(250,252,255,0)');
      g.addColorStop(clamp01(cw * 0.25 / span), 'rgba(250,252,255,' + A.toFixed(3) + ')');
      g.addColorStop(clamp01((eRinse - eFoam) / span), 'rgba(250,252,255,' + A.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(250,252,255,0)');
      foctx.fillStyle = g;
      foctx.fillRect(0, carH * 0.08, cw, carH * 0.8);
    }

    // Bubbles, wobbling harder while the brushes scrub
    var eBrush = edge(ST.brush);
    for (var b = 0; b < bubbles.length; b++) {
      var bb = bubbles[b];
      var f = smooth(0, cw * 0.25, bb.x - eFoam) * (1 - smooth(0, cw * 0.1, bb.x - eRinse));
      if (f <= 0.02) continue;
      var scrub = 1 - smooth(0, cw * 0.18, Math.abs(bb.x - eBrush - ST.brush.len / 2));
      var wob = Math.sin(time * (3 + scrub * 14) + bb.ph) * (0.6 + scrub * 2.5);
      var r = bb.r * f * (1 + scrub * 0.15);
      foctx.globalAlpha = alpha * (dark ? 0.9 : 1);
      foctx.drawImage(bubbleSprite, bb.x - r + wob, bb.y - r - wob * 0.4, r * 2, r * 2);
    }
    foctx.globalAlpha = 1;

    // Water beads from the pre-soak until the air blade
    for (var d2 = 0; d2 < droplets.length; d2++) {
      var dp = droplets[d2];
      var wet = smooth(0, cw * 0.1, dp.x - eSpray) * (1 - smooth(0, cw * 0.05, dp.x - eDry));
      if (wet <= 0.02) continue;
      foctx.fillStyle = 'rgba(255,255,255,' + (0.75 * wet * alpha).toFixed(3) + ')';
      foctx.beginPath();
      foctx.arc(dp.x, dp.y, dp.r, 0, 6.283);
      foctx.fill();
    }

    // Rinse water running down the panels
    foctx.lineCap = 'round';
    for (var r2 = 0; r2 < drips.length; r2++) {
      var dr = drips[r2];
      var since = dr.x - eRinse;
      var ra = smooth(0, cw * 0.05, since) * (1 - smooth(cw * 0.3, cw * 1.1, since)) * (1 - smooth(0, cw * 0.05, dr.x - eDry));
      if (ra <= 0.02) continue;
      var yy = carH * (0.12 + ((dr.ph + time * 0.9) % 1) * 0.7);
      var dg = foctx.createLinearGradient(0, yy - carH * dr.len, 0, yy);
      dg.addColorStop(0, 'rgba(235,244,255,0)');
      dg.addColorStop(1, 'rgba(235,244,255,' + (0.8 * ra * alpha).toFixed(3) + ')');
      foctx.strokeStyle = dg;
      foctx.lineWidth = 1.4;
      foctx.beginPath();
      foctx.moveTo(dr.x, yy - carH * dr.len);
      foctx.lineTo(dr.x, yy);
      foctx.stroke();
    }

    // Wash stage label
    var carWorld = off + carX;
    var stage = -1;
    for (var si = 0; si < STATIONS.length; si++) {
      var stt = ST[STATIONS[si].key];
      if (carWorld + cw * 0.5 >= stt.x) stage = si;
    }
    if (carWorld - cw * 0.3 > ST.dry.x + ST.dry.len || alpha < 0.3) stage = -1;
    if (stage !== currentStage) {
      currentStage = stage;
      stageEl.classList.toggle('on', stage >= 0);
      if (stage >= 0) {
        stepEl.textContent = '0' + (stage + 1);
        stageNameEl.textContent = STATIONS[stage].name;
      }
    }
  }

  // Two rotating soft-touch brushes: one behind the car, one in front (see-through)
  function drawBrushes(time, x0, len, a) {
    var top = ceilingAt(0) * 0.78;
    [[R * 0.45, bctx, 0.55], [-R * 0.55, fctx, 0.28]].forEach(function (b) {
      var z = b[0], ctx = b[1], k = b[2] * a;
      var cx = x0 + len / 2, rad = len / 2;
      var s = camD / (camD + z);
      var left = px(cx - rad, z), right = px(cx + rad, z);
      var yt = py(top, z), yb = py(0, z);
      var bg = ctx.createLinearGradient(left, 0, right, 0);
      bg.addColorStop(0, 'rgba(' + colors.rib + ',0)');
      bg.addColorStop(0.5, 'rgba(' + colors.rib + ',' + (0.18 * k).toFixed(3) + ')');
      bg.addColorStop(1, 'rgba(' + colors.rib + ',0)');
      ctx.fillStyle = bg;
      ctx.fillRect(left, yt, right - left, yb - yt);
      // bristle strands sweeping round the core
      ctx.lineWidth = Math.max(1, 1.3 * s);
      for (var i = 0; i < 16; i++) {
        var ang = time * 9 + i * 0.3927;
        var c = Math.cos(ang);
        if (Math.sin(ang) < 0 && z < 0) continue; // hide strands on the far side of the front brush
        var sx = px(cx + c * rad * 0.95, z);
        ctx.strokeStyle = 'rgba(' + colors['rib-hot'] + ',' + ((0.35 + 0.45 * Math.abs(Math.sin(ang))) * k).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(sx, yt);
        ctx.lineTo(sx + Math.sin(time * 4 + i) * 2, yb);
        ctx.stroke();
      }
      // core
      ctx.strokeStyle = 'rgba(' + colors['rib-hot'] + ',' + (0.8 * k).toFixed(3) + ')';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(px(cx, z), yt - 6 * s);
      ctx.lineTo(px(cx, z), yb);
      ctx.stroke();
    });
  }

  // Air blade: a thin sheet of light with mist blown back off the car
  function drawAirBlade(time, x0, a) {
    var top = py(ceilingAt(0) * 0.85, 0), bottom = py(0, 0);
    var bx = px(x0, 0);
    glow(bctx, bx, (top + bottom) / 2, carH * 0.7, 'bloom', 0.25 * a);
    var g = fctx.createLinearGradient(bx - 6, 0, bx + 6, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(235,242,255,' + (0.55 * a).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    fctx.fillStyle = g;
    fctx.fillRect(bx - 6, top, 12, bottom - top);
    for (var i = 0; i < 30; i++) {
      var d = rain[i];
      var life = (d.ph + time * 1.8) % 1;
      var mx = bx - life * carW * 0.35, my = top + d.u * (bottom - top);
      bctx.strokeStyle = 'rgba(' + colors.water + ',' + ((1 - life) * 0.5 * a).toFixed(3) + ')';
      bctx.lineWidth = 1;
      bctx.beginPath();
      bctx.moveTo(mx, my);
      bctx.lineTo(mx - 18, my + 2);
      bctx.stroke();
    }
  }

  function bandOnCar(x, bw, a) {
    if (a <= 0.003) return;
    var g = sctx.createLinearGradient(x - bw, 0, x + bw, 0);
    g.addColorStop(0, 'rgba(190,210,255,0)');
    g.addColorStop(0.5, 'rgba(225,235,255,' + a.toFixed(3) + ')');
    g.addColorStop(1, 'rgba(190,210,255,0)');
    sctx.fillStyle = g;
    sctx.fillRect(x - bw, 0, bw * 2, carH);
  }

  function frame(now) {
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    if (running && visible) {
      t += dt;
      if (t >= LOOP) { t -= LOOP; wheelAngle = 0; }
      render(t, dt);
    }
    requestAnimationFrame(frame);
  }

  function redraw() { render(t, 0); }

  readColors();
  layout();
  redraw();

  window.addEventListener('resize', function () { layout(); redraw(); });

  if (!reduceMotion) {
    requestAnimationFrame(frame);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; }).observe(scene);
    }
  }

  pauseBtn.addEventListener('click', function () {
    running = !running;
    pauseBtn.setAttribute('aria-pressed', String(!running));
    pauseBtn.setAttribute('aria-label', running ? 'Pause animation' : 'Play animation');
  });

  /* =====================================================================
     Review panel (?review in the URL): switch direction and title wording
     ===================================================================== */

  var params = new URLSearchParams(location.search);
  var review = document.querySelector('.review');
  if (params.has('review')) {
    review.hidden = false;
    var dirButtons = review.querySelectorAll('[data-direction]');
    var syncDir = function () {
      dirButtons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.direction === root.dataset.theme)); });
    };
    dirButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        root.dataset.theme = b.dataset.direction;
        params.set('direction', b.dataset.direction);
        history.replaceState(null, '', '?' + params.toString().replace('review=', 'review') + location.hash);
        readColors();
        redraw();
        syncDir();
      });
    });
    syncDir();

    var title = document.getElementById('hero-title');
    review.querySelector('.review-title-select').addEventListener('change', function (e) {
      title.innerHTML = e.target.value; // values are fixed strings in index.html
    });
  }

  /* =====================================================================
     Contact form
     ===================================================================== */

  var form = document.querySelector('.contact-form');
  var status = form.querySelector('.form-status');
  var sendBtn = form.querySelector('.send');
  var sendLabel = form.querySelector('.send-label');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (sendBtn.disabled) return;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    var data = new FormData(form);
    sendBtn.disabled = true;
    sendLabel.textContent = 'Sending…';
    status.className = 'form-status';
    status.textContent = '';
    try {
      var res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.get('name'),
          email: data.get('email'),
          message: data.get('message'),
          emailOptIn: data.get('emailOptIn') === 'on',
          website: data.get('website')
        })
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || 'Please try again.');
      status.textContent = 'Thanks — we’ll be in touch soon.';
      form.reset();
    } catch (err) {
      status.className = 'form-status error';
      status.textContent = err.message || 'Please try again.';
    } finally {
      sendBtn.disabled = false;
      sendLabel.textContent = 'Send';
    }
  });
})();
