'use strict';
// Процедурные акварельные котики: скелет по позе (лапы через IK) -> слои заливки, края, зерно бумаги, тушь.
const Art = (() => {
  const TAU = Math.PI * 2;
  const V = (x, y) => ({ x, y });
  const add = (a, b, k = 1) => V(a.x + b.x * k, a.y + b.y * k);
  const sub = (a, b) => V(a.x - b.x, a.y - b.y);
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpV = (a, b, t) => V(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
  const len = a => Math.hypot(a.x, a.y);
  const dirA = a => V(Math.cos(a), -Math.sin(a)); // угол против часовой стрелки (на экране), y вниз
  const rot = (v, a) => V(v.x * Math.cos(a) + v.y * Math.sin(a), -v.x * Math.sin(a) + v.y * Math.cos(a));
  const P2 = a => V(a[0], a[1]);

  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  const LOOKS = {
    ginger: {
      name: 'Рыжик', base: '#e8a160', light: '#fde0b4', shade: '#b0662e', far: '#c98243', stripe: '#b25d24',
      ink: '#6b3a1f', nose: '#d9877c', inner: '#f2b2a6', iris: '#d4b13a',
      white: { chest: 0.55, muzzle: 0.55, paws: false }, tabby: true, play: 0.95, lazy: 0.8, seed: 5,
    },
    smoky: {
      name: 'Дымка', base: '#9096a2', light: '#dadde3', shade: '#5d6372', far: '#767c89', stripe: '#6d7380',
      ink: '#3b3f4b', nose: '#cf8e98', inner: '#e7b0b8', iris: '#86b34e',
      white: { chest: 1, muzzle: 0.95, paws: true }, tabby: false, play: 0.7, lazy: 1.3, seed: 9,
    },
  };

  // ---------- примитивы ----------
  function ell(cx, cy, rx, ry, r = 0, n = 26) {
    const pts = [], c = Math.cos(r), s = Math.sin(r);
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
      pts.push(V(cx + x * c - y * s, cy + x * s + y * c));
    }
    return pts;
  }
  function capsule(a, ra, b, rb, n = 9) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x), pts = [];
    for (let i = 0; i <= n; i++) { const t = ang - Math.PI / 2 + i / n * Math.PI; pts.push(V(b.x + Math.cos(t) * rb, b.y + Math.sin(t) * rb)); }
    for (let i = 0; i <= n; i++) { const t = ang + Math.PI / 2 + i / n * Math.PI; pts.push(V(a.x + Math.cos(t) * ra, a.y + Math.sin(t) * ra)); }
    return pts;
  }
  function wobble(pts, seed, amp) {
    const r = rng(seed), ph = [r() * TAU, r() * TAU, r() * TAU], n = pts.length;
    return pts.map((p, i) => {
      const q = pts[(i + 1) % n], o = pts[(i - 1 + n) % n];
      const nx = q.y - o.y, ny = -(q.x - o.x), l = Math.hypot(nx, ny) || 1, t = i / n * TAU;
      const w = amp * (Math.sin(3 * t + ph[0]) + 0.5 * Math.sin(7 * t + ph[1]) + 0.3 * Math.sin(13 * t + ph[2])) / 1.8;
      return V(p.x + nx / l * w, p.y + ny / l * w);
    });
  }
  function trace(ctx, pts) {
    const n = pts.length;
    ctx.moveTo((pts[n - 1].x + pts[0].x) / 2, (pts[n - 1].y + pts[0].y) / 2);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    ctx.closePath();
  }
  function fillEach(ctx, list) { for (const p of list) { ctx.beginPath(); trace(ctx, p); ctx.fill(); } }
  function line(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }

  // контур конечности по цепочке [точка, толщина спереди, сзади]
  function limb(chain) {
    const n = chain.length, fr = [], bk = [];
    for (let i = 0; i < n; i++) {
      const a = chain[Math.max(0, i - 1)][0], b = chain[Math.min(n - 1, i + 1)][0];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, px = dy / l, py = -dx / l;
      const [p, f, bb] = chain[i];
      fr.push(V(p.x + px * f, p.y + py * f));
      bk.push(V(p.x - px * bb, p.y - py * bb));
    }
    return fr.concat(bk.reverse());
  }
  // два звена от root к target; bend=+1 — сустав назад (локоть), -1 — вперёд (колено)
  function ik(root, target, l1, l2, bend) {
    let d = sub(target, root), L = len(d);
    if (L < 1e-3) { d = V(0, 1); L = 1; }
    const maxL = (l1 + l2) * 0.999, minL = Math.abs(l1 - l2) + 1;
    const Lc = Math.max(minL, Math.min(maxL, L)), u = V(d.x / L, d.y / L);
    const end = add(root, u, Lc);
    const a = (l1 * l1 + Lc * Lc - l2 * l2) / (2 * Lc), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const n = V(-u.y, u.x);
    return { joint: add(add(root, u, a), n, h * bend), end };
  }

  // ---------- скелет кошки: смотрит вправо, земля y=0 ----------
  // H — центр крупа, S — центр груди; лапы — цели для стоп; хвост — цепочка с поворотом и прижатием к земле.
  const RH = 9.5, RS = 9.5;
  function buildCat(P) {
    const H = P2(P.H), S = P2(P.S);
    const ax = sub(S, H), L = len(ax), u = V(ax.x / L, ax.y / L), n = V(-u.y, u.x);
    const ang = Math.atan2(u.y, u.x);
    const near = [], far = [], paws = { near: [], far: [] }, A = {};

    // корпус: капсула + живот + круп
    near.push(capsule(H, RH, S, RS));
    near.push(ell((H.x + S.x) / 2 + n.x * 1.8, (H.y + S.y) / 2 + n.y * 1.8, L / 2 + 4.5, (RH + RS) / 2, ang, 28));
    near.push(ell(H.x - u.x * 1.5, H.y - u.y * 1.5, RH + 1.2, RH + 0.6, ang, 22));

    // голова: шея от груди, череп/щёки/мордочка в повороте головы (вид 3/4)
    let Hc = add(S, dirA(P.neck), P.neckLen);
    if (Hc.y > -9.5) Hc = V(Hc.x, -9.5);
    const ht = P.headTilt || 0, hp = (x, y) => add(Hc, rot(V(x, y), ht));
    const hmap = pts => pts.map(p => hp(p.x, p.y));
    near.push(capsule(add(S, u, 2), 8, Hc, 7));
    const head = [hmap(ell(0, 0, 11, 9.6, 0, 24)), hmap(ell(1, 3.6, 12.2, 7, 0, 24)), hmap(ell(5.6, 4.6, 5, 3.7, 0, 16))];
    // уши: ближнее (сзади) и дальнее (спереди), e — прижатие
    const e = P.ears || 0;
    const ears = [[[-10.5, -2.5], [-2, -9.2], [-9.5, -17.5], [-5, 6.5]], [[0.5, -9.8], [9.5, -4.5], [6.8, -17.8], [4.5, 7]]].map(([b1, b2, tip, dt]) =>
      ({ b1: P2(b1), b2: P2(b2), t: V(tip[0] + dt[0] * e, tip[1] + dt[1] * e) }));
    for (const E of ears) {
      const out = add(lerpV(E.b1, E.t, 0.5), V(-(E.t.y - E.b1.y), E.t.x - E.b1.x), -0.06);
      head.push(hmap([E.b1, out, E.t, E.t, lerpV(E.t, E.b2, 0.5), E.b2, lerpV(E.b2, E.b1, 0.5)]));
    }
    near.push(...head);
    A.innerEars = ears.map(E => {
      const c = V((E.b1.x + E.b2.x + E.t.x) / 3, (E.b1.y + E.b2.y + E.t.y) / 3 + 0.8);
      return hmap([E.b1, E.t, E.t, E.b2].map(p => lerpV(c, p, 0.58)));
    });

    // лапы
    const metaV = m => V(-Math.sin(m), -Math.cos(m));
    const legs = {};
    for (const k of ['FL', 'FR', 'HL', 'HR']) {
      const farLeg = k[1] === 'R', dx = farLeg ? 1.8 : 0, dy = farLeg ? -0.8 : 0;
      const foot = P2(P.feet[k]);
      let poly, paw;
      if (k[0] === 'F') {
        const SJ = add(S, V(1 + dx, 3 + dy)), r = ik(SJ, add(foot, V(-0.6, -2.4)), 12, 11.5, 1);
        const pawC = add(r.end, V(0.9, 2.2));
        poly = limb([[add(SJ, V(0, -3)), 5.2, 5.6], [SJ, 5, 5.4], [r.joint, 3.5, 3.9], [lerpV(r.joint, r.end, 0.5), 2.9, 3.1], [r.end, 2.7, 2.8]]);
        paw = ell(pawC.x, pawC.y, 3.6, 2.4, 0, 14);
        legs[k] = { paw: pawC };
      } else {
        const HJ = add(H, V(-1 + dx, 2 + dy)), mv = metaV(P.meta[k] ?? 0.3);
        const r = ik(HJ, add(foot, mv, 8), 12.5, 11, -1);
        const hock = r.end, pawB = add(hock, mv, -8);
        poly = limb([[add(HJ, sub(HJ, r.joint), 0.25), 7.5, 8.5], [HJ, 7.5, 9], [lerpV(HJ, r.joint, 0.55), 6, 6.8], [r.joint, 4, 4.6],
          [lerpV(r.joint, hock, 0.5), 3, 3.3], [hock, 2.3, 2.9], [lerpV(hock, pawB, 0.6), 2.3, 2.4], [pawB, 2.4, 2.4]]);
        const pawC = add(pawB, V(1.1, 0));
        paw = ell(pawC.x, pawC.y, 4, 2.4, 0, 14);
        legs[k] = { paw: pawC, knee: r.joint, hock };
      }
      (farLeg ? far : near).push(poly, paw);
      (farLeg ? paws.far : paws.near).push(paw);
    }

    // хвост
    const tail = [];
    let tp = add(add(H, u, -RH * 0.95), n, -2.5), th = P.tail.a;
    const TN = 13, TL = P.tail.len || 34;
    tail.push(tp);
    for (let i = 1; i <= TN; i++) {
      const t = i / TN;
      th += P.tail.curl / TN + (P.tail.wave || 0) * Math.cos(t * Math.PI * 1.5 + (P.tail.ph || 0)) * 0.14 * t;
      tp = add(tp, dirA(th), TL / TN);
      if (tp.y > -2.1) tp = V(tp.x, -2.1);
      tail.push(tp);
    }
    const tailPoly = limb(tail.map((p, i) => { const w = lerp(3.7, 2.5, i / TN); return [p, w, w]; }));
    const tip = tail[TN];
    const tailParts = [tailPoly, ell(tip.x, tip.y, 2.6, 2.6, 0, 12)];

    // точки для глаз, сердечек, игр
    A.head = Hc;
    A.eyeN = hp(-1.4, -0.6); A.eyeF = hp(6.4, -1.0); A.eyeAng = -ht;
    A.mouth = hp(6.3, 5.2);
    A.paw = legs.FL.paw;
    A.top = Math.min(...head.flat().map(p => p.y));
    A.body = lerpV(H, S, 0.5);
    return { H, S, u, n, ang, hp, near, far, paws, tail, tailParts, legs, anchors: A };
  }

  // ---------- позы ----------
  const STAND = {
    H: [-17, -29.5], S: [15, -31],
    feet: { FL: [18, -2.4], FR: [14.5, -2.4], HL: [-16, -2.4], HR: [-20, -2.4] }, meta: { HL: 0.3, HR: 0.3 },
    neck: 0.8, neckLen: 13, headTilt: 0, ears: 0,
    tail: { a: 3.6, curl: -1.5, wave: 0, ph: 0, len: 34 }, tailFront: 0,
  };
  const SIT = {
    H: [-10, -10], S: [5, -31],
    feet: { FL: [10, -2.4], FR: [6.5, -2.4], HL: [0, -2.4], HR: [-3, -2.4] }, meta: { HL: 1.45, HR: 1.45 },
    neck: 1.25, neckLen: 11.5, headTilt: 0.05, ears: 0,
    tail: { a: 4.5, curl: 2.1, wave: 0, ph: 0, len: 34 }, tailFront: 1,
  };
  const LOAF = {
    H: [-16, -10.5], S: [12, -11],
    feet: { FL: [16, -2.4], FR: [13, -2.4], HL: [-6, -2.4], HR: [-9, -2.4] }, meta: { HL: 1.45, HR: 1.45 },
    neck: 1.0, neckLen: 11, headTilt: 0, ears: 0.1,
    tail: { a: 3.8, curl: 2.4, wave: 0, ph: 0, len: 34 }, tailFront: 1,
  };
  const CURL = {
    H: [-14, -9.5], S: [9, -10],
    feet: { FL: [15, -2.4], FR: [12, -2.4], HL: [-5, -2.4], HR: [-8, -2.4] }, meta: { HL: 1.45, HR: 1.45 },
    neck: -0.15, neckLen: 12, headTilt: -0.3, ears: 0.3,
    tail: { a: 3.9, curl: 3.5, wave: 0, ph: 0, len: 36 }, tailFront: 1,
  };
  const CROUCH = {
    H: [-16, -17], S: [13, -16],
    feet: { FL: [22, -2.4], FR: [18.5, -2.4], HL: [-15, -2.4], HR: [-18.5, -2.4] }, meta: { HL: 1.0, HR: 1.0 },
    neck: 0.25, neckLen: 11, headTilt: 0.1, ears: 0.25,
    tail: { a: 3.15, curl: 0.2, wave: 0, ph: 0, len: 34 }, tailFront: 0,
  };
  const STRETCH = {
    H: [-16, -32], S: [19, -16],
    feet: { FL: [36, -2.4], FR: [32.5, -2.4], HL: [-19, -2.4], HR: [-23, -2.4] }, meta: { HL: 0.2, HR: 0.2 },
    neck: 0.25, neckLen: 12, headTilt: 0.25, ears: 0.3,
    tail: { a: 1.9, curl: -0.7, wave: 0, ph: 0, len: 34 }, tailFront: 0,
  };
  const BAT = {
    H: [-13, -16], S: [12, -24],
    feet: { FL: [18, -2.4], FR: [16, -2.4], HL: [-8, -2.4], HR: [-11, -2.4] }, meta: { HL: 1.15, HR: 1.15 },
    neck: 0.5, neckLen: 11, headTilt: 0.05, ears: 0.35,
    tail: { a: 3.3, curl: 0.4, wave: 0, ph: 0, len: 34 }, tailFront: 0,
  };

  const smooth = t => t * t * (3 - 2 * t);
  // смешивание поз (числа, массивы и вложенные объекты)
  function mix(a, b, t) {
    if (typeof a === 'number') return lerp(a, b ?? a, t);
    if (Array.isArray(a)) return a.map((v, i) => mix(v, b[i], t));
    const o = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) o[k] = k in a ? (k in b ? mix(a[k], b[k], t) : a[k]) : b[k];
    return o;
  }
  const clone = p => JSON.parse(JSON.stringify(p));
  function edit(p, f) { const q = clone(p); f(q); return q; }

  // походка: стопы в опоре едут назад, в переносе — вперёд с подъёмом
  function gait(base, ph, offs, stance, A, lift, metaLift = 0.6) {
    const q = clone(base);
    for (const k in offs) {
      const p = ((ph + offs[k]) % 1 + 1) % 1, f = q.feet[k];
      if (p < stance) { const s = p / stance; f[0] += A * (1 - 2 * s); }
      else {
        const s = (p - stance) / (1 - stance);
        f[0] += A * (-1 + 2 * smooth(s)); f[1] -= lift * Math.sin(Math.PI * s);
        if (k[0] === 'H') q.meta[k] += metaLift * Math.sin(Math.PI * s);
      }
    }
    return q;
  }
  function walkPose(i, n, base, A, lift, bob) {
    const ph = i / n, q = gait(base, ph, { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, 0.6, A, lift);
    q.H[1] += bob * Math.sin(ph * TAU * 2); q.S[1] += bob * Math.sin(ph * TAU * 2 + 0.6);
    q.tail.wave = 0.6 * Math.sin(ph * TAU);
    return q;
  }
  const WALKB = edit(STAND, q => { q.tail = { a: 2.35, curl: -1.0, wave: 0, ph: 0, len: 34 }; });
  const STALKB = edit(STAND, q => {
    q.H = [-17, -22]; q.S = [14, -21]; q.neck = 0.3; q.neckLen = 12; q.headTilt = 0.1; q.ears = 0.2;
    q.feet.FL[0] = 20; q.feet.FR[0] = 16.5; q.feet.HL[0] = -16; q.feet.HR[0] = -19.5; q.meta = { HL: 0.7, HR: 0.7 };
    q.tail = { a: 3.25, curl: -0.2, wave: 0, ph: 0, len: 34 };
  });
  const RUNB = edit(STAND, q => { q.neck = 0.55; q.ears = 0.35; q.tail = { a: 3.0, curl: 0.35, wave: 0, ph: 0, len: 34 }; });
  function runPose(i, n) {
    const ph = i / n, q = gait(RUNB, ph, { HL: 0, HR: 0.07, FL: 0.5, FR: 0.57 }, 0.4, 11, 6, 0.9);
    const ext = Math.sin(ph * TAU);
    q.H[0] -= 4 * ext; q.S[0] += 4 * ext; q.H[1] += 1.2 * Math.cos(ph * TAU); q.S[1] -= 1.2 * Math.cos(ph * TAU);
    q.tail.wave = 0.4 * Math.sin(ph * TAU);
    return q;
  }
  const POUNCE = [
    edit(CROUCH, q => { q.H = [-16, -15]; q.ears = 0.45; }),
    edit(CROUCH, q => { q.H = [-20, -22]; q.S = [17, -30]; q.feet = { FL: [30, -24], FR: [28, -21], HL: [-30, -3], HR: [-33, -3] }; q.meta = { HL: 0.1, HR: 0.1 }; q.neck = 0.55; q.ears = 0.45; }),
    edit(CROUCH, q => { q.H = [-22, -27]; q.S = [20, -29]; q.feet = { FL: [40, -24], FR: [37, -21], HL: [-42, -16], HR: [-44, -13] }; q.meta = { HL: -0.6, HR: -0.6 }; q.neck = 0.45; q.ears = 0.5; q.tail = { a: 3.0, curl: 0.2, wave: 0, ph: 0, len: 34 }; }),
    edit(CROUCH, q => { q.H = [-20, -26]; q.S = [19, -24]; q.feet = { FL: [36, -8], FR: [33, -6], HL: [-38, -18], HR: [-40, -15] }; q.meta = { HL: -0.3, HR: -0.3 }; q.neck = 0.35; q.ears = 0.45; q.tail = { a: 3.0, curl: 0.5, wave: 0, ph: 0, len: 34 }; }),
    edit(CROUCH, q => { q.H = [-16, -21]; q.S = [16, -16]; q.feet = { FL: [30, -2.4], FR: [27, -2.4], HL: [-14, -8], HR: [-17, -6] }; q.meta = { HL: 0.9, HR: 0.9 }; q.ears = 0.35; }),
    edit(CROUCH, q => { q.feet.FL = [27, -2.4]; q.feet.FR = [24, -2.4]; q.ears = 0.3; }),
  ];
  const BAT_PAW = [[18, -2.4], [22, -14], [27, -17], [33, -8], [31, -2.4], [24, -5]];

  const ANIMS = {
    stand: { n: 8, fps: 3, pose: i => edit(STAND, q => { q.tail.wave = 0.5 * Math.sin(i / 8 * TAU); q.tail.ph = i / 8 * TAU; }) },
    walk: { n: 8, fps: 10, pose: i => walkPose(i, 8, WALKB, 7, 3.5, 0.5) },
    stalk: { n: 8, fps: 6, pose: i => walkPose(i, 8, STALKB, 5, 2.4, 0.3) },
    run: { n: 6, fps: 14, pose: i => runPose(i, 6) },
    crouch: { n: 4, fps: 8, pose: i => edit(CROUCH, q => { q.H[0] += 1.3 * Math.sin(i / 4 * TAU); q.H[1] += 0.5 * Math.cos(i / 4 * TAU); q.tail.wave = 0.9 * Math.sin(i / 4 * TAU); q.tail.ph = 2; }) },
    pounce: { n: 6, fps: 11, once: true, pose: i => POUNCE[i] },
    bat: { n: 6, fps: 9, strike: 3, pose: i => edit(BAT, q => { q.feet.FL = BAT_PAW[i].slice(); q.headTilt = 0.05 + 0.08 * Math.sin(i / 6 * TAU); q.tail.wave = 0.6 * Math.sin(i / 6 * TAU); }) },
    sit: { n: 6, fps: 2, pose: i => edit(SIT, q => { q.tail.curl += 0.25 * Math.sin(i / 6 * TAU); }) },
    sitDown: { n: 5, fps: 9, once: true, pose: i => mix(STAND, SIT, smooth(i / 4)) },
    wait: { n: 6, fps: 3, pose: i => edit(SIT, q => { q.headTilt = 0.15; q.tail.curl += 0.4 * Math.sin(i / 6 * TAU); q.ears = -0.1; }) },
    petted: { n: 4, fps: 2, pose: i => edit(SIT, q => { q.headTilt = 0.3 + 0.05 * Math.sin(i / 4 * TAU); q.neck = 1.15; q.ears = 0.2; q.tail.curl += 0.3 * Math.sin(i / 4 * TAU); }) },
    groom: {
      n: 6, fps: 4, pose: i => edit(SIT, q => {
        const w = Math.sin(i / 6 * TAU);
        q.neck = 0.5; q.neckLen = 10; q.headTilt = -0.3 + 0.12 * w; q.feet.FL = [17, -22 + 1.2 * w]; q.ears = 0.1;
      }),
    },
    stretch: {
      n: 8, fps: 4, once: true, pose: i => {
        const t = i / 7, k = t < 0.3 ? smooth(t / 0.3) : t < 0.7 ? 1 : 1 - smooth((t - 0.7) / 0.3);
        return mix(STAND, STRETCH, k);
      },
    },
    loaf: { n: 4, fps: 1.2, pose: i => edit(LOAF, q => { q.H[1] -= 0.4 * Math.sin(i / 4 * TAU); q.S[1] -= 0.3 * Math.sin(i / 4 * TAU); }) },
    lieDown: { n: 5, fps: 7, once: true, pose: i => mix(STAND, LOAF, smooth(i / 4)) },
    curl: { n: 4, fps: 1, pose: i => edit(CURL, q => { q.H[1] -= 0.5 * Math.sin(i / 4 * TAU); q.S[1] -= 0.35 * Math.sin(i / 4 * TAU); }) },
    curlIn: { n: 4, fps: 5, once: true, pose: i => mix(LOAF, CURL, smooth(i / 3)) },
    boop: { n: 4, fps: 3, pose: i => edit(STAND, q => { q.neck = 0.45; q.neckLen = 15 + 0.8 * Math.sin(i / 4 * TAU); q.headTilt = 0.1; q.tail = { a: 1.9, curl: -0.9, wave: 0.4 * Math.sin(i / 4 * TAU), ph: 0, len: 34 }; }) },
  };

  // ---------- рендер ----------
  const SPR = { W: 150, H: 116, OX: 72, OY: 104 };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
  let grainCanvas = null;
  function grain() {
    if (grainCanvas) return grainCanvas;
    const c = mk(128, 128), g = c.getContext('2d'), im = g.createImageData(128, 128), r = rng(777);
    for (let i = 0; i < im.data.length; i += 4) {
      const v = r();
      im.data[i] = im.data[i + 1] = im.data[i + 2] = v < 0.5 ? 40 : 255;
      im.data[i + 3] = Math.floor(Math.abs(v - 0.5) * 2 * 70 * r());
    }
    g.putImageData(im, 0, 0);
    for (let k = 0; k < 40; k++) {
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)';
      g.beginPath(); g.arc(r() * 128, r() * 128, 3 + r() * 9, 0, TAU); g.fill();
    }
    grainCanvas = c;
    return c;
  }
  // края темнее (пигмент стекает к краю) + зерно бумаги; работает по альфе холста
  function washify(cv, shade, s, edgeA = 0.55, grainA = 0.5) {
    const W = cv.width, H = cv.height, ctx = cv.getContext('2d');
    const edge = mk(W, H), ec = edge.getContext('2d');
    ec.drawImage(cv, 0, 0);
    ec.globalCompositeOperation = 'destination-out';
    ec.filter = `blur(${2.2 * s}px)`;
    ec.drawImage(cv, 0, 0);
    ec.filter = 'none';
    ec.globalCompositeOperation = 'source-in';
    ec.fillStyle = shade; ec.fillRect(0, 0, W, H);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = edgeA; ctx.drawImage(edge, 0, 0);
    ctx.globalAlpha = grainA;
    ctx.fillStyle = ctx.createPattern(grain(), 'repeat');
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  function inkContour(o, parts, ink, s, alpha, W, H, setT) {
    const c = mk(W, H), ic = c.getContext('2d');
    setT(ic);
    ic.strokeStyle = ink; ic.lineWidth = 1.7; ic.lineJoin = 'round';
    for (const p of parts) { ic.beginPath(); trace(ic, p); ic.stroke(); }
    ic.globalCompositeOperation = 'destination-out';
    ic.fillStyle = '#000'; fillEach(ic, parts);
    o.save(); o.setTransform(1, 0, 0, 1, 0, 0); o.globalAlpha = alpha; o.drawImage(c, 0, 0); o.restore();
  }
  function stripe(c, a, b, w, color, alpha) {
    c.strokeStyle = hexA(color, alpha); c.lineWidth = w; c.lineCap = 'round';
    line(c, a, b);
  }

  function renderFrame(P, look, s) {
    const g = buildCat(P), A = g.anchors, hp = g.hp;
    const W = Math.ceil(SPR.W * s), H = Math.ceil(SPR.H * s);
    const setT = c => c.setTransform(s, 0, 0, s, SPR.OX * s, SPR.OY * s);
    const out = mk(W, H), o = out.getContext('2d');
    const r = rng(look.seed * 13);
    const whitePaws = (c, list) => {
      if (!look.white.paws) return;
      c.filter = `blur(${0.7 * s}px)`; c.fillStyle = 'rgba(255,252,246,0.92)';
      for (const p of list) { c.beginPath(); trace(c, p.map(q => V(q.x, q.y - 0.6))); c.fill(); }
      c.filter = 'none';
    };
    const layer = (parts, color, deco, edgeA, inkA) => {
      const cv = mk(W, H), c = cv.getContext('2d');
      setT(c);
      c.fillStyle = color; fillEach(c, parts);
      c.globalCompositeOperation = 'source-atop';
      if (deco) deco(c);
      c.globalCompositeOperation = 'source-over';
      washify(cv, look.shade, s, edgeA, 0.45);
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.drawImage(cv, 0, 0);
      inkContour(o, parts, look.ink, s, inkA, W, H, setT);
    };
    const tailLayer = () => layer(g.tailParts, look.base, c => {
      const gr = c.createLinearGradient(0, -40, 0, 0);
      gr.addColorStop(0, hexA(look.light, 0.35)); gr.addColorStop(1, hexA(look.shade, 0.25));
      c.fillStyle = gr; c.fillRect(-SPR.OX, -SPR.OY, SPR.W, SPR.H);
      if (look.tabby) {
        c.filter = `blur(${0.5 * s}px)`;
        for (let i = 3; i < g.tail.length - 1; i += 2) {
          const a = g.tail[i - 1], b = g.tail[i + 1], d = sub(b, a), l = len(d) || 1, nn = V(-d.y / l * 4.5, d.x / l * 4.5);
          stripe(c, add(g.tail[i], nn), add(g.tail[i], nn, -1), 1.8, look.stripe, 0.6);
        }
        c.filter = 'none';
      }
    }, 0.5, 0.5);

    if (!P.tailFront) tailLayer();
    // дальние лапы
    layer(g.far, look.far, c => {
      if (look.tabby) {
        c.filter = `blur(${0.5 * s}px)`;
        for (const k of ['FR', 'HR']) {
          const p = g.legs[k].paw;
          for (let j = 1; j <= 2; j++) stripe(c, V(p.x - 4, p.y - 4 - j * 4.5), V(p.x + 4, p.y - 5 - j * 4.5), 1.5, look.stripe, 0.5);
        }
        c.filter = 'none';
      }
      whitePaws(c, g.paws.far);
    }, 0.5, 0.35);

    // основной силуэт
    layer(g.near, look.base, c => {
      const gr = c.createLinearGradient(0, A.top, 0, 0);
      gr.addColorStop(0, hexA(look.light, 0.55)); gr.addColorStop(0.45, hexA(look.light, 0.1));
      gr.addColorStop(0.8, hexA(look.shade, 0.15)); gr.addColorStop(1, hexA(look.shade, 0.45));
      c.fillStyle = gr; c.fillRect(-SPR.OX, -SPR.OY, SPR.W, SPR.H);
      // акварельные разводы
      c.filter = `blur(${3 * s}px)`;
      for (let k = 0; k < 8; k++) {
        const x = A.body.x + (r() - 0.5) * 50, y = A.body.y + (r() - 0.5) * 20;
        c.fillStyle = r() < 0.5 ? hexA(look.light, 0.28) : hexA(look.shade, 0.18);
        c.beginPath(); c.arc(x, y, 4 + r() * 7, 0, TAU); c.fill();
      }
      c.filter = 'none';
      const { H: Hh, S: Ss, u, n } = g;
      if (look.tabby) {
        // полоски поперёк спины, на бедре, лапах, «М» на лбу и щеках
        c.filter = `blur(${0.55 * s}px)`;
        for (let i = 0; i < 7; i++) {
          const t = 0.02 + i * 0.15, p = add(lerpV(Hh, Ss, t), n, -RH - 1.5), q = add(add(p, n, 9 + (i % 2) * 2.5), u, -2.5);
          stripe(c, p, q, 2.3, look.stripe, 0.55);
        }
        const kn = g.legs.HL.knee, hk = g.legs.HL.hock;
        for (let j = 0; j < 3; j++) { const p = lerpV(kn, Hh, 0.15 + j * 0.25); stripe(c, add(p, V(-4, -2)), add(p, V(4, 2)), 1.7, look.stripe, 0.45); }
        const kh = lerpV(kn, hk, 0.5);
        stripe(c, add(kh, V(-3, -3)), add(kh, V(3, 3)), 1.5, look.stripe, 0.45);
        const fp = g.legs.FL.paw;
        for (let j = 1; j <= 2; j++) stripe(c, V(fp.x - 4, fp.y - 5 - j * 4.5), V(fp.x + 4, fp.y - 6 - j * 4.5), 1.5, look.stripe, 0.45);
        for (const [a, b] of [[[-1, -9], [-0.6, -4.8]], [[2.6, -9.4], [2.8, -5.2]], [[-4.2, -8.3], [-3.4, -4.9]], [[5.8, -8.5], [5.4, -5.4]]]) stripe(c, hp(...a), hp(...b), 1.3, look.stripe, 0.55);
        for (const [a, b] of [[[-6, 1.6], [-10.5, 0.6]], [[-5.6, 4], [-10.5, 4.6]]]) stripe(c, hp(...a), hp(...b), 1.2, look.stripe, 0.5);
        c.filter = 'none';
      }
      // белое: грудка, мордочка, лапки
      c.filter = `blur(${1.6 * s}px)`;
      c.fillStyle = `rgba(255,252,246,${0.9 * look.white.chest})`;
      const ch = add(add(Ss, n, 5.5), u, 4.5);
      c.beginPath(); c.ellipse(ch.x, ch.y, 5.5, 8.5, g.ang, 0, TAU); c.fill();
      c.filter = `blur(${0.9 * s}px)`;
      c.fillStyle = `rgba(255,252,246,${0.92 * look.white.muzzle})`;
      const mz = hp(5.6, 5), mz2 = hp(2.5, 6.4), ha = -(P.headTilt || 0);
      c.beginPath(); c.ellipse(mz.x, mz.y, 5.2, 3.6, ha, 0, TAU); c.fill();
      c.beginPath(); c.ellipse(mz2.x, mz2.y, 5.4, 3, ha, 0, TAU); c.fill();
      c.filter = 'none';
      whitePaws(c, g.paws.near);
    }, 0.55, 0.55);
    if (P.tailFront) tailLayer();

    // детали: уши внутри, нос, рот, усы
    setT(o);
    o.save();
    o.filter = `blur(${0.5 * s}px)`;
    o.fillStyle = hexA(look.inner, 0.75);
    for (const p of A.innerEars) { o.beginPath(); trace(o, p); o.fill(); }
    o.restore();
    o.fillStyle = look.nose;
    o.beginPath(); trace(o, [hp(4.8, 1.6), hp(7.8, 1.6), hp(6.3, 3.3)]); o.fill();
    o.strokeStyle = hexA(look.ink, 0.6); o.lineWidth = 0.7; o.lineCap = 'round';
    o.beginPath();
    const n0 = hp(6.3, 3.2), n1 = hp(6.3, 4.4);
    o.moveTo(n0.x, n0.y); o.lineTo(n1.x, n1.y);
    for (const [qq, ee] of [[[5.4, 5.4], [4.4, 4.7]], [[7.2, 5.4], [8.2, 4.7]]]) {
      const q1 = hp(...qq), e1 = hp(...ee);
      o.moveTo(n1.x, n1.y); o.quadraticCurveTo(q1.x, q1.y, e1.x, e1.y);
    }
    o.stroke();
    o.strokeStyle = hexA(look.ink, 0.42); o.lineWidth = 0.42;
    for (const [a, b, c] of [[[9, 4.2], [14, 2.6], [19, 2.4]], [[9.2, 5], [14.5, 5], [19.5, 6]], [[8.8, 5.8], [13.5, 7.4], [18, 9.2]],
      [[-6, 4.2], [-11, 3.4], [-16, 3.6]], [[-6, 5.2], [-11, 5.8], [-15.5, 7]]]) {
      const A1 = hp(...a), B1 = hp(...b), C1 = hp(...c);
      o.beginPath(); o.moveTo(A1.x, A1.y); o.quadraticCurveTo(B1.x, B1.y, C1.x, C1.y); o.stroke();
    }

    // маска для попадания мышью (половинное разрешение)
    const mw = Math.ceil(W / 2), mh = Math.ceil(H / 2);
    const mc = mk(mw, mh), mcx = mc.getContext('2d', { willReadFrequently: true });
    mcx.drawImage(out, 0, 0, mw, mh);
    const md = mcx.getImageData(0, 0, mw, mh).data, mask = new Uint8Array(mw * mh);
    for (let i = 0; i < mask.length; i++) mask[i] = md[i * 4 + 3];
    return { c: out, mask, mw, mh, s, anchors: A };
  }

  // ---------- мелкие спрайты ----------
  function heartPts(cx, cy, r) {
    const pts = [];
    for (let i = 0; i < 40; i++) {
      const t = i / 40 * TAU;
      pts.push(V(cx + r * Math.pow(Math.sin(t), 3), cy - r / 16 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))));
    }
    return pts;
  }
  function heartSprite(s, outline = false) {
    const W = Math.ceil(24 * s), c = mk(W, W), g = c.getContext('2d');
    g.setTransform(s, 0, 0, s, 12 * s, 12 * s);
    if (outline) {
      g.strokeStyle = 'rgba(214,92,112,0.9)'; g.lineWidth = 1.5; g.setLineDash([2.3, 1.8]);
      g.beginPath(); trace(g, heartPts(0, 1, 8)); g.stroke();
      return c;
    }
    g.fillStyle = '#e8798c'; g.beginPath(); trace(g, wobble(heartPts(0, 1, 8), 5, 0.35)); g.fill();
    washify(c, '#b8405a', s, 0.7, 0.4);
    g.setTransform(s, 0, 0, s, 12 * s, 12 * s);
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.arc(-3, -2.6, 1.8, 0, TAU); g.fill();
    return c;
  }
  const YARN = ['#d9566b', '#5b86c9', '#e2b13c', '#7db36a'];
  const YARN_R = 6.5;
  // клубочек: шар с намотанными нитками; центр — середина спрайта
  function yarnSprite(s, color, seed) {
    const r = YARN_R, W = Math.ceil((r * 2 + 6) * s), c = mk(W, W), g = c.getContext('2d'), h = W / 2;
    g.setTransform(s, 0, 0, s, h, h);
    g.fillStyle = color; g.beginPath(); trace(g, wobble(ell(0, 0, r, r, 0, 22), seed, 0.25)); g.fill();
    g.globalCompositeOperation = 'source-atop';
    const rr = rng(seed * 31 + 7);
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const a = rr() * Math.PI, off = (rr() - 0.5) * r * 1.2;
      g.strokeStyle = i % 2 ? 'rgba(255,255,255,0.35)' : 'rgba(60,30,30,0.28)'; g.lineWidth = 0.8;
      g.beginPath(); g.ellipse(-off * Math.sin(a), off * Math.cos(a), r * 1.05, r * 0.45, a, 0, TAU); g.stroke();
    }
    const gr = g.createRadialGradient(-r * 0.35, -r * 0.4, 0.5, 0, 0, r * 1.1);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.6, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(40,20,20,0.3)');
    g.fillStyle = gr; g.fillRect(-r * 2, -r * 2, r * 4, r * 4);
    g.globalCompositeOperation = 'source-over';
    washify(c, '#3a2a2a', s, 0.45, 0.3);
    return c;
  }
  // корзинка с клубками; начало координат — середина дна
  function basketSprite(s, yarns) {
    const W = Math.ceil(54 * s), H = Math.ceil(42 * s), c = mk(W, H), g = c.getContext('2d');
    g.setTransform(s, 0, 0, s, 27 * s, 40 * s);
    const yw = yarns[0].width / s;
    [[-9, -21, 0], [9, -21, 1], [0, -25, 2], [-3, -18, 3]].forEach(([x, y, i]) => g.drawImage(yarns[i], x - yw / 2, y - yw / 2, yw, yw));
    // нитка свисает через край
    g.strokeStyle = 'rgba(217,86,107,0.8)'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(-11, -19); g.bezierCurveTo(-20, -18, -22, -10, -25, -3); g.stroke();
    const body = mk(W, H), b = body.getContext('2d');
    b.setTransform(s, 0, 0, s, 27 * s, 40 * s);
    b.fillStyle = '#b98a52';
    b.beginPath(); trace(b, wobble([V(-23, -18), V(0, -19), V(23, -18), V(18, -1), V(0, 0), V(-18, -1)], 9, 0.3)); b.fill();
    b.globalCompositeOperation = 'source-atop';
    b.strokeStyle = 'rgba(110,70,35,0.55)'; b.lineWidth = 1.1;
    for (let y = -15; y < 0; y += 4) { b.beginPath(); b.moveTo(-24, y); b.lineTo(24, y); b.stroke(); }
    for (let x = -23; x < 25; x += 5) { b.beginPath(); b.moveTo(x, -18); b.lineTo(x * 0.8, 0); b.stroke(); }
    b.globalCompositeOperation = 'source-over';
    b.fillStyle = '#9c6e3e'; b.beginPath(); trace(b, ell(0, -18, 24, 3, 0, 22)); b.fill();
    washify(body, '#6e4524', s, 0.5, 0.4);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(body, 0, 0);
    return c;
  }
  function shadowSprite(s, rx = 34) {
    const W = Math.ceil((rx * 2 + 24) * s), H = Math.ceil(16 * s), c = mk(W, H), g = c.getContext('2d');
    g.setTransform(s, 0, 0, s, W / 2, 8 * s);
    g.filter = `blur(${2.5 * s}px)`;
    g.fillStyle = 'rgba(70,50,35,0.16)';
    g.beginPath(); g.ellipse(0, 0, rx, 4, 0, 0, TAU); g.fill();
    return c;
  }

  return { LOOKS, ANIMS, SPR, YARN, YARN_R, renderFrame, heartSprite, yarnSprite, basketSprite, shadowSprite, hexA, mk, rng };
})();
