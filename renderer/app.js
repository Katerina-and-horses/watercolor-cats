'use strict';
// Жизнь котиков: поведение, клубочки, отрисовка, мышь. Все координаты — в физических пикселях холста.
(() => {
  const api = window.catAPI || { setIgnore() {}, getStore: async () => ({}), save() {}, onCmd() {}, selftestDone() {} };
  const SELFTEST = new URLSearchParams(location.search).has('selftest');
  const cv = document.getElementById('c'), ctx = cv.getContext('2d');
  const { SPR, ANIMS } = Art;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);
  // единиц в секунду (синхронно с шагом анимации), ускорение свободного падения клубка
  const WALK = 29, STALK = 11.5, RUN = 135, GRAV = 900, REACH = 30, MAX_BALLS = 3;

  let DPR = 1, SCALE = 1, k = 1, W = 0, H = 0, groundY = 0;
  let frames = null, sprites = null, ready = false, building = false;
  let now = 0, saveAt = 60, lastSig = '', ballSeq = 0;
  const cats = [], particles = [], balls = [];
  const stats = { throws: 0, pounces: 0, catches: 0, hits: 0 };
  let drag = null, hoverT = null, ignoring = true, showBasket = true;
  const mouse = { x: -1, y: -1, down: false, cat: null, stroke: 0, downX: 0, downY: 0 };

  const minX = () => 60 * k, maxX = () => W - 90 * k;
  const offL = () => -100 * k, offR = () => W + 100 * k;
  const gy = c => groundY - c.back * k - (c.jumpY || 0) * k;
  const visible = c => c.state !== 'away';
  const other = c => cats[1 - c.i];
  const night = () => { const hr = new Date().getHours(); return hr >= 23 || hr < 6; };
  const ballR = () => Art.YARN_R * k;
  const alive = b => b && balls.includes(b);

  // ---------- размеры и предрендер ----------
  function measure() {
    DPR = window.devicePixelRatio || 1;
    W = cv.width = Math.round(window.innerWidth * DPR);
    H = cv.height = Math.round(window.innerHeight * DPR);
    k = SCALE * DPR;
    groundY = H - 10 * k;
  }
  async function prerender() {
    building = true;
    const s = k, f = {};
    for (const key of Object.keys(Art.LOOKS)) {
      f[key] = {};
      for (const [name, a] of Object.entries(ANIMS)) {
        f[key][name] = [];
        for (let i = 0; i < a.n; i++) f[key][name].push(Art.renderFrame(a.pose(i), Art.LOOKS[key], s));
        await new Promise(r => setTimeout(r, 0));
      }
    }
    const yarn = Art.YARN.map((col, i) => Art.yarnSprite(s, col, 11 + i * 5));
    sprites = {
      heart: Art.heartSprite(s), heartO: Art.heartSprite(s, true), yarn,
      basket: Art.basketSprite(s, yarn), shadow: Art.shadowSprite(s), shadowWide: Art.shadowSprite(s, 40),
    };
    frames = f;
    building = false;
  }

  // ---------- котики ----------
  function makeCat(key, i, saved = {}) {
    return {
      key, i, look: Art.LOOKS[key], name: Art.LOOKS[key].name, x: -1e5, dir: 1, back: i === 1 ? 5 : 0,
      state: 'away', t: 0, dur: 1e9, then: null, target: 0, anim: 'stand', animT: 0, animRev: false, post: 'stand', trans: null,
      love: saved.love ?? 60, pets: saved.pets ?? 0, plays: saved.plays ?? 0,
      blinkAt: rand(2, 6), blink: 0, lastPet: -99, greeted: true, frame: null, zAt: 0, purrAt: 0,
      jumpY: 0, jump: null, ball: null, fun: 0, playCool: 0, lastStrike: -1, faceAfter: 1, pendingGreet: null,
    };
  }
  function set(c, st, o = {}) {
    c.state = st; c.t = 0; c.dur = o.dur ?? 1e9; c.then = o.then ?? null;
    if (st !== 'pounce') { c.jumpY = 0; c.jump = null; }
    if (o.target != null) c.target = o.target;
  }
  function setAnim(c, a, rev = false) {
    if (c.anim !== a || c.animRev !== rev) { c.anim = a; c.animT = 0; c.animRev = rev; }
  }
  function frameIndex(c) {
    const a = ANIMS[c.anim];
    let i = Math.floor(c.animT * a.fps);
    i = a.once ? Math.min(i, a.n - 1) : i % a.n;
    return c.animRev ? a.n - 1 - i : i;
  }
  const animDone = c => c.animT * ANIMS[c.anim].fps >= ANIMS[c.anim].n;
  function currentFrame(c) { return frames[c.key][c.anim][frameIndex(c)]; }

  // позы-«этажи»: стоя, сидя, лёжа буханкой, клубком; переходы — короткие анимации
  const TRANS = {
    'stand>sit': ['sitDown', false], 'sit>stand': ['sitDown', true], 'stand>loaf': ['lieDown', false],
    'loaf>stand': ['lieDown', true], 'loaf>curl': ['curlIn', false], 'curl>loaf': ['curlIn', true],
  };
  function posture(c, want) {
    if (c.post === want) return true;
    const nxt = TRANS[c.post + '>' + want] ? want : c.post === 'curl' ? 'loaf' : c.post !== 'stand' ? 'stand' : want === 'curl' ? 'loaf' : want;
    const [anim, rev] = TRANS[c.post + '>' + nxt];
    c.trans = { to: nxt }; c.anim = anim; c.animRev = rev; c.animT = 0;
    return false;
  }

  function moveTo(c, speed, dt) {
    const dx = c.target - c.x;
    if (Math.abs(dx) < 1) { c.x = c.target; return true; }
    c.dir = Math.sign(dx);
    c.x += c.dir * Math.min(Math.abs(dx), speed * k * dt);
    return Math.abs(c.target - c.x) < 1;
  }
  function enter(c, then, side) {
    side = side || (Math.random() < 0.5 ? -1 : 1);
    c.x = side < 0 ? offL() : offR();
    c.post = 'stand'; c.trans = null; c.jumpY = 0; c.ball = null;
    set(c, 'enter', { target: rand(minX(), maxX()), then });
  }
  function greet() {
    if (!W) return;
    const side = Math.random() < 0.5 ? -1 : 1, cx = W / 2 + rand(-120, 120) * k;
    cats.forEach((c, i) => {
      const tx = clamp(cx + (i === 0 ? -55 : 55) * k, minX(), maxX());
      c.greeted = false; c.ball = null;
      if (c.state === 'away') {
        c.x = side < 0 ? offL() - i * 70 * k : offR() + i * 70 * k;
        c.post = 'stand'; c.trans = null;
        set(c, 'enter', { target: tx, then: 'wait' });
      } else if (c.state === 'pounce') c.pendingGreet = tx;
      else set(c, 'walk', { target: tx, then: 'wait' });
    });
  }
  function arrive(c) {
    if (c.then === 'wait') {
      c.dir = Math.sign(W / 2 - c.x) || 1;
      set(c, 'wait', { dur: rand(120, 200) });
    } else if (c.then === 'boopReady') {
      c.dir = c.faceAfter;
      set(c, 'boopReady', { dur: 20 });
    } else if (Math.random() < 0.5) set(c, 'sit', { dur: rand(4, 12) });
    else set(c, 'idle', { dur: rand(2, 6) });
  }
  function startBoop(a, b) {
    const left = a.x <= b.x ? a : b, right = left === a ? b : a;
    const xm = clamp((a.x + b.x) / 2, minX() + 45 * k, maxX() - 45 * k);
    left.faceAfter = 1; right.faceAfter = -1;
    set(left, 'walk', { target: xm - 39 * k, then: 'boopReady' });
    set(right, 'walk', { target: xm + 39 * k, then: 'boopReady' });
  }
  const FREE = ['idle', 'sit', 'walk', 'groom', 'wait', 'loaf', 'watch'];
  function bored(c) {
    const b = c.ball;
    if (b && b.pinnedBy === c) b.pinnedBy = null;
    c.ball = null; c.jumpY = 0; c.jump = null;
    c.playCool = now + rand(25, 80);
    set(c, Math.random() < 0.5 ? 'groom' : 'sit', { dur: rand(4, 10) });
  }

  function decide(c) {
    const o = other(c), n = night(), lazy = c.look.lazy, play = c.look.play;
    const canBoop = visible(o) && ['idle', 'sit'].includes(o.state);
    const rest = balls.find(b => !b.held && b.ground && !b.pinnedBy);
    const opts = [['walk', 20], ['sit', 20], ['idle', 8], ['groom', 10], ['loaf', 9 * lazy * (n ? 1.8 : 1)], ['sleep', (n ? 24 : 5) * lazy],
      ['leave', n ? 1 : 3], ['zoom', (n ? 0.3 : 2.5) * play], ['boop', canBoop ? 6 : 0], ['play', rest && now > c.playCool ? 14 * play : 0],
      ['wait', c.love < 35 ? 8 : 1.5]];
    let r = Math.random() * opts.reduce((s, x) => s + x[1], 0), choice = 'idle';
    for (const [name, w] of opts) if ((r -= w) < 0) { choice = name; break; }
    switch (choice) {
      case 'walk': set(c, 'walk', { target: rand(minX(), maxX()) }); break;
      case 'sit': set(c, 'sit', { dur: rand(8, 40) }); break;
      case 'groom': set(c, 'groom', { dur: rand(5, 14) }); break;
      case 'loaf': set(c, 'loaf', { dur: rand(20, 90) }); break;
      case 'sleep': set(c, 'sleep', { dur: rand(60, 300) * (n ? 2.5 : 1) * lazy }); break;
      case 'leave': set(c, 'leave', { target: c.x < W / 2 ? offL() : offR() }); break;
      case 'zoom': set(c, 'zoom', { target: c.x < W / 2 ? offR() : offL() }); break;
      case 'boop': startBoop(c, o); break;
      case 'play': c.ball = rest; c.fun = rand(2, 5) * play; set(c, 'chase'); break;
      case 'wait': c.greeted = false; set(c, 'walk', { target: clamp(W / 2 + rand(-250, 250) * k, minX(), maxX()), then: 'wait' }); break;
      default: set(c, 'idle', { dur: rand(3, 9) });
    }
  }

  // ---------- игра с клубком ----------
  // клубок брошен или отбит: свободные котики решают, бежать ли за ним
  function notice(b, src) {
    for (const c of cats) {
      if (!visible(c) || c === src || c.ball === b) continue;
      if (['chase', 'crouch', 'pounce', 'bat', 'notice', 'enter', 'leave', 'zoom', 'boop', 'boopReady'].includes(c.state)) continue;
      const sleeping = c.post === 'curl', near = Math.abs(b.x - c.x) < 150 * k;
      let p = c.look.play * (sleeping ? (near ? 0.35 : 0.05) : 0.9);
      if (cats.some(o => o !== c && o.ball === b)) p *= 0.55;
      if (now < c.playCool) p *= 0.35;
      if (c.state === 'petted') p *= 0.3;
      if (Math.random() < p) {
        c.ball = b; c.fun = rand(2.5, 6) * c.look.play;
        set(c, 'notice', { dur: rand(0.2, 0.7) + (sleeping ? 0.9 : 0) });
      }
    }
  }
  function hitBall(c, b, strong) {
    b.pinnedBy = null;
    strong = strong || Math.random() < 0.3;
    const sgn = strong || Math.random() < 0.75 ? c.dir : -c.dir;
    b.vx = sgn * (strong ? rand(200, 380) : rand(50, 120)) * k;
    b.vy = -(strong ? rand(150, 320) : rand(20, 140)) * k;
    b.ground = false;
    stats.hits++;
    c.fun -= strong ? 1 : 0.5;
    c.love = Math.min(100, c.love + 0.3);
    if (strong) notice(b, c);
    if (c.fun <= 0) bored(c);
    else set(c, 'chase');
  }
  function startPounce(c) {
    const b = c.ball, px = b.x + (b.ground ? b.vx * 0.3 : 0);
    c.dir = Math.sign(px - c.x) || c.dir;
    c.jump = { x0: c.x, x1: clamp(px - c.dir * 26 * k, 20 * k, W - 20 * k), T: 0.55, t: 0 };
    set(c, 'pounce');
    c.anim = 'pounce'; c.animRev = false; c.animT = 0;
    stats.pounces++;
  }
  // клубок у курсора свешивается низко — котики рядом следят и пытаются достать лапкой
  function dangle(b) {
    for (const c of cats) {
      if (!visible(c) || !(FREE.includes(c.state) && c.state !== 'watch' || c.state === 'watch' && c.ball === b)) continue;
      const dx = b.x - c.x;
      if (Math.abs(dx) > 130 * k || b.y < groundY - 95 * k) continue;
      if (c.state !== 'watch') {
        if (c.state === 'loaf' && Math.random() > 0.02) continue;
        c.ball = b; c.fun = rand(2.5, 6) * c.look.play; set(c, 'watch', { dur: 12 });
      }
      c.dir = Math.sign(dx) || c.dir;
      if (Math.abs(b.x - (c.x + c.dir * REACH * k)) < 22 * k && b.y > groundY - 50 * k && c.post === 'sit' && !c.trans) {
        set(c, 'bat', { dur: rand(1, 2) }); c.lastStrike = -1;
      }
    }
  }

  function update(c, dt) {
    c.t += dt; c.animT += dt;
    c.blinkAt -= dt;
    if (c.blinkAt < 0) { c.blink = 0.15; c.blinkAt = rand(2.5, 7); }
    c.blink = Math.max(0, c.blink - dt);
    if (c.state !== 'sleep') c.love = Math.max(0, c.love - dt / 600);
    if (c.trans) {
      if (!animDone(c)) return;
      c.post = c.trans.to; c.trans = null;
    }

    switch (c.state) {
      case 'away':
        if (c.t > c.dur) enter(c, Math.random() < 0.3 ? 'wait' : null);
        return;
      case 'enter': case 'walk':
        if (!posture(c, 'stand')) break;
        setAnim(c, 'walk');
        if (moveTo(c, WALK, dt)) arrive(c);
        break;
      case 'leave':
        if (!posture(c, 'stand')) break;
        setAnim(c, 'walk');
        if (moveTo(c, WALK, dt)) set(c, 'away', { dur: rand(90, 500) });
        break;
      case 'zoom':
        if (!posture(c, 'stand')) break;
        setAnim(c, 'run');
        if (moveTo(c, RUN, dt)) set(c, 'away', { dur: rand(10, 60) });
        break;
      case 'idle':
        if (!posture(c, 'stand')) break;
        setAnim(c, 'stand');
        if (c.t > c.dur) decide(c);
        break;
      case 'sit':
        if (!posture(c, 'sit')) break;
        setAnim(c, 'sit');
        if (c.t > c.dur) decide(c);
        break;
      case 'groom':
        if (!posture(c, 'sit')) break;
        setAnim(c, 'groom');
        if (c.t > c.dur) set(c, 'sit', { dur: rand(3, 10) });
        break;
      case 'wait':
        if (!posture(c, 'sit')) break;
        setAnim(c, 'wait');
        if (c.t > c.dur) { c.greeted = true; decide(c); }
        break;
      case 'loaf':
        if (!posture(c, 'loaf')) break;
        setAnim(c, 'loaf');
        if (c.t > c.dur) {
          if (Math.random() < 0.4 * c.look.lazy * (night() ? 2 : 1)) set(c, 'sleep', { dur: rand(60, 240) * c.look.lazy });
          else decide(c);
        }
        break;
      case 'sleep':
        if (!posture(c, 'curl')) break;
        setAnim(c, 'curl');
        if (now > c.zAt) { c.zAt = now + 2.8; zzz(c); }
        if (c.t > c.dur) set(c, 'wake');
        break;
      case 'wake':
        if (!posture(c, 'stand')) break;
        set(c, 'stretch'); setAnim(c, 'stretch');
        break;
      case 'stretch':
        if (!posture(c, 'stand')) break;
        setAnim(c, 'stretch');
        if (animDone(c)) set(c, 'idle', { dur: rand(2, 5) });
        break;
      case 'petted':
        if (c.post === 'curl' || c.post === 'loaf') setAnim(c, c.post === 'curl' ? 'curl' : 'loaf');
        else { if (!posture(c, 'sit')) break; setAnim(c, 'petted'); }
        if (now - c.lastPet > 2.5) {
          if (!c.greeted) { c.greeted = true; for (let j = 0; j < 3; j++) heart(c, 1); }
          if (c.post === 'curl') set(c, 'sleep', { dur: rand(40, 120) });
          else if (c.post === 'loaf') set(c, 'loaf', { dur: rand(20, 60) });
          else set(c, 'sit', { dur: rand(3, 8) });
        }
        break;
      case 'boopReady': {
        if (!posture(c, 'stand')) break;
        setAnim(c, 'stand');
        const p = other(c);
        if (p.state === 'boopReady') { const d = rand(3, 6); set(c, 'boop', { dur: d }); set(p, 'boop', { dur: d }); heart(c, 0.8); }
        else if (c.t > c.dur || !(p.state === 'boopReady' || p.state === 'petted' || (p.state === 'walk' && p.then === 'boopReady'))) set(c, 'idle', { dur: rand(2, 5) });
        break;
      }
      case 'boop':
        if (!posture(c, 'stand')) break;
        setAnim(c, 'boop');
        if (Math.random() < dt / 1.6) heart(c, 0.7);
        if (c.t > c.dur || other(c).state !== 'boop') set(c, 'sit', { dur: rand(3, 8) });
        break;

      // --- игра ---
      case 'notice':
        if (!alive(c.ball)) { bored(c); break; }
        c.dir = Math.sign(c.ball.x - c.x) || c.dir;
        if (c.t > c.dur) set(c, c.ball.held ? 'watch' : 'chase', { dur: 8 });
        break;
      case 'watch': {
        const b = c.ball;
        if (!alive(b)) { bored(c); break; }
        if (!posture(c, 'sit')) break;
        setAnim(c, 'sit');
        c.dir = Math.sign(b.x - c.x) || c.dir;
        if (!b.held && !b.pinnedBy && c.fun > 0 && c.t > 0.4 && (Math.hypot(b.vx, b.vy) > 40 * k || c.t > c.dur)) set(c, 'chase');
        else if (c.t > c.dur) bored(c);
        break;
      }
      case 'chase': {
        const b = c.ball;
        if (!alive(b)) { bored(c); break; }
        if (b.held) { set(c, 'watch', { dur: 10 }); break; }
        if (!posture(c, 'stand')) break;
        const dx = b.x - c.x, side = Math.sign(dx) || c.dir;
        if (b.pinnedBy && b.pinnedBy !== c && Math.abs(dx) < 75 * k) { set(c, 'watch', { dur: rand(2, 6) }); break; }
        // встать на расстоянии лапы от клубка, со стороны, где кот уже находится
        let want = b.x - side * REACH * k;
        if (want < 15 * k || want > W - 15 * k) want = b.x + side * REACH * k;
        const gap = want - c.x, high = !b.ground && b.y < groundY - 45 * k;
        if (Math.abs(gap) > 5 * k) {
          const speed = Math.hypot(b.vx, b.vy), far = Math.abs(gap);
          const sp = far > 110 * k || speed > 90 * k ? RUN : far > 35 * k ? WALK : STALK;
          setAnim(c, sp === RUN ? 'run' : sp === WALK ? 'walk' : 'stalk');
          c.dir = Math.sign(gap);
          c.x += c.dir * Math.min(far, sp * k * dt);
        } else if (high) {
          c.dir = side; setAnim(c, 'stand');
        } else {
          c.dir = side;
          if (Math.abs(b.vx) < 30 * k) set(c, 'crouch', { dur: rand(0.5, 1.6) });
          else startPounce(c);
        }
        if (c.t > 25) bored(c);
        break;
      }
      case 'crouch': {
        const b = c.ball;
        if (!alive(b)) { bored(c); break; }
        if (b.held) { set(c, 'watch', { dur: 10 }); break; }
        if (!posture(c, 'stand')) break;
        setAnim(c, 'crouch');
        const dx = b.x - c.x;
        if (Math.abs(dx) > 55 * k || Math.sign(dx) !== c.dir || (b.pinnedBy && b.pinnedBy !== c)) { set(c, 'chase'); break; }
        if (c.t > c.dur) startPounce(c);
        break;
      }
      case 'pounce': {
        const j = c.jump;
        j.t += dt;
        const u = Math.min(1, j.t / j.T);
        c.x = lerp(j.x0, j.x1, smooth(u));
        c.jumpY = Math.sin(Math.PI * clamp((u - 0.12) / 0.7, 0, 1)) * 15;
        if (u >= 1) {
          c.jumpY = 0; c.jump = null;
          const b = c.ball;
          if (c.pendingGreet != null) { set(c, 'walk', { target: c.pendingGreet, then: 'wait' }); c.pendingGreet = null; break; }
          if (alive(b) && !b.held && !b.pinnedBy && Math.abs(b.x - (c.x + c.dir * REACH * k)) < 18 * k && b.y > groundY - 30 * k) {
            b.vx *= 0.1; if (b.vy < 0) b.vy = 0;
            b.pinnedBy = c; c.plays++; stats.catches++;
            c.love = Math.min(100, c.love + 0.5);
            set(c, 'bat', { dur: rand(1.2, 3) }); c.lastStrike = -1;
          } else if (alive(b)) set(c, 'chase');
          else bored(c);
        }
        break;
      }
      case 'bat': {
        const b = c.ball;
        if (!alive(b)) { bored(c); break; }
        setAnim(c, 'bat');
        const pawX = c.x + c.dir * REACH * k, a = ANIMS.bat;
        const cycle = Math.floor(c.animT * a.fps / a.n);
        if (b.held) {
          if (Math.abs(b.x - pawX) > 45 * k || b.y < groundY - 70 * k || c.t > c.dur) set(c, 'watch', { dur: rand(3, 8) });
          break;
        }
        if (frameIndex(c) === a.strike && cycle !== c.lastStrike) {
          c.lastStrike = cycle;
          if (Math.abs(b.x - pawX) < 20 * k && b.y > groundY - 35 * k) { hitBall(c, b, c.t > c.dur); break; }
        }
        if (Math.abs(b.x - pawX) > 28 * k) {
          if (b.pinnedBy === c) b.pinnedBy = null;
          if (c.fun > 0) set(c, 'chase'); else bored(c);
        }
        break;
      }
    }
  }

  // ---------- клубки ----------
  function newBall(x, y) {
    if (balls.length >= MAX_BALLS) balls.shift();
    const b = { id: ballSeq++, x, y, vx: 0, vy: 0, rot: 0, held: false, ground: false, pinnedBy: null, trail: [] };
    b.color = b.id % Art.YARN.length;
    balls.push(b);
    return b;
  }
  function stepBall(b, dt) {
    const r = ballR(), floor = groundY - r;
    for (const p of b.trail) p.age += dt;
    while (b.trail.length && b.trail[0].age > 45) b.trail.shift();
    if (b.held) { b.vx = b.vy = 0; b.ground = false; return; }
    if (b.pinnedBy && (b.pinnedBy.state !== 'bat' || b.pinnedBy.ball !== b)) b.pinnedBy = null;
    if (b.pinnedBy) { b.vx = 0; }
    b.vy += GRAV * k * dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y >= floor) {
      b.y = floor;
      if (b.vy > 110 * k) { b.vy = -b.vy * 0.42; b.vx *= 0.85; b.ground = false; } else { b.vy = 0; b.ground = true; }
    } else b.ground = false;
    if (b.ground) { b.vx *= Math.exp(-1.3 * dt); if (Math.abs(b.vx) < 3 * k) b.vx = 0; }
    if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx) * 0.5; }
    if (b.x > W - r) { b.x = W - r; b.vx = -Math.abs(b.vx) * 0.5; }
    b.rot += b.vx / r * dt;
    // нитка разматывается по земле
    if (b.ground && Math.abs(b.vx) > 4 * k) {
      const l = b.trail[b.trail.length - 1];
      if (!l || Math.abs(l.x - b.x) > 5 * k) {
        b.trail.push({ x: b.x, y: groundY - 0.8 * k + rand(-0.6, 0.6) * k, age: 0 });
        if (b.trail.length > 90) b.trail.shift();
      }
    }
  }
  function throwBall(b, vx, vy) {
    const sp = Math.hypot(vx, vy), max = 1100 * k;
    if (sp > max) { vx *= max / sp; vy *= max / sp; }
    b.held = false; b.vx = vx; b.vy = vy; b.ground = false;
    stats.throws++;
    notice(b, null);
  }

  // ---------- действия пользователя ----------
  function pet(c, pat) {
    if (!visible(c)) return;
    c.lastPet = now; c.pets++;
    c.love = Math.min(100, c.love + (pat ? 2 : 1.2));
    if (Math.random() < (pat ? 1 : 0.4)) heart(c, pat ? 1 : 0.8);
    if (now > c.purrAt) { c.purrAt = now + 1.5; purr(c); }
    if (pat && c.post !== 'curl' && Math.random() < 0.45) meow(c);
    if (['idle', 'sit', 'wait', 'groom', 'walk', 'watch', 'boopReady', 'loaf', 'sleep', 'petted'].includes(c.state)) {
      if (c.state === 'watch' && c.ball && c.ball.pinnedBy === c) c.ball.pinnedBy = null;
      if (c.state === 'watch') c.ball = null;
      set(c, 'petted');
    }
  }

  // ---------- частицы ----------
  function headScreen(c, dy = 0) {
    const a = (c.frame || currentFrame(c)).anchors;
    return { x: c.x + c.dir * a.head.x * k, y: gy(c) + (a.head.y + dy) * k };
  }
  function heart(c, sz = 1) {
    if (!frames || !visible(c)) return;
    const p = headScreen(c, -14);
    particles.push({ type: 'heart', x: p.x + rand(-6, 6) * k, y: p.y, vx: rand(-8, 8) * k, vy: -26 * k, life: 2.2, age: 0, s: sz * rand(0.75, 1) });
  }
  function zzz(c) {
    const p = headScreen(c, -6);
    particles.push({ type: 'z', x: p.x + c.dir * 6 * k, y: p.y, vx: c.dir * 6 * k, vy: -15 * k, life: 2.6, age: 0, s: rand(0.8, 1.2) });
  }
  function purr(c) {
    const p = headScreen(c, -10);
    particles.push({ type: 'text', txt: 'мрр', x: p.x - c.dir * 14 * k, y: p.y, vx: -c.dir * 5 * k, vy: -14 * k, life: 1.8, age: 0, s: rand(0.9, 1.1) });
  }
  function meow(c) {
    if (particles.some(p => p.type === 'bubble' && p.cat === c)) return;
    particles.push({ type: 'bubble', cat: c, txt: Math.random() < 0.7 ? 'мяу!' : 'мр-мяу', x: 0, y: 0, vx: 0, vy: 0, life: 1.5, age: 0, s: 1 });
  }

  // ---------- геометрия для мыши ----------
  function hitCat(c, mx, my) {
    if (!visible(c) || !c.frame) return false;
    const fr = c.frame, lx = (mx - c.x) / (c.dir * k), ly = (my - gy(c)) / k;
    const px = Math.floor((lx + SPR.OX) * k / 2), py = Math.floor((ly + SPR.OY) * k / 2);
    if (px < 0 || py < 0 || px >= fr.mw || py >= fr.mh) return false;
    return fr.mask[py * fr.mw + px] > 60;
  }
  function basketPos() { return { x: W - 42 * k, y: groundY + 4 * k }; }
  function targetAt(x, y) {
    if (!ready) return null;
    for (let i = balls.length - 1; i >= 0; i--) { const b = balls[i]; if (!b.held && Math.hypot(x - b.x, y - b.y) < ballR() + 5 * k) return { kind: 'ball', b }; }
    if (showBasket) {
      const b = basketPos();
      if (x > b.x - 27 * k && x < b.x + 27 * k && y > b.y - 40 * k && y < b.y + 2 * k) return { kind: 'basket' };
    }
    const front = cats.slice().sort((a, b) => a.back - b.back);
    for (const c of front) if (hitCat(c, x, y)) return { kind: 'cat', c };
    return null;
  }
  function updateHover() {
    hoverT = targetAt(mouse.x, mouse.y);
    const interactive = !!(hoverT || drag || mouse.down);
    if (interactive === ignoring) { ignoring = !interactive; api.setIgnore(ignoring); }
    cv.style.cursor = drag ? 'grabbing' : mouse.cat ? 'grabbing' : !hoverT ? 'default' : 'grab';
  }
  const pos = e => [e.clientX * DPR, e.clientY * DPR];
  window.addEventListener('mousemove', e => {
    const [x, y] = pos(e), d = Math.hypot(x - mouse.x, y - mouse.y);
    mouse.x = x; mouse.y = y;
    if (drag) {
      drag.b.x = x; drag.b.y = Math.min(y, groundY - ballR());
      const t = performance.now();
      drag.hist.push({ x, y, t });
      while (drag.hist.length > 2 && t - drag.hist[0].t > 160) drag.hist.shift();
    } else if (mouse.down && mouse.cat) {
      mouse.stroke += d;
      if (mouse.stroke > 26 * DPR) { mouse.stroke = 0; pet(mouse.cat, false); }
    }
    updateHover();
  });
  window.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const [x, y] = pos(e), t = targetAt(x, y);
    mouse.x = x; mouse.y = y; mouse.down = true; mouse.stroke = 0; mouse.cat = null; mouse.downX = x; mouse.downY = y;
    if (t) {
      if (t.kind === 'basket' || t.kind === 'ball') {
        const b = t.kind === 'ball' ? t.b : newBall(x, y);
        if (t.kind === 'basket') b.trail = [];
        b.held = true; b.pinnedBy = null; b.vx = b.vy = 0;
        drag = { b, hist: [{ x, y, t: performance.now() }], t0: performance.now(), fromGround: t.kind === 'ball' };
      } else if (t.kind === 'cat') mouse.cat = t.c;
    }
    updateHover();
  });
  window.addEventListener('mouseup', e => {
    if (e.button !== 0) return;
    const [x, y] = pos(e);
    if (drag) {
      const b = drag.b, tn = performance.now(), h0 = drag.hist[0], dtm = Math.max(16, tn - h0.t) / 1000;
      const moved = Math.hypot(x - mouse.downX, y - mouse.downY);
      if (drag.fromGround && moved < 6 * DPR && tn - drag.t0 < 300) {
        // щелчок по клубку — щелбан в случайную сторону
        b.y = Math.min(b.y, groundY - ballR());
        throwBall(b, (Math.random() < 0.5 ? -1 : 1) * rand(120, 240) * k, -rand(120, 220) * k);
      } else throwBall(b, (x - h0.x) / dtm, (y - h0.y) / dtm);
      drag = null;
    } else if (mouse.cat && Math.hypot(x - mouse.downX, y - mouse.downY) < 6 * DPR) pet(mouse.cat, true);
    mouse.down = false; mouse.cat = null;
    updateHover();
  });
  window.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (targetAt(e.clientX * DPR, e.clientY * DPR) && api.showMenu) api.showMenu();
  });
  document.addEventListener('mouseleave', () => {
    if (!mouse.down && !drag) { mouse.x = mouse.y = -1; updateHover(); }
  });
  window.addEventListener('blur', () => {
    if (drag) { throwBall(drag.b, 0, 0); drag = null; }
    mouse.down = false; mouse.cat = null; updateHover();
  });

  // ---------- такт ----------
  function tick(dt) {
    now += dt;
    for (const c of cats) update(c, dt);
    for (const b of balls) stepBall(b, dt);
    if (drag) dangle(drag.b);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type !== 'bubble') p.x += Math.sin(p.age * 3) * 10 * DPR * dt;
      if (p.age > p.life) particles.splice(i, 1);
    }
    if (now > saveAt) { saveAt = now + 60; persist(); }
  }
  function persist() {
    const o = {};
    for (const c of cats) o[c.key] = { love: Math.round(c.love * 10) / 10, pets: c.pets, plays: c.plays };
    api.save({ cats: o });
  }

  // ---------- отрисовка ----------
  function eyeState(c) {
    if (c.blink > 0 && !['sleep'].includes(c.state)) return 0;
    if (c.trans && (c.anim === 'curlIn')) return 0;
    if (c.state === 'sleep' || (c.state === 'petted' && c.post === 'curl')) return 0;
    if (c.state === 'loaf' && c.t > 8) return 0;
    if (['petted', 'boop', 'groom'].includes(c.state) || (c.state === 'stretch' && frameIndex(c) > 1 && frameIndex(c) < 6)) return 1;
    return 2;
  }
  function lookTarget(c) {
    if (alive(c.ball)) return c.ball;
    if (drag) return drag.b;
    let best = null, bd = 220 * k;
    for (const b of balls) { const d = Math.abs(b.x - c.x); if ((Math.abs(b.vx) > 20 * k || !b.ground) && d < bd) { bd = d; best = b; } }
    if (best) return best;
    if (mouse.x >= 0 && Math.abs(mouse.x - c.x) < 110 * k) return mouse;
    return null;
  }
  function drawEyes(g, c, a, st) {
    const look = c.look, tg = lookTarget(c);
    let lx = 0.35, ly = 0;
    if (tg) {
      const ex = c.x + c.dir * a.eyeN.x * k, ey = gy(c) + a.eyeN.y * k;
      const dx = (tg.x - ex) * c.dir, dy = tg.y - ey, d = Math.hypot(dx, dy) || 1;
      lx = dx / d; ly = dy / d;
    }
    const excited = ['chase', 'crouch', 'pounce', 'bat', 'watch', 'notice'].includes(c.state);
    const dil = excited ? 1 : night() ? 0.7 : 0.25;
    for (const [p, rx, ry] of [[a.eyeN, 2.5, 2.2], [a.eyeF, 2.15, 2.05]]) {
      g.save();
      g.translate(p.x, p.y); g.rotate(a.eyeAng);
      if (st === 2) {
        g.fillStyle = look.iris;
        g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = Art.hexA(look.ink, 0.8); g.lineWidth = 0.55; g.stroke();
        g.fillStyle = '#1d1512';
        g.beginPath(); g.ellipse(lx * rx * 0.35, ly * ry * 0.3, lerp(0.5, rx * 0.72, dil), ry * 0.9, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath(); g.arc(rx * 0.25 + lx * 0.3, -ry * 0.4, 0.6, 0, Math.PI * 2); g.fill();
      } else {
        g.strokeStyle = look.ink; g.lineWidth = 0.75; g.lineCap = 'round';
        g.beginPath();
        if (st === 1) { g.moveTo(-rx, 0.4); g.quadraticCurveTo(0, -1.6, rx, 0.4); }
        else { g.moveTo(-rx, -0.2); g.quadraticCurveTo(0, 1.4, rx, -0.2); }
        g.stroke();
      }
      g.restore();
    }
  }
  function drawCat(g, c) {
    const fr = currentFrame(c), y = gy(c), yG = groundY - c.back * k;
    c.frame = fr;
    const lying = c.post === 'loaf' || c.post === 'curl' || c.anim === 'stretch';
    const sh = lying ? sprites.shadowWide : sprites.shadow, ss = 1 - Math.min(0.4, (c.jumpY || 0) / 30);
    g.drawImage(sh, c.x - sh.width * ss / 2, yG - sh.height * ss / 2 + k, sh.width * ss, sh.height * ss);
    g.save();
    g.translate(c.x, y); g.scale(c.dir, 1);
    g.drawImage(fr.c, -SPR.OX * k, -SPR.OY * k);
    g.scale(k, k);
    drawEyes(g, c, fr.anchors, eyeState(c));
    g.restore();
    if (c.state === 'wait' && !c.greeted) {
      const p = headScreen(c, -26), s = 1 + 0.12 * Math.sin(now * 4), w = sprites.heartO.width * s;
      g.drawImage(sprites.heartO, p.x - w / 2, p.y - w / 2, w, w);
    }
  }
  function drawThread(g, b) {
    const col = Art.YARN[b.color], r = ballR();
    g.save();
    g.strokeStyle = Art.hexA(col, 0.85); g.lineWidth = Math.max(1, 0.8 * k); g.lineCap = 'round'; g.lineJoin = 'round';
    if (b.trail.length) {
      g.beginPath(); g.moveTo(b.trail[0].x, b.trail[0].y);
      for (let i = 1; i < b.trail.length; i++) g.lineTo(b.trail[i].x, b.trail[i].y);
      g.lineTo(b.x, b.y + r * 0.6);
      g.stroke();
    }
    if (b.held) {
      // свисающий кончик нитки
      const sw = Math.sin(now * 3 + b.id) * 4 * k;
      g.beginPath(); g.moveTo(b.x, b.y + r * 0.8);
      g.quadraticCurveTo(b.x + sw, b.y + r + 9 * k, b.x + sw * 1.6, b.y + r + 18 * k);
      g.stroke();
    }
    g.restore();
  }
  function drawBall(g, b) {
    const sp = sprites.yarn[b.color], w = sp.width;
    g.save(); g.translate(b.x, b.y); g.rotate(b.rot);
    g.drawImage(sp, -w / 2, -w / 2);
    g.restore();
  }
  function drawLabel(g, c) {
    const a = c.frame.anchors;
    const x = c.x + c.dir * a.head.x * k * 0.6, y = Math.max(14 * DPR, gy(c) + (a.top - 14) * k);
    // привязанность (c.love) — скрытый параметр: при наведении только имя
    const txt = c.name;
    g.font = `${12 * DPR}px "Segoe UI", system-ui, sans-serif`;
    const w = g.measureText(txt).width + 14 * DPR, hh = 20 * DPR;
    const lx = clamp(x - w / 2, 4 * DPR, W - w - 4 * DPR);
    g.fillStyle = 'rgba(255,251,244,0.9)';
    g.beginPath(); g.roundRect(lx, y - hh / 2, w, hh, 8 * DPR); g.fill();
    g.fillStyle = '#6b4a3a'; g.textBaseline = 'middle';
    g.fillText(txt, lx + 7 * DPR, y + DPR * 0.5);
  }
  function drawBubble(g, p) {
    const c = p.cat;
    if (!visible(c) || !c.frame) return;
    const h = headScreen(c, -18), txt = p.txt;
    g.font = `italic ${12 * DPR}px "Segoe UI", system-ui, sans-serif`;
    const w = g.measureText(txt).width + 12 * DPR, hh = 19 * DPR;
    const bx = clamp(h.x + c.dir * 16 * k - w / 2, 4 * DPR, W - w - 4 * DPR), by = Math.max(4 * DPR, h.y - hh - 6 * k);
    g.fillStyle = 'rgba(255,251,244,0.93)'; g.strokeStyle = 'rgba(120,90,70,0.45)'; g.lineWidth = DPR;
    g.beginPath(); g.roundRect(bx, by, w, hh, 9 * DPR); g.fill(); g.stroke();
    g.fillStyle = '#6b4a3a'; g.textBaseline = 'middle';
    g.fillText(txt, bx + 6 * DPR, by + hh / 2 + DPR * 0.5);
  }
  function drawScene(g) {
    for (const b of balls) drawThread(g, b);
    const order = cats.filter(visible).sort((a, b) => b.back - a.back);
    for (const c of order) drawCat(g, c);
    if (showBasket) {
      const b = basketPos(), bs = sprites.basket, hov = hoverT && hoverT.kind === 'basket';
      g.globalAlpha = hov || drag ? 1 : 0.65;
      g.drawImage(bs, b.x - bs.width / 2, b.y - 40 * k);
      g.globalAlpha = 1;
    }
    for (const b of balls) drawBall(g, b);
    for (const p of particles) {
      g.globalAlpha = Math.min(1, (p.life - p.age) / 0.5);
      if (p.type === 'heart') {
        const w = sprites.heart.width * p.s; g.drawImage(sprites.heart, p.x - w / 2, p.y - w / 2, w, w);
      } else if (p.type === 'z') {
        g.fillStyle = 'rgba(96,98,140,0.75)';
        g.font = `italic ${Math.round(12 * k * p.s)}px Georgia, serif`;
        g.fillText('z', p.x, p.y);
      } else if (p.type === 'text') {
        g.fillStyle = 'rgba(150,95,80,0.8)';
        g.font = `italic ${Math.round(9 * k * p.s)}px Georgia, serif`;
        g.fillText(p.txt, p.x, p.y);
      } else if (p.type === 'bubble') drawBubble(g, p);
      g.globalAlpha = 1;
    }
    if (hoverT && hoverT.kind === 'cat' && hoverT.c.frame && !drag) drawLabel(g, hoverT.c);
  }
  function signature() {
    let s = `${particles.length}|${drag ? 1 : 0}|${hoverT ? hoverT.kind + (hoverT.c ? hoverT.c.i : '') : ''}|`;
    for (const c of cats) s += `${c.state}${c.anim}${frameIndex(c)}${Math.round(c.x)}${Math.round(c.jumpY)}${eyeState(c)}|`;
    for (const b of balls) s += `${Math.round(b.x)},${Math.round(b.y)},${b.trail.length}|`;
    if (cats.some(c => c.state === 'wait' && !c.greeted) || drag) s += Math.round(now * 8);
    if (mouse.x >= 0) s += `m${Math.round(mouse.x / 8)}`;
    return s;
  }

  let lastTs = 0;
  function loop() {
    const ts = performance.now(), dt = Math.min(0.1, (ts - lastTs) / 1000 || 0);
    lastTs = ts;
    let active = false, fast = false;
    if (ready) {
      try {
        tick(dt);
        active = cats.some(visible) || particles.length || balls.length || drag;
        fast = !!drag || cats.some(c => ['zoom', 'pounce', 'chase', 'bat'].includes(c.state)) || balls.some(b => !b.ground || b.vx);
        const sig = signature();
        if (sig !== lastSig) {
          ctx.clearRect(0, 0, W, H);
          drawScene(ctx);
          lastSig = sig;
        }
      } catch (err) { console.error(err); }
    }
    setTimeout(loop, !active ? 1000 : fast ? 16 : 42);
  }

  // ---------- команды из трея ----------
  api.onCmd(async m => {
    if (m.type === 'greet') greet();
    else if (m.type === 'yarn') {
      const b = newBall(W / 2 + rand(-250, 250) * k, 4 * k);
      throwBall(b, rand(-260, 260) * k, 0);
    } else if (m.type === 'clearYarn') { balls.length = 0; drag = null; }
    else if (m.type === 'basket') { showBasket = !!m.value; lastSig = ''; }
    else if (m.type === 'walkAway') for (const c of cats) if (visible(c)) { c.ball = null; set(c, 'leave', { target: c.x < W / 2 ? offL() : offR() }); }
    else if (m.type === 'scale') { SCALE = m.value; await rebuild(); }
    else if (m.type === 'save') persist();
  });
  async function rebuild() {
    if (building) return;
    ready = false;
    const oldW = W, oldG = groundY;
    measure();
    await prerender();
    for (const c of cats) { if (oldW) { c.x = c.x / oldW * W; c.target = c.target / oldW * W; } c.frame = null; }
    for (const b of balls) { b.x = b.x / oldW * W; b.y = groundY - (oldG - b.y); b.trail = []; }
    ready = true; lastSig = '';
  }
  let resizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      const oldW = W, oldDPR = DPR, oldG = groundY;
      if ((window.devicePixelRatio || 1) !== oldDPR) { rebuild(); return; }
      measure();
      for (const c of cats) { c.x = c.x / oldW * W; c.target = c.target / oldW * W; }
      for (const b of balls) { b.x = b.x / oldW * W; b.y = groundY - (oldG - b.y); b.trail = []; }
      lastSig = '';
    }, 200);
  });

  // ---------- старт ----------
  async function start() {
    const store = await api.getStore();
    SCALE = store.scale || 1;
    showBasket = store.basket !== false;
    measure();
    await prerender();
    const saved = store.cats || {};
    cats.push(makeCat('ginger', 0, saved.ginger), makeCat('smoky', 1, saved.smoky));
    ready = true;
    if (SELFTEST) { selftest().catch(e => api.selftestDone({ error: String(e && e.stack || e) })); return; }
    setTimeout(greet, 1200);
    lastTs = performance.now();
    loop();
    window.addEventListener('beforeunload', persist);
  }

  // ---------- самопроверка (CI): лист кадров, игра с клубком, прогон симуляции, сцены ----------
  async function selftest() {
    const out = { log: [], scenes: [] };
    const paper = g => { g.fillStyle = '#fbf6ec'; g.fillRect(0, 0, g.canvas.width, g.canvas.height); };
    // 1. лист кадров
    const names = Object.keys(ANIMS), cols = Math.max(...names.map(n => ANIMS[n].n));
    const cw = Math.ceil(SPR.W * k), ch = Math.ceil(SPR.H * k);
    const sheet = Art.mk(cols * cw, names.length * 2 * ch), sc = sheet.getContext('2d');
    paper(sc);
    let row = 0;
    const fake = key => ({ look: Art.LOOKS[key], x: 0, dir: 1, back: 0, jumpY: 0, state: 'idle', ball: null });
    for (const key of Object.keys(Art.LOOKS)) for (const n of names) {
      frames[key][n].forEach((fr, i) => {
        sc.drawImage(fr.c, i * cw, row * ch);
        sc.save(); sc.translate(i * cw + SPR.OX * k, row * ch + SPR.OY * k); sc.scale(k, k);
        drawEyes(sc, fake(key), fr.anchors, ['curl', 'curlIn'].includes(n) ? 0 : ['petted', 'groom', 'boop'].includes(n) ? 1 : 2); sc.restore();
      });
      sc.fillStyle = '#555'; sc.font = `${11 * k}px sans-serif`; sc.fillText(`${key} ${n}`, 4, row * ch + 13 * k);
      sc.strokeStyle = 'rgba(0,0,0,0.08)'; sc.beginPath(); sc.moveTo(0, row * ch + SPR.OY * k); sc.lineTo(sheet.width, row * ch + SPR.OY * k); sc.stroke();
      row++;
    }
    out.sheet = sheet.toDataURL('image/png');

    // 2. крупный план
    const s2 = 3, big = Art.mk(SPR.W * s2 * 3, SPR.H * s2), bc = big.getContext('2d');
    paper(bc);
    [['ginger', 'stand', 0], ['smoky', 'sit', 0], ['ginger', 'pounce', 2]].forEach(([key, n, i], j) => {
      const f = Art.renderFrame(ANIMS[n].pose(i), Art.LOOKS[key], s2);
      bc.drawImage(f.c, j * SPR.W * s2, 0);
      bc.save(); bc.translate(j * SPR.W * s2 + SPR.OX * s2, SPR.OY * s2); bc.scale(s2, s2); drawEyes(bc, fake(key), f.anchors, 2); bc.restore();
    });
    out.closeup = big.toDataURL('image/png');

    // 3. сцены
    const scene = label => {
      const c = Art.mk(W, H), g = c.getContext('2d'); paper(g);
      g.strokeStyle = '#d8ceb8'; g.beginPath(); g.moveTo(0, groundY); g.lineTo(W, groundY); g.stroke();
      drawScene(g);
      g.fillStyle = '#999'; g.font = `${11 * DPR}px sans-serif`; g.fillText(label, 6, 14);
      out.scenes.push(c.toDataURL('image/png'));
    };
    const [A, B] = cats;
    greet();
    for (let i = 0; i < 400; i++) tick(0.1);
    out.log.push(`after greet 40s: ${A.state}/${B.state} x=${Math.round(A.x)},${Math.round(B.x)}`);
    scene('greet');

    // игра: бросок клубка, ловим кадры прыжка и удара лапкой
    A.x = W * 0.3; B.x = W * 0.55; A.post = B.post = 'stand'; A.trans = B.trans = null;
    set(A, 'idle', { dur: 99 }); set(B, 'sit', { dur: 99 }); A.playCool = B.playCool = 0;
    A.greeted = B.greeted = true;
    const ball = newBall(W * 0.2, groundY - 60 * k);
    throwBall(ball, 380 * k, -260 * k);
    if (!A.ball) { A.ball = ball; A.fun = 4; set(A, 'chase'); }
    let gotPounce = false, gotBat = false, gotCrouch = false;
    for (let i = 0; i < 1200 && !(gotPounce && gotBat); i++) {
      tick(1 / 30);
      for (const c of cats) if (visible(c)) c.frame = currentFrame(c);
      if (!gotCrouch && cats.some(c => c.state === 'crouch' && c.t > 0.3)) { gotCrouch = true; scene('crouch'); }
      if (!gotPounce && cats.some(c => c.state === 'pounce' && c.jumpY > 10)) { gotPounce = true; scene('pounce'); }
      if (!gotBat && cats.some(c => c.state === 'bat' && frameIndex(c) === 2)) { gotBat = true; scene('bat'); }
    }
    out.log.push(`play: pounce=${gotPounce} bat=${gotBat} crouch=${gotCrouch} states ${A.state}/${B.state} stats ${JSON.stringify(stats)}`);
    if (!gotPounce || !gotBat) out.log.push('WARN: play scenario incomplete');

    // клубок в руке: свешивается над котом
    for (const c of cats) { c.ball = null; c.post = 'stand'; c.trans = null; c.jumpY = 0; set(c, 'sit', { dur: 99 }); }
    A.x = W * 0.35; B.x = W * 0.7;
    const hb = newBall(A.x + 45 * k, groundY - 40 * k); hb.held = true;
    drag = { b: hb, hist: [{ x: hb.x, y: hb.y, t: 0 }], t0: 0 };
    for (let i = 0; i < 40; i++) tick(0.05);
    out.log.push(`dangle: ${A.state}/${B.state}`);
    scene('dangle');
    throwBall(hb, -200 * k, -100 * k); drag = null;

    // спит клубком, умывается, клубок с ниткой лежит, подпись
    for (const c of cats) { c.ball = null; c.post = 'stand'; c.trans = null; }
    balls.length = 0;
    const rb = newBall(W * 0.15, groundY - ballR()); throwBall(rb, 300 * k, 0);
    for (let i = 0; i < 60; i++) stepBall(rb, 0.05);
    set(A, 'sleep', { dur: 999 }); set(B, 'groom', { dur: 999 });
    for (let i = 0; i < 40; i++) tick(0.1);
    hoverT = { kind: 'cat', c: B };
    scene('sleep+groom+thread');
    hoverT = null;
    // носиком к носику
    A.post = B.post = 'stand'; A.trans = B.trans = null;
    A.x = W * 0.4; B.x = W * 0.6; set(A, 'idle', { dur: 99 }); set(B, 'idle', { dur: 99 }); startBoop(A, B);
    for (let i = 0; i < 300 && A.state !== 'boop'; i++) tick(0.1);
    tick(0.1); meow(A);
    out.log.push(`boop: ${A.state}/${B.state} dist=${Math.round(B.x - A.x)}`);
    scene('boop');
    // бег + потягивание
    set(A, 'zoom', { target: offR() }); A.x = W * 0.3;
    B.post = 'stand'; set(B, 'stretch'); setAnim(B, 'stretch'); B.animT = 0.8;
    for (let i = 0; i < 3; i++) tick(0.02);
    scene('zoom+stretch');

    // 4. долгий прогон: 6 часов по 0.1 с, со случайными действиями пользователя
    const hist = {}, t0 = performance.now();
    balls.length = 0; particles.length = 0;
    for (const k0 of Object.keys(stats)) stats[k0] = 0;
    for (let i = 0; i < 216000; i++) {
      tick(0.1);
      for (const c of cats) {
        hist[c.state] = (hist[c.state] || 0) + 1;
        if (!Number.isFinite(c.x) || !Number.isFinite(c.jumpY)) throw new Error('NaN x ' + c.state);
      }
      for (const b of balls) if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) throw new Error('NaN ball');
      if (i % 50 === 0) for (const c of cats) if (visible(c)) c.frame = currentFrame(c);
      if (i % 300 === 0) { const c = cats[i % 2]; if (visible(c)) pet(c, Math.random() < 0.5); }
      if (i % 600 === 0) { const b = newBall(rand(0, W), groundY - rand(20, 80) * k); throwBall(b, rand(-500, 500) * k, -rand(0, 400) * k); }
      if (i % 9000 === 0) greet();
      if (i % 100 === 0) { ctx.clearRect(0, 0, W, H); drawScene(ctx); }
    }
    out.log.push(`sim 6h in ${Math.round(performance.now() - t0)} ms; states(ticks): ${JSON.stringify(hist)}`);
    out.log.push(`stats: ${JSON.stringify(stats)}; love: ${cats.map(c => c.name + '=' + c.love.toFixed(1)).join(', ')}; plays ${cats.map(c => c.plays).join('/')}`);
    // 5. время кадра
    const t1 = performance.now();
    for (let i = 0; i < 200; i++) { ctx.clearRect(0, 0, W, H); drawScene(ctx); }
    out.log.push(`draw: ${((performance.now() - t1) / 200).toFixed(2)} ms/frame at ${W}x${H}`);
    api.selftestDone(out);
  }

  start();
})();
