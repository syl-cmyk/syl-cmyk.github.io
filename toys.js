// Desk toys: emoji objects that fall onto the page's cards, bounce off the
// window edges, and can be grabbed and thrown. The four screen edges can also
// be grabbed and shaken, and moving the browser window itself shakes the toys.
// Physics by Matter.js.
(function () {
  var M = window.Matter;
  var canvas = document.getElementById("toys");
  if (!M || !canvas) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    canvas.hidden = true;
    var tools = document.querySelector(".toy-tools");
    if (tools) tools.hidden = true;
    return;
  }

  var Engine = M.Engine, Bodies = M.Bodies, Body = M.Body, Composite = M.Composite;
  var Constraint = M.Constraint, Query = M.Query, Vector = M.Vector, Sleeping = M.Sleeping;

  var ctx = canvas.getContext("2d");
  // Sleeping lets toys that have come to rest stop costing anything.
  var engine = Engine.create({ enableSleeping: true });
  var world = engine.world;
  engine.gravity.y = 1;

  var TOY = 0x0001;
  var SOLID = 0x0002;
  var MAX_TOYS = 40;

  // glyph, body shape, and body size as a fraction of the drawn size
  var TYPES = [
    { g: "📚", rect: [0.9, 0.75] },  // books
    { g: "📕", rect: [0.7, 0.85] },  // red book
    { g: "📗", rect: [0.7, 0.85] },  // green book
    { g: "📘", rect: [0.7, 0.85] },  // blue book
    { g: "📓", rect: [0.7, 0.85] },  // notebook
    { g: "🎓", rect: [0.95, 0.7] },  // graduation cap
    { g: "☕", circle: 0.4 },              // coffee
    { g: "🍎", circle: 0.42 },       // apple
    { g: "💡", circle: 0.36 },       // light bulb
    { g: "🎲", rect: [0.8, 0.8] },   // dice
    { g: "🪑", rect: [0.75, 0.95] }, // chair
    { g: "🧪", rect: [0.5, 0.9] },   // test tube
    { g: "🔬", rect: [0.8, 0.9] }    // microscope
  ];

  var W = 0;
  var H = 0;
  var dpr = 1;
  var toys = [];
  var cardBodies = [];

  // Work is only done when something changed.
  var dirty = true;      // card positions need re-reading
  var syncUntil = 0;     // keep re-reading while a card transition runs
  var lastSync = 0;
  var needsDraw = true;  // the canvas must be repainted once even if idle

  function rand(min, max) { return min + Math.random() * (max - min); }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function toySize() { return W < 700 ? 38 : 50; }

  function wakeAll() {
    toys.forEach(function (toy) {
      if (toy.leaveAt === undefined) Sleeping.set(toy.body, false);
    });
  }

  function addToy(x, y) {
    if (toys.length >= MAX_TOYS) return;
    var type = TYPES[Math.floor(Math.random() * TYPES.length)];
    var s = toySize() * rand(0.9, 1.15);
    var opts = {
      restitution: 0.35,
      friction: 0.4,
      frictionAir: 0.008,
      density: 0.002,
      angle: rand(0, Math.PI * 2),
      collisionFilter: { category: TOY, mask: TOY | SOLID }
    };
    var body;
    if (type.circle) {
      body = Bodies.circle(x, y, s * type.circle, opts);
    } else {
      opts.chamfer = { radius: 5 };
      body = Bodies.rectangle(x, y, s * type.rect[0], s * type.rect[1], opts);
    }
    Composite.add(world, body);
    toys.push({ body: body, glyph: type.g, size: s });
  }

  function spawn(count) {
    for (var i = 0; i < count; i++) {
      addToy(rand(40, Math.max(80, W - 40)), rand(-500, -40));
    }
  }

  // ---------- the four screen edges ----------
  // Each edge is a wall that can be pushed in from the screen border ("offset"
  // is how far). Every physics step the wall is moved with a velocity, so toys
  // it pushes get real momentum. Let go and it springs back like a rubber band.

  var WALL_T = 200;        // thick, so a fast wall never lets a toy through
  var WALL_LEN = 20000;
  var EDGE = 14;           // px from the screen border where an edge can be grabbed
  var MAX_WALL_STEP = 40;  // px a wall may move per physics step
  var wallList = [];       // 0 left, 1 right, 2 top, 3 bottom
  var grabWall = null;
  var hoverSide = -1;
  var hoverRight = 0;      // where the right edge is (the scrollbar is excluded)
  var renderW = 0;         // the window size the walls use; eases toward W and H
  var renderH = 0;         // so that resizing the window pushes toys, not teleports them

  function makeWalls() {
    // axis and the direction that means "inward"
    var defs = [
      { axis: "x", sign: 1,  w: WALL_T,   h: WALL_LEN },
      { axis: "x", sign: -1, w: WALL_T,   h: WALL_LEN },
      { axis: "y", sign: 1,  w: WALL_LEN, h: WALL_T },
      { axis: "y", sign: -1, w: WALL_LEN, h: WALL_T }
    ];
    wallList = defs.map(function (d, i) {
      var body = Bodies.rectangle(0, 0, d.w, d.h, {
        isStatic: true,
        restitution: 0.4,
        // The top wall is a ceiling only while it is pulled down, because toys
        // are dropped from above the screen.
        collisionFilter: { category: SOLID, mask: i === 2 ? 0 : TOY }
      });
      Composite.add(world, body);
      return { body: body, axis: d.axis, sign: d.sign, offset: 0, vel: 0, target: 0, grab: null };
    });
  }

  function wallPosition(i, o) {
    if (i === 0) return { x: -WALL_T / 2 + o, y: 0 };
    if (i === 1) return { x: renderW + WALL_T / 2 - o, y: 0 };
    if (i === 2) return { x: 0, y: -WALL_T / 2 + o };
    return { x: 0, y: renderH + WALL_T / 2 - o };
  }

  function placeWalls(withVelocity) {
    wallList.forEach(function (w, i) {
      Body.setPosition(w.body, wallPosition(i, w.offset), withVelocity);
    });
  }

  function wallsActive() {
    if (renderW !== W || renderH !== H) return true;
    return wallList.some(function (w) { return w.grab || w.offset !== 0 || w.vel !== 0; });
  }

  function stepWalls() {
    var moved = false;
    var dw = W - renderW;
    var dh = H - renderH;
    if (dw || dh) {
      renderW += Math.abs(dw) < 0.5 ? dw : clamp(dw * 0.4, -30, 30);
      renderH += Math.abs(dh) < 0.5 ? dh : clamp(dh * 0.4, -30, 30);
      moved = true;
    }
    wallList.forEach(function (w, i) {
      var prev = w.offset;
      if (w.grab) {
        var dim = w.axis === "x" ? renderW : renderH;
        w.offset += (clamp(w.target, -40, dim * 0.45) - w.offset) * 0.35;
      } else if (w.offset !== 0 || w.vel !== 0) {
        w.vel += -0.08 * w.offset - 0.18 * w.vel;
        w.offset += w.vel;
        if (Math.abs(w.offset) < 0.3 && Math.abs(w.vel) < 0.3) {
          w.offset = 0;
          w.vel = 0;
        }
      }
      var d = clamp(w.offset - prev, -MAX_WALL_STEP, MAX_WALL_STEP);
      w.offset = prev + d;
      // Keep the speed if it is let go mid-swing, so the spring starts from it.
      if (w.grab) w.vel = d;
      if (d) moved = true;
      if (i === 2) w.body.collisionFilter.mask = w.offset > 1 ? TOY : 0;
    });
    // Called every step, even for walls that are not moving, so a wall's
    // velocity is zero again the moment it stops.
    placeWalls(true);
    if (moved) wakeAll();
  }

  // A toy that somehow ended up far outside the window is dropped back in.
  function rescueToys() {
    toys.forEach(function (toy) {
      if (toy.leaveAt !== undefined) return;
      var p = toy.body.position;
      if (p.x < -150 || p.x > W + 150 || p.y > H + 150) {
        Body.setPosition(toy.body, { x: clamp(p.x, 40, Math.max(40, W - 40)), y: -60 });
        Body.setVelocity(toy.body, { x: 0, y: 0 });
      }
    });
  }

  // Which edge (0 left, 1 right, 2 top, 3 bottom) is this point on, or -1.
  function edgeAt(p) {
    var right = document.documentElement.clientWidth;
    var d = [p.x, right - p.x, p.y, H - p.y];
    var side = 0;
    for (var i = 1; i < 4; i++) if (d[i] < d[side]) side = i;
    hoverRight = right;
    return d[side] >= 0 && d[side] <= EDGE ? side : -1;
  }

  // ---------- moving the browser window ----------
  // When the window is pushed around, the toys lag behind it like things on a
  // table. Steady movement does nothing; starting, stopping and turning around
  // kicks them.

  var winX = window.screenX;
  var winY = window.screenY;
  var winVX = 0;
  var winVY = 0;

  function pollWindow() {
    var x = window.screenX;
    var y = window.screenY;
    if (typeof x !== "number" || typeof y !== "number") return;
    var vx = winVX * 0.6 + (x - winX) * 0.4;
    var vy = winVY * 0.6 + (y - winY) * 0.4;
    var ax = vx - winVX;
    var ay = vy - winVY;
    winX = x;
    winY = y;
    winVX = vx;
    winVY = vy;
    if (Math.abs(ax) + Math.abs(ay) < 0.5) return;
    toys.forEach(function (toy) {
      if (toy.leaveAt !== undefined) return;
      Sleeping.set(toy.body, false);
      var v = toy.body.velocity;
      Body.setVelocity(toy.body, {
        x: clamp(v.x - ax * 0.8, -25, 25),
        y: clamp(v.y - ay * 0.8, -25, 25)
      });
    });
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    if (!renderW) {
      renderW = W;
      renderH = H;
      placeWalls(false);
    }
    dirty = true;
    needsDraw = true;
    wakeAll();
  }

  // Each card on the page is a solid, immovable slab that toys can land on.
  // Reading a card's position forces the browser to lay the page out, so it is
  // only done when something could have moved a card: scrolling, resizing, a
  // card changing size, or a card's tilt transition (hover) running. Toys
  // resting on a card that moved are woken so they react to it.
  function syncCards(now) {
    dirty = false;
    lastSync = now;
    var moved = false;
    var els = document.querySelectorAll(".card");
    Array.prototype.forEach.call(els, function (el, i) {
      var w = el.offsetWidth;
      var h = el.offsetHeight;
      if (!w || !h) return;
      var entry = cardBodies[i];
      if (!entry) {
        var body = Bodies.rectangle(0, 0, w, h, {
          isStatic: true,
          collisionFilter: { category: SOLID, mask: TOY }
        });
        Composite.add(world, body);
        entry = cardBodies[i] = { body: body, w: w, h: h };
        moved = true;
      }
      if (entry.w !== w || entry.h !== h) {
        Body.scale(entry.body, w / entry.w, h / entry.h);
        entry.w = w;
        entry.h = h;
        moved = true;
      }
      var rect = el.getBoundingClientRect();
      var angle = 0;
      var matrix = window.getComputedStyle(el).transform;
      if (matrix && matrix !== "none") {
        var v = matrix.match(/matrix\(([^)]+)\)/);
        if (v) {
          var parts = v[1].split(",");
          angle = Math.atan2(parseFloat(parts[1]), parseFloat(parts[0]));
        }
      }
      var px = rect.left + rect.width / 2;
      var py = rect.top + rect.height / 2;
      var pos = entry.body.position;
      if (Math.abs(pos.x - px) + Math.abs(pos.y - py) > 0.5 || Math.abs(entry.body.angle - angle) > 0.002) {
        moved = true;
        Body.setPosition(entry.body, { x: px, y: py });
        Body.setAngle(entry.body, angle);
      }
    });
    if (moved) wakeAll();
  }

  function markDirty() { dirty = true; }

  window.addEventListener("scroll", markDirty, { passive: true });
  window.addEventListener("load", markDirty);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(markDirty);
  // Hovering straightens a card with a short transition; follow it while it runs.
  document.addEventListener("transitionrun", function (e) {
    if (e.target.classList && e.target.classList.contains("card")) {
      syncUntil = performance.now() + 400;
    }
  });
  if (window.ResizeObserver) {
    var observer = new ResizeObserver(markDirty);
    observer.observe(document.body);
    Array.prototype.forEach.call(document.querySelectorAll(".card"), function (el) {
      observer.observe(el);
    });
  }

  // ---------- drawing ----------

  var FADE_MS = 350;

  // Each emoji is drawn (with its shadow) once into a small offscreen canvas,
  // then stamped onto the main canvas every frame. Drawing text with a blurred
  // shadow 40 times per frame was the slow part.
  var sprites = {};
  var spriteKey = "";

  function getSprite(glyph) {
    var sp = sprites[glyph];
    if (sp) return sp;
    var base = toySize() * 1.15;
    var side = Math.ceil(base * 1.6);
    var c = document.createElement("canvas");
    c.width = Math.round(side * dpr);
    c.height = Math.round(side * dpr);
    var g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "rgba(0, 0, 0, 0.35)";
    g.shadowBlur = 6;
    g.shadowOffsetY = 3;
    g.font = base + "px serif";
    g.fillText(glyph, side / 2, side / 2 + base * 0.06);
    sp = sprites[glyph] = { canvas: c, side: side, base: base };
    return sp;
  }

  // A pushed-in edge looks like a dark wooden border sliding in from the side.
  function drawWalls() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wallList.forEach(function (w, i) {
      var o = w.offset;
      if (o <= 0.5) return;
      var g;
      var faceX;
      var faceY;
      if (i === 0) {
        g = ctx.createLinearGradient(0, 0, o, 0);
      } else if (i === 1) {
        faceX = renderW - o;
        g = ctx.createLinearGradient(W, 0, faceX, 0);
      } else if (i === 2) {
        g = ctx.createLinearGradient(0, 0, 0, o);
      } else {
        faceY = renderH - o;
        g = ctx.createLinearGradient(0, H, 0, faceY);
      }
      g.addColorStop(0, "#1d0f07");
      g.addColorStop(1, "#3b2415");
      ctx.fillStyle = g;
      if (i === 0) ctx.fillRect(0, 0, o, H);
      else if (i === 1) ctx.fillRect(faceX, 0, W - faceX, H);
      else if (i === 2) ctx.fillRect(0, 0, W, o);
      else ctx.fillRect(0, faceY, W, H - faceY);
      ctx.fillStyle = "rgba(255, 214, 120, 0.55)";
      if (i === 0) ctx.fillRect(o - 2, 0, 2, H);
      else if (i === 1) ctx.fillRect(faceX, 0, 2, H);
      else if (i === 2) ctx.fillRect(0, o - 2, W, 2);
      else ctx.fillRect(0, faceY, W, 2);
    });
    // A faint line shows which edge is grabbable under the mouse.
    if (hoverSide >= 0 && !grabWall && wallList[hoverSide].offset <= 0.5) {
      ctx.fillStyle = "rgba(255, 214, 120, 0.35)";
      if (hoverSide === 0) ctx.fillRect(0, 0, 3, H);
      else if (hoverSide === 1) ctx.fillRect(hoverRight - 3, 0, 3, H);
      else if (hoverSide === 2) ctx.fillRect(0, 0, W, 3);
      else ctx.fillRect(0, H - 3, W, 3);
    }
  }

  function draw(now) {
    needsDraw = false;
    var key = dpr + "|" + toySize();
    if (key !== spriteKey) {
      sprites = {};
      spriteKey = key;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    drawWalls();
    toys.forEach(function (toy) {
      var b = toy.body;
      var sp = getSprite(toy.glyph);
      var k = toy.size / sp.base;
      if (toy.leaveAt !== undefined) {
        var t = Math.min(1, Math.max(0, (now - toy.leaveAt) / FADE_MS));
        ctx.globalAlpha = 1 - t;
        k *= 1 - 0.3 * t;
      }
      var cs = Math.cos(b.angle);
      var sn = Math.sin(b.angle);
      ctx.setTransform(cs * dpr, sn * dpr, -sn * dpr, cs * dpr, b.position.x * dpr, b.position.y * dpr);
      var d = sp.side * k;
      ctx.drawImage(sp.canvas, -d / 2, -d / 2, d, d);
      ctx.globalAlpha = 1;
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------- grab and throw ----------

  var drag = null;
  var cursor = "";

  function toyAt(p) {
    var hit = Query.point(toys.filter(function (t) { return t.leaveAt === undefined; })
      .map(function (t) { return t.body; }), p);
    return hit.length ? hit[hit.length - 1] : null;
  }

  document.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    var p = { x: e.clientX, y: e.clientY };
    var hit = toyAt(p);
    if (!hit) {
      // No toy here: maybe the pointer is on a screen edge (mouse and pen only,
      // touch keeps its normal scrolling).
      if (e.pointerType === "touch") return;
      if (e.target.closest && e.target.closest(".toy-tools")) return;
      var side = edgeAt(p);
      if (side < 0) return;
      e.preventDefault();
      var w = wallList[side];
      var coord = w.axis === "x" ? p.x : p.y;
      w.grab = { coord: coord, offset: w.offset };
      w.target = w.offset;
      grabWall = w;
      try { document.documentElement.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
      document.body.classList.add("dragging-toy");
      return;
    }
    e.preventDefault();
    Sleeping.set(hit, false);
    var local = Vector.rotate({ x: p.x - hit.position.x, y: p.y - hit.position.y }, -hit.angle);
    drag = Constraint.create({
      pointA: p,
      bodyB: hit,
      pointB: local,
      stiffness: 0.25,
      damping: 0.12,
      length: 0
    });
    Composite.add(world, drag);
    document.body.classList.add("dragging-toy");
  });

  document.addEventListener("pointermove", function (e) {
    var p = { x: e.clientX, y: e.clientY };
    if (grabWall) {
      var coord = grabWall.axis === "x" ? p.x : p.y;
      grabWall.target = grabWall.grab.offset + grabWall.sign * (coord - grabWall.grab.coord);
      return;
    }
    if (drag) {
      drag.pointA = p;
      return;
    }
    var next = "";
    var side = -1;
    if (toyAt(p)) {
      next = "grab";
    } else if (e.pointerType !== "touch" && !(e.target.closest && e.target.closest(".toy-tools"))) {
      side = edgeAt(p);
      if (side >= 0) next = side < 2 ? "ew-resize" : "ns-resize";
    }
    if (next !== cursor) {
      cursor = next;
      document.body.style.cursor = next;
    }
    if (side !== hoverSide) {
      hoverSide = side;
      needsDraw = true;
    }
  });

  document.documentElement.addEventListener("mouseleave", function () {
    if (hoverSide >= 0) {
      hoverSide = -1;
      needsDraw = true;
    }
  });

  function release() {
    if (drag) {
      Composite.remove(world, drag);
      drag = null;
    }
    if (grabWall) {
      grabWall.grab = null;
      grabWall = null;
    }
    document.body.classList.remove("dragging-toy");
  }

  document.addEventListener("pointerup", release);
  document.addEventListener("pointercancel", release);
  window.addEventListener("blur", release);

  // ---------- buttons ----------

  var shake = document.getElementById("shake-button");
  var more = document.getElementById("more-button");
  var clear = document.getElementById("clear-button");

  if (shake) {
    shake.addEventListener("click", function () {
      toys.forEach(function (toy) {
        if (toy.leaveAt !== undefined) return;
        Sleeping.set(toy.body, false);
        Body.setVelocity(toy.body, { x: rand(-9, 9), y: -rand(9, 18) });
        Body.setAngularVelocity(toy.body, rand(-0.25, 0.25));
      });
    });
  }

  if (more) {
    more.addEventListener("click", function () { spawn(4); });
  }

  if (clear) {
    clear.addEventListener("click", function () {
      release();
      var t0 = performance.now();
      toys.forEach(function (toy, i) {
        if (toy.leaveAt !== undefined) return;
        // Freeze it in place so it fades where it is, with a small stagger.
        Body.setStatic(toy.body, true);
        toy.body.collisionFilter.mask = 0;
        toy.leaveAt = t0 + i * 20;
      });
    });
  }

  // ---------- loop ----------

  var STEP = 1000 / 60;
  var last = 0;
  var acc = 0;

  function frame(now) {
    pollWindow();

    // A slow safety net in case a card moved in a way nothing above noticed.
    if (dirty || now < syncUntil || now - lastSync > 500) syncCards(now);

    // Skip all physics and drawing while every toy is asleep and untouched.
    var active = !!drag || !!grabWall || wallsActive();
    for (var j = 0; j < toys.length && !active; j++) {
      if (toys[j].leaveAt !== undefined || !toys[j].body.isSleeping) active = true;
    }

    if (active) {
      var dt = Math.min(64, now - (last || now));
      acc += dt;
      var steps = 0;
      while (acc >= STEP && steps < 3) {
        stepWalls();
        Engine.update(engine, STEP);
        acc -= STEP;
        steps++;
      }
      if (steps === 3) acc = 0;
      rescueToys();
      for (var i = toys.length - 1; i >= 0; i--) {
        if (toys[i].leaveAt !== undefined && now - toys[i].leaveAt > FADE_MS) {
          Composite.remove(world, toys[i].body);
          toys.splice(i, 1);
        }
      }
      draw(now);
    } else {
      acc = 0;
      if (needsDraw) draw(now);
    }
    last = now;
    requestAnimationFrame(frame);
  }

  makeWalls();
  resize();
  window.addEventListener("resize", resize);
  spawn(W < 700 ? 8 : 14);
  requestAnimationFrame(frame);
})();
