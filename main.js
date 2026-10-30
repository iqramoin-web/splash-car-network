(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =====================================================================
     Head-on car wash
     The camera looks straight down a blue-lit wash tunnel. A car rolls
     toward us (pre-soak arch, snow-foam arch), stops between spinning side
     brushes and an overhead brush, is rinsed clean, then pushes forward into
     the lens and the scene fades out. World units are metres; the camera
     sits CAM_H above the floor. Loops every LOOP seconds.
     ===================================================================== */

  var scene = document.querySelector('.scene');
  var canvas = scene.querySelector('.wash-canvas');
  var ctx = canvas.getContext('2d');
  var pauseBtn = scene.querySelector('.pause');
  var stageEl = scene.querySelector('.wash-stage');
  var stepEl = scene.querySelector('.wash-step');
  var stageNameEl = scene.querySelector('.wash-name');

  var LOOP = 12.4;
  var Z_FAR = 40, Z_HERO = 6, Z_NEAR = 1.2;
  var CAM_H = 1.0;
  var T = {
    arrive: 6.5,     // car reaches the brushes
    scrubEnd: 8.6,
    rinseEnd: 10.0,
    leaveEnd: 12.2   // car drives on past the lens
  };
  var Z = { spray: 26, foam: 16, brush: 6.05, topBrush: 6.25, dry: 3.9, ledWall: 52 };
  var STAGES = ['Pre-soak', 'Snow foam', 'Soft-touch clean', 'High-pressure rinse', 'Air dry & shine'];

  var W, H, dpr, F, cx, vy;
  var tSpray, tFoam;
  var foamBlobs = [], beads = [], drops = [], bokeh = [];
  var rollerL, rollerR, topRoller;
  var bubble = makeBubbleSprite();
  var fleck = makeFleckSprite();
  var brushAngle = 0;
  var currentStage = -2;

  var t = reduceMotion ? 7.4 : 0;
  var running = !reduceMotion;
  // ?t=7.4 freezes the scene at that moment (handy for screenshots and review)
  var frozenAt = parseFloat(new URLSearchParams(location.search).get('t'));
  if (frozenAt >= 0) { t = frozenAt % LOOP; running = false; }
  var visible = true;
  var last = 0;

  /* ---------- Helpers ---------- */

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smooth(a, b, x) { x = clamp01((x - a) / (b - a)); return x * x * (3 - 2 * x); }
  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
  function easeInCubic(x) { return x * x * x; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function sx(x, z) { return cx + x * F / z; }
  function sy(y, z) { return vy + (CAM_H - y) * F / z; }

  function carZ(time) {
    if (time < 0) return Z_FAR - time * 14; // the next car, still deep in the tunnel
    if (time < T.arrive) return Z_HERO + (Z_FAR - Z_HERO) * (1 - easeOutCubic(time / T.arrive));
    if (time < T.rinseEnd) return Z_HERO;
    return Z_HERO - (Z_HERO - Z_NEAR) * Math.pow(clamp01((time - T.rinseEnd) / (T.leaveEnd - T.rinseEnd)), 2);
  }
  // When does the arriving car reach depth z?
  function timeAtZ(z) {
    return T.arrive * (1 - Math.cbrt((z - Z_HERO) / (Z_FAR - Z_HERO)));
  }

  function makeBubbleSprite() {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(28, 26, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.6, 'rgba(236,243,255,.95)');
    grad.addColorStop(0.88, 'rgba(170,195,240,.75)');
    grad.addColorStop(1, 'rgba(150,180,235,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(32, 32, 31, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  // soft, flat white fleck for lacy foam (no bubble rim)
  function makeFleckSprite() {
    var c = document.createElement('canvas');
    c.width = c.height = 32;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(16, 16, 0, 16, 16, 15);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.6, 'rgba(245,249,255,.9)');
    grad.addColorStop(1, 'rgba(235,242,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(16, 16, 15, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  function readColors() {} // the scene keeps its own blue palette in both directions

  /* ---------- Layout ---------- */

  function layout() {
    var rect = scene.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    var carPx = Math.min(W * (W < 600 ? 0.46 : 0.32), H * 0.62); // car width on screen at the brushes
    F = carPx * Z_HERO / 1.9;
    cx = W / 2;
    vy = H * 0.8 - CAM_H * F / Z_HERO;
  }

  function seed() {
    tSpray = timeAtZ(Z.spray + 1.5);
    tFoam = timeAtZ(Z.foam + 1);
    var i;
    for (i = 0; i < 1100; i++) {
      // clusters of flecks read as lace rather than evenly spread bubbles
      var cl = i % 7 === 0 || !foamBlobs.length ? { x: rand(-0.94, 0.94), y: rand(0.16, 1.26) } : foamBlobs[foamBlobs.length - 1];
      foamBlobs.push({
        x: Math.max(-0.95, Math.min(0.95, cl.x + rand(-0.07, 0.07))),
        y: Math.max(0.15, Math.min(1.27, cl.y + rand(-0.05, 0.05))),
        r: 0.006 + Math.pow(Math.random(), 2.2) * 0.026,
        drip: Math.random() < 0.18 ? rand(0.05, 0.22) : 0,
        k: Math.random(),
        ph: rand(0, 6.28)
      });
    }
    for (i = 0; i < 170; i++) beads.push({ x: rand(-0.92, 0.92), y: rand(0.2, 1.24), r: rand(0.004, 0.011) });
    for (i = 0; i < 420; i++) drops.push({ x: rand(-1, 1), dz: rand(-0.7, 0.7), ph: Math.random(), k: Math.random() });
    for (i = 0; i < 16; i++) bokeh.push({ x: Math.random(), ph: Math.random(), r: rand(6, 26), k: rand(0.4, 1) });
    rollerL = makeRoller();
    rollerR = makeRoller();
    topRoller = makeRoller();
  }

  /* ---------- Tunnel ---------- */

  function drawBackdrop(lights) {
    var g = ctx.createRadialGradient(cx, sy(1.4, 60), 0, cx, sy(1.4, 60), Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(70,125,255,' + (0.45 * lights).toFixed(3) + ')');
    g.addColorStop(0.25, 'rgba(25,55,160,' + (0.35 * lights).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(3,5,11,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Far LED bars at the end of the tunnel
    ctx.globalCompositeOperation = 'lighter';
    [[-1.7, -0.12], [0.12, 1.7]].forEach(function (b) {
      var y = sy(2.55, Z.ledWall);
      var x1 = sx(b[0], Z.ledWall), x2 = sx(b[1], Z.ledWall);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(80,160,255,' + (0.25 * lights).toFixed(3) + ')';
      ctx.lineWidth = 12;
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      ctx.strokeStyle = 'rgba(190,230,255,' + (0.95 * lights).toFixed(3) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFloor(time, z, lights) {
    var far = Z.ledWall, near = 1.6;
    var g = ctx.createLinearGradient(0, sy(0, far), 0, H);
    g.addColorStop(0, 'rgba(30,60,150,' + (0.55 * lights).toFixed(3) + ')');
    g.addColorStop(0.35, 'rgba(10,20,50,.9)');
    g.addColorStop(1, 'rgba(4,7,16,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sx(-2.7, far), sy(0, far));
    ctx.lineTo(sx(2.7, far), sy(0, far));
    ctx.lineTo(sx(2.7, near), sy(0, near));
    ctx.lineTo(sx(-2.7, near), sy(0, near));
    ctx.closePath();
    ctx.fill();

    // Grated wheel tracks
    ctx.lineWidth = 1;
    [-1.05, -0.5, 0.5, 1.05].forEach(function (x) {
      ctx.strokeStyle = 'rgba(110,150,255,' + (0.28 * lights).toFixed(3) + ')';
      ctx.beginPath(); ctx.moveTo(sx(x, far), sy(0, far)); ctx.lineTo(sx(x, near), sy(0, near)); ctx.stroke();
    });
    for (var gz = near; gz < 30; gz *= 1.12) {
      var a = 0.16 * lights * (1 - gz / 30);
      ctx.strokeStyle = 'rgba(110,150,255,' + a.toFixed(3) + ')';
      [[-1.05, -0.5], [0.5, 1.05]].forEach(function (tr) {
        ctx.beginPath(); ctx.moveTo(sx(tr[0], gz), sy(0, gz)); ctx.lineTo(sx(tr[1], gz), sy(0, gz)); ctx.stroke();
      });
    }

    // Wet reflections: the far LED bars and the car's headlights streak down the floor
    ctx.globalCompositeOperation = 'lighter';
    streak(sx(-0.9, far), sy(0, far), 3, H, 'rgba(120,190,255,', 0.2 * lights);
    streak(sx(0.9, far), sy(0, far), 3, H, 'rgba(120,190,255,', 0.2 * lights);
    var s = F / z;
    [-0.67, 0.67].forEach(function (hx) {
      streak(sx(hx, z), sy(0, z), 0.1 * s, H, 'rgba(190,215,255,', 0.22);
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  function streak(x, y0, w, y1, rgb, a) {
    if (y1 <= y0) return;
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, rgb + a.toFixed(3) + ')');
    g.addColorStop(1, rgb + '0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - w / 2, y0, w, y1 - y0);
  }

  function archPath(z, inset) {
    var x = 2.7 - inset, top = 3.35 - inset;
    ctx.beginPath();
    ctx.moveTo(sx(-x, z), sy(0, z));
    ctx.lineTo(sx(-x, z), sy(2.5, z));
    ctx.bezierCurveTo(sx(-x, z), sy(top - 0.15, z), sx(-x * 0.5, z), sy(top, z), sx(0, z), sy(top, z));
    ctx.bezierCurveTo(sx(x * 0.5, z), sy(top, z), sx(x, z), sy(top - 0.15, z), sx(x, z), sy(2.5, z));
    ctx.lineTo(sx(x, z), sy(0, z));
  }

  function drawArch(z, idx, lights) {
    var s = F / z;
    var fog = 1 - smooth(8, 54, z) * 0.85;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    archPath(z, 0);
    ctx.strokeStyle = 'rgba(8,12,26,' + (0.95 * fog).toFixed(3) + ')';
    ctx.lineWidth = 0.12 * s;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,160,255,' + (0.5 * fog * lights).toFixed(3) + ')';
    ctx.lineWidth = Math.max(0.6, 0.014 * s);
    ctx.stroke();
    if (idx % 2 === 0) {
      // LED strip on the inside of the frame
      ctx.globalCompositeOperation = 'lighter';
      archPath(z, 0.09);
      ctx.strokeStyle = 'rgba(70,130,255,' + (0.18 * fog * lights).toFixed(3) + ')';
      ctx.lineWidth = 0.16 * s;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(150,200,255,' + (0.85 * fog * lights).toFixed(3) + ')';
      ctx.lineWidth = Math.max(0.8, 0.025 * s);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    // Light tubes on the posts
    ctx.globalCompositeOperation = 'lighter';
    [-2.62, 2.62].forEach(function (x) {
      var y1 = sy(2.35, z), y2 = sy(1.9, z);
      ctx.strokeStyle = 'rgba(100,170,255,' + (0.7 * fog * lights).toFixed(3) + ')';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, 0.05 * s);
      ctx.beginPath(); ctx.moveTo(sx(x, z), y1); ctx.lineTo(sx(x, z), y2); ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- Water ---------- */

  function drawRain(time, zc, spread, count, len, speed, alpha, color, width) {
    if (alpha <= 0.01) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (var i = 0; i < count; i++) {
      var d = drops[i];
      var z = zc + d.dz * spread;
      var y = 3.2 * (1 - ((d.ph + time * speed * (0.75 + d.k * 0.5)) % 1));
      var x = d.x * 2.45;
      ctx.strokeStyle = 'rgba(' + color + ',' + (alpha * (0.35 + d.k * 0.65)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(0.6, width * F / z);
      ctx.beginPath();
      ctx.moveTo(sx(x, z), sy(y, z));
      ctx.lineTo(sx(x, z), sy(y + len, z));
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFoamFall(time, zc, alpha) {
    if (alpha <= 0.01) return;
    for (var i = 0; i < 150; i++) {
      var d = drops[i + 200];
      var z = zc + d.dz * 0.5;
      var y = 3.2 * (1 - ((d.ph + time * 0.55 * (0.7 + d.k * 0.6)) % 1));
      var r = (0.03 + d.k * 0.05) * F / z;
      ctx.globalAlpha = alpha * (0.5 + d.k * 0.5);
      ctx.drawImage(bubble, sx(d.x * 2.4, z) - r, sy(y, z) - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    // soft foam curtain
    var g = ctx.createLinearGradient(0, sy(3.2, zc), 0, sy(0, zc));
    g.addColorStop(0, 'rgba(230,240,255,' + (0.16 * alpha).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(230,240,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx(-2.6, zc), sy(3.2, zc), sx(2.6, zc) - sx(-2.6, zc), sy(0, zc) - sy(3.2, zc));
  }

  /* ---------- Brushes ---------- */

  function drawHub(x, y, s, alpha) {
    // motor housing on top of each brush
    var w = 0.28 * s, h = 0.22 * s;
    var g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    g.addColorStop(0, 'rgba(60,70,95,' + alpha.toFixed(3) + ')');
    g.addColorStop(0.45, 'rgba(200,210,230,' + alpha.toFixed(3) + ')');
    g.addColorStop(1, 'rgba(50,60,85,' + alpha.toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(x - w / 2, y - h, w, h);
    ctx.fillStyle = 'rgba(20,26,44,' + alpha.toFixed(3) + ')';
    ctx.fillRect(x - w * 0.18, y - h - 0.5 * s, w * 0.36, 0.5 * s);
  }

  // Cylindrical roller: short, thick bristle clusters packed round a vertical
  // shaft in angular sectors. Sectors are drawn back to front each frame so the
  // roller reads as a solid 3D volume.
  var ROLLER_R = 0.62;
  function makeRoller() {
    var NS = 40, NL = window.innerWidth < 600 ? 32 : 60, sectors = [];
    for (var k = 0; k < NS; k++) {
      var list = [];
      for (var l = 0; l < NL; l++) {
        list.push({
          y: 0.08 + (l + Math.random()) / NL * 2.28,
          th: (k + Math.random()) / NS * Math.PI * 2,
          len: rand(0.82, 1.06),
          w: rand(0.03, 0.06),
          tone: Math.random(),
          flut: rand(0, 6.28)
        });
      }
      sectors.push({ base: (k + 0.5) / NS * Math.PI * 2, list: list });
    }
    return sectors;
  }

  function bristleRGB(L, hi) {
    if (hi) return [Math.round(70 + 60 * L), Math.round(110 + 70 * L), 255];
    return [Math.round(8 + 34 * L), Math.round(12 + 52 * L), Math.round(60 + 175 * L)];
  }

  function drawSideBrush(side, z, xc, angle, alpha, spin, time) {
    var s = F / z;
    var sectors = side < 0 ? rollerL : rollerR;
    var rot = angle * side;
    // shaft and a dark inner volume so no gaps show through
    var R0 = ROLLER_R * 0.8;
    var vg = ctx.createLinearGradient(sx(xc - R0, z), 0, sx(xc + R0, z), 0);
    vg.addColorStop(0, 'rgba(20,30,140,0)');
    vg.addColorStop(0.2, 'rgba(18,26,120,' + (0.8 * alpha).toFixed(3) + ')');
    vg.addColorStop(0.5, 'rgba(6,9,40,' + alpha.toFixed(3) + ')');
    vg.addColorStop(0.8, 'rgba(18,26,120,' + (0.8 * alpha).toFixed(3) + ')');
    vg.addColorStop(1, 'rgba(20,30,140,0)');
    ctx.fillStyle = vg;
    ctx.fillRect(sx(xc - R0, z), sy(2.38, z), sx(xc + R0, z) - sx(xc - R0, z), sy(0.08, z) - sy(2.38, z));

    var order = sectors.slice().sort(function (a, b) { return Math.cos(a.base + rot) - Math.cos(b.base + rot); });
    var maxIn = Math.abs(xc) - 1.04; // room between shaft and the car's flank
    ctx.lineCap = 'round';
    for (var o = 0; o < order.length; o++) {
      var list = order[o].list;
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        var th = b.th + rot, c = Math.cos(th), sn = Math.sin(th);
        var reach = ROLLER_R * b.len * (0.88 + 0.14 * spin) + Math.sin(time * 6 + b.flut) * 0.02 * (0.4 + spin);
        // bristles squash against the car where they meet it
        if (sn * side < 0 && b.y < 1.32 && maxIn > 0 && reach > maxIn) reach = maxIn + (reach - maxIn) * 0.12;
        var droop = 0.07 * (1 - 0.7 * spin) * (0.5 + 0.5 * b.tone);
        var zt = z - c * reach, st = F / zt;
        var x0 = sx(xc + sn * 0.09, z - c * 0.09), y0 = sy(b.y, z - c * 0.09);
        var x1 = sx(xc + sn * reach, zt), y1 = sy(b.y - droop, zt);
        // lighting: front faces lit, back in shadow, darker dense band near the floor
        var L = c > 0 ? 0.45 + 0.55 * c : 0.15 + 0.2 * (1 + c);
        if (b.y < 0.62 + 0.08 * Math.sin(b.th * 3)) L *= 0.42;
        var hi = b.tone > 0.86 && c > 0.1;
        var rgb = bristleRGB(L, hi);
        ctx.strokeStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha.toFixed(3) + ')';
        ctx.lineWidth = Math.max(1, b.w * st);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        // fine lit edge along the bristle for layered texture
        if (c > 0.15 && b.y >= 0.62) {
          ctx.strokeStyle = 'rgba(130,165,255,' + (0.28 * c * alpha).toFixed(3) + ')';
          ctx.lineWidth = Math.max(0.6, b.w * st * 0.28);
          ctx.beginPath(); ctx.moveTo(x0, y0 - b.w * st * 0.25); ctx.lineTo(x1, y1 - b.w * st * 0.25); ctx.stroke();
        }
        // motion blur on the flanks while spinning
        if (spin > 0.2 && Math.abs(sn) > 0.6) {
          var ps = Math.sin(th - 0.22 * side), pc = Math.cos(th - 0.22 * side);
          ctx.strokeStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (0.25 * spin * alpha).toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(sx(xc + ps * reach, z - pc * reach), y1); ctx.stroke();
        }
        // bright bristle tips facing the camera
        if (c > 0.75) {
          ctx.fillStyle = 'rgba(120,160,255,' + (0.18 * c * alpha * (b.y < 0.62 ? 0.4 : 1)).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(x1, y1, Math.max(0.8, b.w * st * 0.35), 0, 6.283); ctx.fill();
        }
      }
    }
    drawHub(sx(xc, z), sy(2.42, z), s, alpha);

    // spray flung off the roller while it spins
    if (spin > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      for (var p = 0; p < 60; p++) {
        var d = drops[p + 40];
        var life = (d.ph + time * (1.2 + d.k)) % 1;
        var ox = sx(xc + side * (0.55 + life * (0.6 + d.k * 0.6)), z);
        var oy = sy(0.3 + d.k * 2.0, z) + life * life * 0.35 * s;
        ctx.fillStyle = 'rgba(180,215,255,' + ((1 - life) * 0.7 * spin * alpha).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(ox, oy, Math.max(0.8, 0.011 * s), 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // Overhead roller: same bristle build as the side rollers, lying across the
  // tunnel and spinning about a horizontal axis. Bristles squash on the roof.
  function drawTopBrush(z, yc, angle, alpha, spin, time) {
    var s = F / z, R = ROLLER_R * 0.85;
    var x1 = -1.15, x2 = 1.15;
    var vg = ctx.createLinearGradient(0, sy(yc + R * 0.8, z), 0, sy(yc - R * 0.8, z));
    vg.addColorStop(0, 'rgba(20,30,140,0)');
    vg.addColorStop(0.2, 'rgba(18,26,120,' + (0.8 * alpha).toFixed(3) + ')');
    vg.addColorStop(0.5, 'rgba(6,9,40,' + alpha.toFixed(3) + ')');
    vg.addColorStop(0.8, 'rgba(18,26,120,' + (0.8 * alpha).toFixed(3) + ')');
    vg.addColorStop(1, 'rgba(20,30,140,0)');
    ctx.fillStyle = vg;
    ctx.fillRect(sx(x1, z), sy(yc + R * 0.8, z), sx(x2, z) - sx(x1, z), sy(yc - R * 0.8, z) - sy(yc + R * 0.8, z));

    var order = topRoller.slice().sort(function (a, b) { return Math.cos(a.base + angle) - Math.cos(b.base + angle); });
    var maxDown = yc - 1.32; // room between the shaft and the roof
    ctx.lineCap = 'round';
    for (var o = 0; o < order.length; o++) {
      var list = order[o].list;
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        var th = b.th + angle, c = Math.cos(th), sn = Math.sin(th);
        var x = x1 + b.y / 2.36 * (x2 - x1);
        var reach = R * b.len * (0.88 + 0.14 * spin) + Math.sin(time * 6 + b.flut) * 0.02 * (0.4 + spin);
        if (sn < 0 && Math.abs(x) < 1.05 && maxDown > 0 && reach > maxDown) reach = maxDown + (reach - maxDown) * 0.12;
        var zt = z - c * reach, st = F / zt;
        var x0s = sx(x, z - c * 0.08), y0s = sy(yc + sn * 0.08, z - c * 0.08);
        var x1s = sx(x + (b.tone - 0.5) * 0.04, zt), y1s = sy(yc + sn * reach, zt);
        var L = c > 0 ? 0.45 + 0.55 * c : 0.15 + 0.2 * (1 + c);
        var rgb = bristleRGB(L, b.tone > 0.86 && c > 0.1);
        ctx.strokeStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha.toFixed(3) + ')';
        ctx.lineWidth = Math.max(1, b.w * st);
        ctx.beginPath(); ctx.moveTo(x0s, y0s); ctx.lineTo(x1s, y1s); ctx.stroke();
        if (c > 0.15) {
          ctx.strokeStyle = 'rgba(130,165,255,' + (0.28 * c * alpha).toFixed(3) + ')';
          ctx.lineWidth = Math.max(0.6, b.w * st * 0.28);
          ctx.beginPath(); ctx.moveTo(x0s - b.w * st * 0.25, y0s); ctx.lineTo(x1s - b.w * st * 0.25, y1s); ctx.stroke();
        }
        if (spin > 0.2 && Math.abs(sn) > 0.6) {
          var ps = Math.sin(th - 0.22), pc = Math.cos(th - 0.22);
          ctx.strokeStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (0.25 * spin * alpha).toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(x0s, y0s); ctx.lineTo(x1s, sy(yc + ps * reach, z - pc * reach)); ctx.stroke();
        }
      }
    }
    [x1 - 0.06, x2 + 0.06].forEach(function (x) { drawHub(sx(x, z), sy(yc + 0.12, z), s * 0.8, alpha); });
  }

  // Brush gantry: heavy frame with LED edge strips and status lights
  function drawGantry(z, lights, time, active) {
    var s = F / z;
    var xL = sx(-2.35, z), xR = sx(2.35, z), yT = sy(2.95, z), yB = sy(0, z);
    var beam = 0.16 * s;
    ctx.fillStyle = 'rgba(10,14,28,.96)';
    ctx.fillRect(xL - beam, yT - beam, beam, yB - yT + beam);
    ctx.fillRect(xR, yT - beam, beam, yB - yT + beam);
    ctx.fillRect(xL - beam, yT - beam, xR - xL + 2 * beam, beam);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(110,180,255,' + (0.9 * lights).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, 0.02 * s);
    ctx.beginPath();
    ctx.moveTo(xL, yT); ctx.lineTo(xR, yT); // lit top beam only; no upright light lines
    ctx.stroke();
    ctx.strokeStyle = 'rgba(80,150,255,' + (0.2 * lights).toFixed(3) + ')';
    ctx.lineWidth = 0.12 * s;
    ctx.stroke();
    // running status lights along the top beam
    for (var i = 0; i < 18; i++) {
      var on = ((i / 18 + time * 0.6) % 1) < 0.18 ? 1 : 0.25;
      ctx.fillStyle = 'rgba(150,215,255,' + (on * lights * (0.4 + 0.6 * active)).toFixed(3) + ')';
      ctx.fillRect(xL + (xR - xL) * (i + 0.2) / 18, yT - beam * 0.62, (xR - xL) / 18 * 0.6, beam * 0.24);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Laser scan that sweeps down over the car as it arrives
  function drawScan(z, p) {
    if (p <= 0 || p >= 1) return;
    var s = F / z;
    var y = sy(1.45 - p * 1.4, z);
    var x1 = sx(-1.15, z), x2 = sx(1.15, z);
    var a = Math.sin(Math.PI * p);
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createLinearGradient(0, y - 0.25 * s, 0, y);
    g.addColorStop(0, 'rgba(80,170,255,0)');
    g.addColorStop(1, 'rgba(80,170,255,' + (0.28 * a).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(x1, y - 0.25 * s, x2 - x1, 0.25 * s);
    ctx.strokeStyle = 'rgba(190,235,255,' + (0.95 * a).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, 0.012 * s);
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    // emitters on the posts
    [x1, x2].forEach(function (x) {
      var eg = ctx.createRadialGradient(x, y, 0, x, y, 0.12 * s);
      eg.addColorStop(0, 'rgba(200,240,255,' + a.toFixed(3) + ')');
      eg.addColorStop(1, 'rgba(80,170,255,0)');
      ctx.fillStyle = eg;
      ctx.fillRect(x - 0.12 * s, y - 0.12 * s, 0.24 * s, 0.24 * s);
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  // High-pressure fan jet from a nozzle, aimed by angle (radians, screen space)
  function drawJet(x0, y0, z, dir, spread, len, time, alpha) {
    if (alpha <= 0.01) return;
    var s = F / z;
    var L = len * s;
    ctx.globalCompositeOperation = 'lighter';
    var rays = 12;
    for (var i = 0; i < rays; i++) {
      var a = dir + spread * (i / (rays - 1) - 0.5);
      var ex = x0 + Math.cos(a) * L, ey = y0 + Math.sin(a) * L;
      var g = ctx.createLinearGradient(x0, y0, ex, ey);
      g.addColorStop(0, 'rgba(200,230,255,' + (0.55 * alpha).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(0.7, 0.01 * s);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(ex, ey); ctx.stroke();
      // droplets racing down the ray
      for (var k = 0; k < 3; k++) {
        var u = (time * 2.6 + i * 0.37 + k / 3) % 1;
        ctx.fillStyle = 'rgba(210,235,255,' + ((1 - u) * 0.8 * alpha).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(x0 + Math.cos(a) * L * u, y0 + Math.sin(a) * L * u, Math.max(0.8, 0.01 * s), 0, 6.283);
        ctx.fill();
      }
    }
    var ng = ctx.createRadialGradient(x0, y0, 0, x0, y0, 0.08 * s);
    ng.addColorStop(0, 'rgba(220,240,255,' + alpha.toFixed(3) + ')');
    ng.addColorStop(1, 'rgba(120,180,255,0)');
    ctx.fillStyle = ng;
    ctx.fillRect(x0 - 0.08 * s, y0 - 0.08 * s, 0.16 * s, 0.16 * s);
    ctx.globalCompositeOperation = 'source-over';
  }

  // Jet arms on both sides of an arch, firing inward and down
  function drawJetArch(z, time, alpha) {
    if (alpha <= 0.01) return;
    [0.5, 1.15, 1.8].forEach(function (y, i) {
      drawJet(sx(-2.45, z), sy(y, z), z, -0.15 + i * 0.12 + 0.35, 0.7, 1.6, time + i * 0.3, alpha);
      drawJet(sx(2.45, z), sy(y, z), z, Math.PI - (-0.15 + i * 0.12 + 0.35), 0.7, 1.6, time + i * 0.5, alpha);
    });
    [-1.2, -0.4, 0.4, 1.2].forEach(function (x, i) {
      drawJet(sx(x, z), sy(3.0, z), z, Math.PI / 2, 0.55, 1.5, time + i * 0.21, alpha);
    });
  }

  // Volumetric beams from the ceiling over the brush bay, plus drifting mist
  function drawBeams(lights, time, amt) {
    var z = 6.4, s = F / z;
    ctx.globalCompositeOperation = 'lighter';
    [-1.3, 0, 1.3].forEach(function (x, i) {
      var top = sy(3.2, z), bot = sy(0, z);
      var w1 = 0.18 * s, w2 = 0.9 * s;
      var g = ctx.createLinearGradient(0, top, 0, bot);
      var a = (0.09 + 0.04 * Math.sin(time * 1.3 + i)) * lights * amt;
      g.addColorStop(0, 'rgba(120,180,255,' + a.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(sx(x, z) - w1, top); ctx.lineTo(sx(x, z) + w1, top);
      ctx.lineTo(sx(x, z) + w2, bot); ctx.lineTo(sx(x, z) - w2, bot);
      ctx.closePath();
      ctx.fill();
    });
    for (var i = 0; i < 60; i++) {
      var d = drops[i + 300];
      var mz = 4 + d.k * 8;
      var mx = d.x * 2.4 + Math.sin(time * 0.3 + i) * 0.2;
      var my = 0.2 + ((d.ph + time * 0.03) % 1) * 2.8;
      ctx.fillStyle = 'rgba(150,195,255,' + (0.25 * lights * amt * d.k).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(sx(mx, mz), sy(my, mz), Math.max(0.6, 0.01 * F / mz), 0, 6.283);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- Car (front view, drawn in metres with y up) ---------- */

  function bodyPath() {
    ctx.beginPath();
    ctx.moveTo(0, 0.14);
    ctx.lineTo(0.8, 0.14);
    ctx.quadraticCurveTo(0.95, 0.15, 0.96, 0.32);
    ctx.lineTo(0.96, 0.52);
    ctx.quadraticCurveTo(0.97, 0.7, 0.86, 0.75);
    ctx.quadraticCurveTo(0.74, 0.79, 0.62, 0.81);
    ctx.lineTo(0.43, 1.2);
    ctx.quadraticCurveTo(0.36, 1.27, 0, 1.275);
    ctx.quadraticCurveTo(-0.36, 1.27, -0.43, 1.2);
    ctx.lineTo(-0.62, 0.81);
    ctx.quadraticCurveTo(-0.74, 0.79, -0.86, 0.75);
    ctx.quadraticCurveTo(-0.97, 0.7, -0.96, 0.52);
    ctx.lineTo(-0.96, 0.32);
    ctx.quadraticCurveTo(-0.95, 0.15, -0.8, 0.14);
    ctx.closePath();
  }

  function glassPath() {
    ctx.beginPath();
    ctx.moveTo(0.57, 0.845);
    ctx.lineTo(0.405, 1.18);
    ctx.quadraticCurveTo(0.34, 1.235, 0, 1.24);
    ctx.quadraticCurveTo(-0.34, 1.235, -0.405, 1.18);
    ctx.lineTo(-0.57, 0.845);
    ctx.quadraticCurveTo(0, 0.875, 0.57, 0.845);
    ctx.closePath();
  }

  function mirrored(fn) { fn(1); fn(-1); }

  function drawCar(time, z, lights, st) {
    var s = F / z;
    // fade in out of the far fog, and out as the car rolls past the lens
    var fogA = (1 - smooth(26, 42, z) * 0.7) * (1 - smooth(40, 66, z)) * smooth(1.7, 3.3, z);
    ctx.save();
    ctx.globalAlpha = fogA;
    ctx.translate(cx, sy(0, z));
    ctx.scale(s, -s);

    // contact shadow
    var sh = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.1);
    sh.addColorStop(0, 'rgba(0,0,0,.85)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.scale(1, 0.08); ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(0, 0.2, 1.1, 0, 6.283); ctx.fill(); ctx.restore();

    // tyres
    ctx.fillStyle = '#040406';
    mirrored(function (m) { ctx.fillRect(m > 0 ? 0.62 : -0.92, 0, 0.3, 0.22); });

    // body
    bodyPath();
    var bg = ctx.createLinearGradient(0, 1.3, 0, 0.12);
    bg.addColorStop(0, '#1d2539');
    bg.addColorStop(0.38, '#121829');
    bg.addColorStop(0.62, '#0b0f1b');
    bg.addColorStop(1, '#05070c');
    ctx.fillStyle = bg;
    ctx.fill();
    var side = ctx.createLinearGradient(-1, 0, 1, 0);
    side.addColorStop(0, 'rgba(0,0,0,.5)');
    side.addColorStop(0.28, 'rgba(0,0,0,0)');
    side.addColorStop(0.72, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = side;
    ctx.fill();

    // hood and fender reflections of the tunnel lights
    ctx.save();
    bodyPath();
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    var gloss = (0.55 + 0.6 * st.shine) * lights;
    ctx.save();
    ctx.translate(0, 0.79);
    ctx.scale(1, 0.1);
    var hg = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.8);
    hg.addColorStop(0, 'rgba(130,175,255,' + (0.45 * gloss).toFixed(3) + ')');
    hg.addColorStop(1, 'rgba(130,175,255,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(0, 0, 0.8, 0, 6.283); ctx.fill();
    ctx.restore();
    mirrored(function (m) {
      ctx.strokeStyle = 'rgba(140,185,255,' + (0.4 * gloss).toFixed(3) + ')';
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.moveTo(m * 0.62, 0.79);
      ctx.quadraticCurveTo(m * 0.86, 0.75, m * 0.93, 0.6);
      ctx.stroke();
    });
    // shine sweep after the rinse
    if (st.sweep > 0 && st.sweep < 1) {
      var sw = -1.4 + st.sweep * 2.8;
      var sg = ctx.createLinearGradient(sw - 0.25, 0, sw + 0.25, 0);
      sg.addColorStop(0, 'rgba(200,225,255,0)');
      sg.addColorStop(0.5, 'rgba(210,230,255,' + (0.45 * Math.sin(Math.PI * st.sweep)).toFixed(3) + ')');
      sg.addColorStop(1, 'rgba(200,225,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(-1, 0, 2, 1.3);
    }
    ctx.restore();

    // windscreen with the LED bars reflected in it
    glassPath();
    var gg = ctx.createLinearGradient(0, 1.24, 0, 0.85);
    gg.addColorStop(0, '#0c1428');
    gg.addColorStop(1, '#03050a');
    ctx.fillStyle = gg;
    ctx.fill();
    ctx.save();
    glassPath();
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(120,195,255,' + (0.75 * lights).toFixed(3) + ')';
    ctx.lineWidth = 0.014;
    ctx.lineCap = 'round';
    [[-0.34, -0.06], [0.06, 0.34]].forEach(function (b) {
      ctx.beginPath(); ctx.moveTo(b[0], 1.1); ctx.lineTo(b[1], 1.1); ctx.stroke();
    });
    var dg = ctx.createLinearGradient(-0.6, 0.85, 0.2, 1.24);
    dg.addColorStop(0, 'rgba(90,130,230,0)');
    dg.addColorStop(0.5, 'rgba(90,130,230,' + (0.12 * lights).toFixed(3) + ')');
    dg.addColorStop(1, 'rgba(90,130,230,0)');
    ctx.fillStyle = dg;
    ctx.fillRect(-0.6, 0.84, 1.2, 0.42);
    ctx.restore();

    // grille and intakes
    ctx.fillStyle = '#020306';
    ctx.beginPath();
    ctx.moveTo(-0.34, 0.17); ctx.lineTo(0.34, 0.17); ctx.lineTo(0.37, 0.41); ctx.lineTo(-0.37, 0.41); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,95,150,.35)';
    ctx.lineWidth = 0.005;
    for (var gy = 0.2; gy < 0.4; gy += 0.034) {
      ctx.beginPath(); ctx.moveTo(-0.33, gy); ctx.lineTo(0.33, gy); ctx.stroke();
    }
    mirrored(function (m) {
      ctx.fillStyle = '#020306';
      ctx.beginPath();
      ctx.moveTo(m * 0.45, 0.18); ctx.lineTo(m * 0.84, 0.18); ctx.lineTo(m * 0.87, 0.4); ctx.lineTo(m * 0.49, 0.43);
      ctx.closePath();
      ctx.fill();
    });

    // mirrors
    mirrored(function (m) {
      ctx.fillStyle = '#0d1220';
      ctx.beginPath();
      ctx.moveTo(m * 0.62, 0.86); ctx.lineTo(m * 0.8, 0.87); ctx.lineTo(m * 0.83, 0.96); ctx.lineTo(m * 0.66, 0.96);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,160,255,' + (0.45 * lights).toFixed(3) + ')';
      ctx.lineWidth = 0.008;
      ctx.stroke();
    });

    // rim light along the silhouette
    ctx.globalCompositeOperation = 'lighter';
    bodyPath();
    ctx.strokeStyle = 'rgba(110,155,255,' + (0.55 * lights).toFixed(3) + ')';
    ctx.lineWidth = 0.012;
    ctx.stroke();

    ctx.globalCompositeOperation = 'source-over';

    // water beads, then foam, on body and glass
    ctx.save();
    bodyPath();
    ctx.clip();
    if (st.beads > 0.02) {
      ctx.fillStyle = 'rgba(220,235,255,' + (0.7 * st.beads).toFixed(3) + ')';
      for (var b = 0; b < beads.length; b++) {
        ctx.beginPath(); ctx.arc(beads[b].x, beads[b].y, beads[b].r, 0, 6.283); ctx.fill();
      }
    }
    if (st.foam > 0.01) {
      var nVis = Math.floor(foamBlobs.length * st.foam);
      var limit = 1.34 - st.drain * 1.45;
      for (var i = 0; i < nVis; i++) {
        var fb = foamBlobs[i];
        var y = fb.y - st.drain * 0.3 * (0.4 + fb.k);
        if (y > limit || y < 0.14) continue;
        var wob = Math.sin(time * 11 + fb.ph) * 0.007 * st.scrub;
        var r = fb.r * (1 + 0.25 * st.scrub * fb.k);
        ctx.globalAlpha = fogA * (0.55 + 0.35 * fb.k);
        ctx.drawImage(fleck, fb.x - r + wob, y - r, r * 2, r * 2);
        if (fb.drip) {
          ctx.strokeStyle = 'rgba(235,242,255,.6)';
          ctx.lineWidth = Math.max(0.004, r * 0.35);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(fb.x + wob, y);
          ctx.lineTo(fb.x + wob, y - fb.drip * (0.5 + 0.5 * st.foam + st.drain));
          ctx.stroke();
        }
      }
      ctx.globalAlpha = fogA;
      // blue tint from the tunnel on the foam
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(70,110,230,.12)';
      ctx.fillRect(-1, 0, 2, 1.3);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    ctx.globalCompositeOperation = 'lighter';
    // daytime running lights (blue-violet strips)
    mirrored(function (m) {
      [[0.3, 0.33], [0.265, 0.295]].forEach(function (yy) {
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(120,120,255,.35)';
        ctx.lineWidth = 0.04;
        ctx.beginPath(); ctx.moveTo(m * 0.52, yy[0]); ctx.lineTo(m * 0.81, yy[1]); ctx.stroke();
        ctx.strokeStyle = 'rgba(205,195,255,.95)';
        ctx.lineWidth = 0.011;
        ctx.stroke();
      });
    });

    // headlights
    mirrored(function (m) {
      ctx.beginPath();
      ctx.moveTo(m * 0.47, 0.585); ctx.lineTo(m * 0.83, 0.64); ctx.lineTo(m * 0.87, 0.575); ctx.lineTo(m * 0.53, 0.52);
      ctx.closePath();
      var hl = ctx.createLinearGradient(m * 0.47, 0, m * 0.87, 0);
      hl.addColorStop(0, 'rgba(160,195,255,.9)');
      hl.addColorStop(0.5, 'rgba(255,255,255,1)');
      hl.addColorStop(1, 'rgba(170,205,255,.9)');
      ctx.fillStyle = hl;
      ctx.fill();
    });

    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // headlight bloom (screen space)
    ctx.globalCompositeOperation = 'lighter';
    [-0.67, 0.67].forEach(function (hx) {
      var x = sx(hx, z), y = sy(0.585, z);
      var rr = 0.55 * s;
      var g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, 'rgba(235,245,255,' + (0.9 * fogA).toFixed(3) + ')');
      g.addColorStop(0.18, 'rgba(150,190,255,' + (0.45 * fogA).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(60,110,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- Car photo ----------
     A cut-out, tightly cropped front-view photo (transparent background).
     Its full width is treated as 1.95 m. Headlight centres are given as
     fractions of the image so the bloom lines up with the lamps. */

  var CAR_PHOTO = { src: 'assets/car-front-cut.png', width: 2.1, lights: [[0.16, 0.45], [0.84, 0.45]] };
  var carImg = new Image();
  var carReady = false;
  var fx, fctx, FW = 900, FH;
  carImg.onload = function () {
    carReady = true;
    FH = Math.round(FW * carImg.naturalHeight / carImg.naturalWidth);
    fx = document.createElement('canvas');
    fx.width = FW;
    fx.height = FH;
    fctx = fx.getContext('2d');
    redraw();
  };
  carImg.src = CAR_PHOTO.src;

  function drawCarPhoto(time, z, lights, st) {
    var s = F / z;
    var wPx = CAR_PHOTO.width * s, hPx = wPx * FH / FW;
    var x = cx - wPx / 2, yb = sy(0, z), y = yb - hPx;
    // fade in out of the far fog, and out as the car rolls past the lens
    var fogA = (1 - smooth(26, 42, z) * 0.7) * (1 - smooth(40, 66, z)) * smooth(1.7, 3.3, z);
    var m = FW / CAR_PHOTO.width; // image px per metre

    // compose the lit, washed car off-screen in image space
    fctx.globalCompositeOperation = 'source-over';
    fctx.globalAlpha = 1;
    fctx.clearRect(0, 0, FW, FH);
    fctx.drawImage(carImg, 0, 0, FW, FH);
    fctx.globalCompositeOperation = 'source-atop';
    // pull the studio-lit paint down into the dark tunnel
    fctx.fillStyle = 'rgba(4,10,34,.45)';
    fctx.fillRect(0, 0, FW, FH);
    // cool blue wash from the tunnel lights, stronger on the upper surfaces
    var lg = fctx.createLinearGradient(0, 0, 0, FH);
    lg.addColorStop(0, 'rgba(70,120,255,' + (0.28 * lights).toFixed(3) + ')');
    lg.addColorStop(0.6, 'rgba(40,80,200,' + (0.12 * lights).toFixed(3) + ')');
    lg.addColorStop(1, 'rgba(20,40,120,0)');
    fctx.fillStyle = lg;
    fctx.fillRect(0, 0, FW, FH);
    // royal-blue bounce light from the rollers on the car's flanks
    var near = (1 - smooth(6.5, 12, z)) * (0.5 + 0.5 * st.scrub);
    if (near > 0.01) {
      [[0, 1], [FW, -1]].forEach(function (e) {
        var bg2 = fctx.createLinearGradient(e[0], 0, e[0] + e[1] * FW * 0.32, 0);
        bg2.addColorStop(0, 'rgba(50,80,255,' + (0.4 * near).toFixed(3) + ')');
        bg2.addColorStop(1, 'rgba(50,80,255,0)');
        fctx.fillStyle = bg2;
        fctx.fillRect(0, 0, FW, FH);
      });
    }
    // water beads
    if (st.beads > 0.02) {
      fctx.fillStyle = 'rgba(220,235,255,' + (0.75 * st.beads).toFixed(3) + ')';
      for (var b = 0; b < beads.length; b++) {
        fctx.beginPath();
        fctx.arc((beads[b].x / CAR_PHOTO.width + 0.5) * FW, FH - beads[b].y * m, Math.max(1, beads[b].r * m), 0, 6.283);
        fctx.fill();
      }
    }
    // lacy foam, drained top-down by the rinse
    if (st.foam > 0.01) {
      var nVis = Math.floor(foamBlobs.length * st.foam);
      var limit = 1.34 - st.drain * 1.45;
      for (var i = 0; i < nVis; i++) {
        var fb = foamBlobs[i];
        var yy = fb.y - st.drain * 0.3 * (0.4 + fb.k);
        if (yy > limit || yy < 0.14) continue;
        var wob = Math.sin(time * 11 + fb.ph) * 0.007 * st.scrub;
        var r = fb.r * (1 + 0.25 * st.scrub * fb.k) * m;
        var px = (fb.x + wob) / CAR_PHOTO.width * FW + FW / 2, py = FH - yy * m;
        fctx.globalAlpha = 0.55 + 0.35 * fb.k;
        fctx.drawImage(fleck, px - r, py - r, r * 2, r * 2);
        if (fb.drip) {
          fctx.strokeStyle = 'rgba(235,242,255,.6)';
          fctx.lineWidth = Math.max(1, r * 0.35);
          fctx.lineCap = 'round';
          fctx.beginPath();
          fctx.moveTo(px, py);
          fctx.lineTo(px, py + fb.drip * m * (0.5 + 0.5 * st.foam + st.drain));
          fctx.stroke();
        }
      }
      fctx.globalAlpha = 1;
      fctx.fillStyle = 'rgba(70,110,230,.1)';
      fctx.fillRect(0, 0, FW, FH);
    }
    // shine sweep after the rinse
    if (st.sweep > 0 && st.sweep < 1) {
      var swx = (-0.2 + st.sweep * 1.4) * FW;
      var sg = fctx.createLinearGradient(swx - FW * 0.12, 0, swx + FW * 0.12, 0);
      sg.addColorStop(0, 'rgba(200,225,255,0)');
      sg.addColorStop(0.5, 'rgba(215,232,255,' + (0.4 * Math.sin(Math.PI * st.sweep)).toFixed(3) + ')');
      sg.addColorStop(1, 'rgba(200,225,255,0)');
      fctx.fillStyle = sg;
      fctx.fillRect(0, 0, FW, FH);
    }
    // the photo's own lamps punch back through foam
    fctx.globalCompositeOperation = 'lighter';
    CAR_PHOTO.lights.forEach(function (l) {
      var gx = l[0] * FW, gy = l[1] * FH, gr = FW * 0.09;
      var hg = fctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      hg.addColorStop(0, 'rgba(255,255,255,.9)');
      hg.addColorStop(1, 'rgba(160,200,255,0)');
      fctx.fillStyle = hg;
      fctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    });
    fctx.globalCompositeOperation = 'source-over';

    // reflection in the wet floor
    ctx.save();
    ctx.globalAlpha = 0.22 * fogA;
    ctx.translate(x, yb);
    ctx.scale(1, -1);
    ctx.drawImage(fx, 0, -hPx * 0.98, wPx, hPx);
    ctx.restore();
    var rg = ctx.createLinearGradient(0, yb, 0, yb + hPx * 0.7);
    rg.addColorStop(0, 'rgba(4,7,16,0)');
    rg.addColorStop(1, 'rgba(4,7,16,1)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - 2, yb, wPx + 4, hPx * 0.7);

    // contact shadow, then the car
    var sh = ctx.createRadialGradient(cx, yb, 0, cx, yb, wPx * 0.6);
    sh.addColorStop(0, 'rgba(0,0,0,.8)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.translate(0, yb); ctx.scale(1, 0.08); ctx.translate(0, -yb);
    ctx.fillStyle = sh; ctx.fillRect(cx - wPx * 0.6, yb - wPx * 0.6, wPx * 1.2, wPx * 1.2);
    ctx.restore();
    ctx.globalAlpha = fogA;
    ctx.drawImage(fx, x, y, wPx, hPx);
    ctx.globalAlpha = 1;

    // headlight bloom in screen space
    ctx.globalCompositeOperation = 'lighter';
    CAR_PHOTO.lights.forEach(function (l) {
      var hx = x + l[0] * wPx, hy = y + l[1] * hPx, rr = 0.55 * s;
      var g = ctx.createRadialGradient(hx, hy, 0, hx, hy, rr);
      g.addColorStop(0, 'rgba(235,245,255,' + (0.8 * fogA).toFixed(3) + ')');
      g.addColorStop(0.18, 'rgba(150,190,255,' + (0.38 * fogA).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(60,110,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(hx - rr, hy - rr, rr * 2, rr * 2);
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- Lens layer ---------- */

  function drawLens(time, z, st) {
    ctx.globalCompositeOperation = 'lighter';

    // water drops on the lens during the wash
    var wet = st.lensWet;
    if (wet > 0.01) {
      for (var i = 0; i < bokeh.length; i++) {
        var b = bokeh[i];
        var x = b.x * W, y = ((b.ph + time * 0.04 * b.k) % 1) * H;
        var g = ctx.createRadialGradient(x, y, b.r * 0.55, x, y, b.r);
        g.addColorStop(0, 'rgba(150,190,255,0)');
        g.addColorStop(0.8, 'rgba(170,205,255,' + (0.22 * wet * b.k).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(170,205,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, b.r, 0, 6.283); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // vignette
    var vg = ctx.createRadialGradient(cx, H * 0.55, Math.min(W, H) * 0.3, cx, H * 0.55, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.6)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------- Frame ---------- */

  function stateAt(time) {
    return {
      beads: smooth(tSpray, tSpray + 1, time) * (1 - smooth(10.3, 10.9, time)),
      foam: smooth(tFoam, tFoam + 1.8, time),
      scrub: smooth(6.2, 6.8, time) * (1 - smooth(8.5, 9.0, time)),
      drain: smooth(8.7, 9.9, time),
      rinse: smooth(8.4, 8.8, time) * (1 - smooth(9.9, 10.3, time)),
      dry: smooth(10.0, 10.3, time) * (1 - smooth(11.3, 11.7, time)),
      shine: smooth(9.6, 10.3, time),
      sweep: clamp01((time - 9.9) / 1.0),
      lensWet: smooth(5.6, 7, time) * (1 - smooth(10.2, 11, time))
    };
  }

  function render(time, dt) {
    var z = carZ(time);
    var st = stateAt(time);
    var lights = 1;

    // brushes spin up while they scrub
    brushAngle += (1.4 + 5.5 * st.scrub) * dt;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#03050b';
    ctx.fillRect(0, 0, W, H);

    // slow push-in, then a faster zoom as the car comes at the lens
    // slow breathing push-in that returns to its start each loop, so there is no jump
    var zoom = 1 + 0.03 * (0.5 - 0.5 * Math.cos(time / LOOP * Math.PI * 2));
    var pivotY = sy(0.7, Z_HERO);
    ctx.save();
    ctx.translate(cx, pivotY);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -pivotY);

    drawBackdrop(lights);
    drawFloor(time, z, lights);

    // depth-sorted scene items, far to near
    var items = [];
    var idx = 0;
    for (var az = 50; az >= 7.5; az -= 2.5) {
      (function (zz, k) { items.push({ z: zz, draw: function () { drawArch(zz, k, lights); } }); })(az, idx++);
    }
    items.push({ z: Z.spray, draw: function () {
      drawRain(time, Z.spray, 0.9, 110, 0.28, 1.6, 0.4 * lights, '150,195,255', 0.012);
      drawJetArch(Z.spray, time, 0.75 * lights);
    } });
    items.push({ z: Z.foam, draw: function () { drawFoamFall(time, Z.foam, 0.85 * lights); } });
    var push = st.scrub;
    var engage = smooth(5.3, 6.5, time) * (1 - smooth(8.9, 9.9, time)); // rollers move in to the car
    items.push({ z: 6.7, draw: function () { drawGantry(6.7, lights, time, push); drawBeams(lights, time, 0.4 + 0.6 * push + 0.5 * st.rinse); } });
    items.push({ z: Z.topBrush, draw: function () { drawTopBrush(Z.topBrush, 2.45 - 0.62 * engage, brushAngle, lights, push, time); } });
    items.push({ z: Z.brush, draw: function () {
      drawSideBrush(-1, Z.brush, -(2.8 - 1.12 * engage), brushAngle, lights, push, time);
      drawSideBrush(1, Z.brush, 2.8 - 1.12 * engage, brushAngle, lights, push, time);
    } });
    items.push({ z: 5.4, draw: function () {
      drawRain(time, 6, 1.4, 240, 0.45, 2.2, 0.6 * st.rinse, '170,210,255', 0.014);
      drawJetArch(5.3, time, st.rinse);
    } });
    items.push({ z: z - 0.01, draw: function () { drawScan(z, clamp01((time - 5.2) / 1.5)); } });
    items.push({ z: Z.dry, draw: function () { drawAirBlade(time, lights, st.dry); } });
    function addCar(cz, cst) {
      items.push({ z: cz, draw: function () { if (carReady) drawCarPhoto(time, cz, lights, cst); else drawCar(time, cz, lights, cst); } });
    }
    addCar(z, st);
    if (time > LOOP - 2.8) addCar(carZ(time - LOOP), stateAt(time - LOOP));
    items.sort(function (a, b) { return b.z - a.z; });
    for (var i = 0; i < items.length; i++) items[i].draw();

    ctx.restore();
    drawLens(time, z, st);

    updateStage(time);
  }

  // Air blade: a bright bar across the arch with a sheet of light and mist below it
  function drawAirBlade(time, lights, act) {
    var z = Z.dry, s = F / z;
    var y = sy(2.95, z), x1 = sx(-2.4, z), x2 = sx(2.4, z);
    ctx.globalCompositeOperation = 'lighter';
    var a = (0.3 + 0.7 * act) * lights;
    ctx.strokeStyle = 'rgba(90,150,255,' + (0.25 * a).toFixed(3) + ')';
    ctx.lineWidth = 0.18 * s;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    ctx.strokeStyle = 'rgba(210,235,255,' + (0.9 * a).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, 0.03 * s);
    ctx.stroke();
    if (act > 0.01) {
      var g = ctx.createLinearGradient(0, y, 0, sy(0, z));
      g.addColorStop(0, 'rgba(150,195,255,' + (0.22 * act).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(150,195,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x1, y, x2 - x1, sy(0, z) - y);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function updateStage(time) {
    var stage = -1;
    if (time >= tSpray && time < tFoam) stage = 0;
    else if (time >= tFoam && time < 6.3) stage = 1;
    else if (time >= 6.3 && time < T.scrubEnd) stage = 2;
    else if (time >= T.scrubEnd && time < T.rinseEnd) stage = 3;
    else if (time >= T.rinseEnd && time < 11.4) stage = 4;
    if (stage === currentStage) return;
    currentStage = stage;
    stageEl.classList.toggle('on', stage >= 0);
    if (stage >= 0) {
      stepEl.textContent = '0' + (stage + 1);
      stageNameEl.textContent = STAGES[stage];
    }
  }

  function frame(now) {
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    if (running && visible) {
      t += dt;
      if (t >= LOOP) t -= LOOP;
      render(t, dt);
    }
    requestAnimationFrame(frame);
  }

  function redraw() { render(t, 0); }

  seed();
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
