'use strict';
// Процедурные акварельные котики: анатомия в профиль по позе (лапы через IK) -> слои заливки, края, зерно бумаги, тушь.
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

  // ---------- анатомия кошки: строгий профиль, смотрит вправо, земля y=0 ----------
  // Модель устроена как у лошадок: силуэт собирается из анатомических масс, а не из «бусин».
  // Масштаб 1 см = 1.43 ед. Длины костей — по остеометрии домашней кошки (плечевая 9.95 см, лучевая 9.17 см,
  // бедро = плечевая / 0.944, голень = бедро * 1.066). При таких костях холка ~28 см (40 ед.): ниже кошка
  // стояла бы на полусогнутых. Корпус от груди до седалищных бугров ~34 см — в 1.2 раза длиннее высоты в холке.
  // Корпус: ось позвоночника H→S (H — центр таза, S — центр грудной клетки у лопаток), arch>0 — спина выгнута
  //   вверх; вдоль оси идёт профиль TORSO: низкая поясница с подтянутым пахом, живот, глубокая грудь, холка.
  // Перед: лопатка от верхнего края у холки (T) вперёд-вниз к плечевому суставу (SJ) и качается вместе с лапой;
  //   плечевая — назад-вниз к локтю у линии грудины; предплечье отвесно; запястье; короткая пясть к пальцам.
  //   Лопатка и плечо лежат в силуэте корпуса, из-под груди видно только предплечье.
  // Зад: тазобедренный сустав (HJ) у верха крупа; бедро вперёд-вниз, колено у паха на линии живота; голень
  //   назад-вниз с икрой и ахилловым сухожилием; пяточный бугор; длинная плюсна; кошка стоит на пальцах.
  //   Бедро — широкая мышечная масса от таза до колена, сзади — от седалищного бугра (ISCH) к икре.
  // Точка лапы в позе — пальцевый сустав (основание пальцев), сами пальцы лежат от него вперёд.
  // flip — лёжа на спине, лапы вверх. over — ближние лапы, которые рисуются поверх тела своим слоем.
  const SCAP = 10, HUM = 14.2, RAD = 13.1, CARP = 4.7, FEMUR = 15, TIBIA = 16, META = 9.7;
  const FAR = [1.8, -0.8]; // дальние лапы чуть смещены
  const SCAP_TOP = [3, -6.5], SCAP_A = 1.1, SCAP_SWING = 0.4; // лопатка: ~63° к оси груди, качается на ±23°
  const HIP = [-2.5, -0.5], ISCH = [-5, 2]; // тазобедренный сустав от центра таза; седалищный бугор от сустава
  const FY = -1.8; // высота пальцевого сустава стоящей лапы
  // профиль корпуса вдоль позвоночника от таза (t=0) до лопаток (t=1): [t, над осью, под осью]
  const TORSO = [[0, 7, 7.8], [0.15, 6.8, 9.4], [0.4, 6.9, 11.4], [0.65, 7.3, 11.6], [0.85, 8.4, 10.8], [1, 8.8, 9.8]];
  // профиль головы от затылка по часовой: темя, лоб, переносица, мочка носа, губа, подбородок, щека
  const HEAD = [[-7.1, 0.4], [-6.6, -3.1], [-4.3, -5.6], [-0.8, -6.5], [2.4, -5.8], [4.6, -4.1], [6.1, -2.6], [7.4, -1.6], [8.1, -0.6],
    [8, 0.7], [7.5, 1.5], [7.7, 2.7], [7.1, 4], [5.2, 5.1], [2.4, 6.2], [-1.8, 6.5], [-5.2, 5.2], [-7, 2.9]];
  // ухо: основание спереди и сзади, кончик; прижимается назад-вниз
  const EAR = { b1: [1.5, -5.4], b2: [-5.3, -3.8], tip: [-2.4, -12.8], fold: [-5.2, 6.2] };
  const HS = 1.42; // голова чуть крупнее строгих пропорций: шерсть и щёки
  const qb = (a, c, b, t) => V((1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y);
  const unit = a => { const l = len(a) || 1; return V(a.x / l, a.y / l); };
  const gauss = (t, m, w) => Math.exp(-(((t - m) / w) ** 2));
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = t => t * t * (3 - 2 * t);
  const seg = (k, a, b) => smooth(clampN((k - a) / (b - a), 0, 1));
  function prof(t, j) {
    for (let i = 1; i < TORSO.length; i++) if (t <= TORSO[i][0]) {
      const a = TORSO[i - 1], b = TORSO[i];
      return lerp(a[j], b[j], smooth((t - a[0]) / (b[0] - a[0])));
    }
    return TORSO[TORSO.length - 1][j];
  }
  // metaV(m) — от пальцев к суставу над ними (пятка, запястье): m=0 — отвесно, m>0 — сустав позади пальцев,
  // m<0 — сустав впереди, пальцы отстают
  const metaV = m => V(-Math.sin(m), -Math.cos(m));

  function buildCat(P) {
    const H = P2(P.H), S = P2(P.S), flip = (P.flip || 0) > 0.5, sg = flip ? -1 : 1;
    const u = unit(sub(S, H)), n = V(-u.y, u.x);
    const C = add(lerpV(H, S, 0.5), n, -(P.arch || 0) * sg);
    // оси таза и грудной клетки: вперёд по позвоночнику и к животу
    const uH = unit(sub(C, H)), nH = V(-uH.y * sg, uH.x * sg), uS = unit(sub(S, C)), nS = V(-uS.y * sg, uS.x * sg);
    const atH = (x, y) => add(add(H, uH, x), nH, y), atS = (x, y) => add(add(S, uS, x), nS, y);
    const body = [], far = [], legsN = [], paws = { near: [], far: [] }, A = {}, skel = [], inner = [];
    const lift = p => (flip ? p : V(p.x, Math.min(p.y, -2.6)));

    // корпус
    const chain = [], scap = P.scap ?? 0.3;
    for (let i = 0; i <= 14; i++) {
      const t = i / 14, top = prof(t, 1) + scap * 1.5 * gauss(t, 0.9, 0.09), bot = prof(t, 2);
      chain.push([qb(H, C, S, t), flip ? bot : top, flip ? top : bot]);
    }
    const rumpC = atH(-0.6, 0.8), chestC = atS(1.6, 0.8);
    body.push(limb(chain), ell(rumpC.x, rumpC.y, 7.4, 8.2, Math.atan2(uH.y, uH.x), 20), ell(chestC.x, chestC.y, 8, 9.6, Math.atan2(uS.y, uS.x), 20));
    skel.push([H, C, S]);
    // шерсть: мягкие пряди по краю силуэта — манишка на груди, подшёрсток на животе, щёки, «штаны» на бёдрах
    const tuft = (p, dir, L, w) => { const d = unit(dir), nn = V(-d.y, d.x); return [add(p, nn, w), add(add(p, d, L * 0.55), nn, w * 0.6), add(p, d, L), add(add(p, d, L * 0.5), nn, -w * 0.65), add(p, nn, -w)]; };
    if (!flip) for (let t = 0.2; t < 0.86; t += 0.082) {
      const p = qb(H, C, S, t), d = unit(sub(qb(H, C, S, t + 0.02), p)), dn = V(-d.y, d.x);
      body.push(tuft(add(p, dn, prof(t, 2) - 1.2), add(V(dn.x * 0.8, dn.y * 0.8), d, -0.6), 3.6, 2.6));
    }
    for (const a of [0.15, 0.55, 0.95, 1.35]) {
      const o = add(V(uS.x * Math.cos(a), uS.y * Math.cos(a)), nS, Math.sin(a));
      body.push(tuft(add(chestC, o, 7.6), add(o, nS, 0.7), 3.6, 2.6));
    }

    // шея и голова
    const NB = atS(5, -2.5);
    let Hc = add(NB, dirA(P.neck), P.neckLen);
    if (Hc.y > (flip ? -10.5 : -6.2)) Hc = V(Hc.x, flip ? -10.5 : -6.2);
    const ht = P.headTilt || 0, hp = (x, y) => add(Hc, rot(V(x * HS, y * sg * HS), ht));
    const nd = unit(sub(Hc, NB));
    body.push(limb([[atS(1.2, -0.6), 9.4, 9.6], [lerpV(NB, Hc, 0.45), 9, 8.8], [add(Hc, nd, -1.5), 8.8, 8.6]]));
    const head = HEAD.map(([x, y]) => hp(x, y));
    const e = P.ears || 0;
    const ear = (dx, dy) => {
      const b1 = V(EAR.b1[0] + dx, EAR.b1[1] + dy), b2 = V(EAR.b2[0] + dx, EAR.b2[1] + dy);
      const tip = V(EAR.tip[0] + dx + EAR.fold[0] * e, EAR.tip[1] + dy + EAR.fold[1] * e);
      // передний край почти прямой, задний — выпуклый
      const fr = add(lerpV(b1, tip, 0.5), V(0.5, 0.2)), bk = add(lerpV(b2, tip, 0.45), V(-1.1, -0.6));
      return { b1, b2, tip, poly: [V(b1.x + 0.6, b1.y + 2), b1, fr, tip, tip, bk, b2, V(b2.x + 0.6, b2.y + 2.2)].map(p => hp(p.x, p.y)) };
    };
    const earN = ear(0, 0), earF = ear(4.2, 0.5);
    body.push(head, earN.poly);
    for (const [x, y] of [[1.2, 5.6], [-1.6, 5.9], [-4.2, 5.2], [-6.2, 3.2]]) body.push(tuft(hp(x, y - 0.6), sub(hp(x - 1.3, y + 2), hp(x, y)), 2.6 * HS, 1.5 * HS));
    far.push(earF.poly);
    // раковина ближнего уха открыта вперёд-вбок: розовая середина, у дальнего видна внутренняя сторона
    for (const [E, k1, k2] of [[earN, 0.62, 0.3], [earF, 0.7, 0.5]]) {
      const c = V((E.b1.x * 1.4 + E.b2.x * 0.6 + E.tip.x) / 3, (E.b1.y + E.b2.y + E.tip.y) / 3 + 0.6);
      inner.push([lerpV(c, E.b1, k1), lerpV(c, E.tip, k1), lerpV(c, E.tip, k1), lerpV(c, E.b2, k2)].map(p => hp(p.x, p.y)));
    }
    A.innerEar = inner[0]; A.innerEarF = inner[1];

    // пальцы — продолжение пясти/плюсны: на земле лежат плоско, в воздухе следуют за лапой
    const pawAt = (foot, up, rx) => {
      let f = V(-up.y * sg, up.x * sg);
      const w = flip ? 1 : clampN((-foot.y - 2.2) / 4, 0, 1);
      f = unit(lerpV(V(1, 0), f, w));
      const c = add(add(foot, f, 2 - 0.7 * w), up, 0.1 + 0.3 * w);
      return { c, poly: ell(c.x, c.y, rx - 0.5 * w, 2.4, Math.atan2(f.y, f.x), 14) };
    };
    // по умолчанию ближние лапы сливаются с корпусом; отдельным слоем со своим контуром — только лапа поверх тела
    const legs = {}, over = P.over || '', muscles = [];
    for (const k of ['FL', 'FR', 'HL', 'HR']) {
      const farLeg = k[1] === 'R', off = farLeg ? V(FAR[0], FAR[1]) : V(0, 0);
      let foot = P2(P.feet[k]), paw;
      const parts = [], inner2 = [];
      if (k[0] === 'F') {
        // лопатка поворачивается за лапой: вынос вперёд — сустав вперёд-вверх, отведение назад — лопатка отвеснее
        const fb = flip ? -1 : 1, T = add(atS(SCAP_TOP[0], SCAP_TOP[1]), off);
        const pr = clampN(((foot.x - T.x) * uS.x + (foot.y - T.y) * uS.y) / 13, -1, 1);
        const sa = SCAP_A - SCAP_SWING * pr, SJ = add(add(T, uS, SCAP * Math.cos(sa)), nS, SCAP * Math.sin(sa));
        const cm = P.carp && P.carp[k];
        let wrist;
        if (cm != null) wrist = add(foot, metaV(cm), CARP);
        else { const d = unit(sub(foot, SJ)), n2 = V(-d.y, d.x); wrist = add(add(foot, d, -4.2), n2, 2.1 * fb); }
        const r = ik(SJ, wrist, HUM, RAD, fb), el = lift(r.joint), w = r.end;
        foot = add(foot, sub(w, wrist));
        const up = unit(sub(w, foot)), ua = unit(sub(el, SJ)), fa = unit(sub(w, el));
        // лопатка с мышцами плеча, плечо с трицепсом (локтевой бугор сзади), предплечье сужается к запястью
        const sh = limb([[T, 2.4, 3.4], [lerpV(T, SJ, 0.55), 4, 5], [SJ, 3, 4.8]]);
        const arm = limb([[add(SJ, ua, -1.5), 2.6, 4.6], [SJ, 3.4, 5.6], [lerpV(SJ, el, 0.5), 5, 6.8], [el, 4, 5], [add(el, ua, 1.8), 3, 3.6]]);
        inner2.push(sh, arm);
        parts.push(limb([[add(el, fa, -2.2), 3.6, 4], [el, 4.1, 4.6], [lerpV(el, w, 0.25), 4.1, 4.3], [lerpV(el, w, 0.65), 3.5, 3.6],
          [w, 3.2, 3.5], [lerpV(w, foot, 0.6), 3.1, 3.1], [foot, 2.9, 2.9]]), ell(el.x, el.y, 4.3, 4.3, 0, 12), ell(w.x, w.y, 3.3, 3.3, 0, 12));
        const pw = pawAt(foot, up, 4);
        paw = pw.poly;
        legs[k] = { paw: pw.c, foot, elbow: el, wrist: w, sj: SJ, top: T };
        // подгрудок: от плечевого сустава грудь плавно сходит к предплечью, плечо не торчит ступенькой
        if (!flip) inner2.push([atS(7.5, 0.5), add(SJ, V(3.2, 1.5)), add(lerpV(SJ, el, 0.6), V(5, 2.2)), add(el, fa, 3.5), add(el, V(-2, -3)), atS(-3, 6)]);
        if (!farLeg) muscles.push(arm);
        skel.push([T, SJ, el, w, foot]);
      } else {
        const hb = flip ? 1 : -1, HJ = add(atH(HIP[0], HIP[1]), off), mv = metaV((P.meta && P.meta[k]) ?? 0.47);
        const r = ik(HJ, add(foot, mv, META), FEMUR, TIBIA, hb), kn = lift(r.joint), hock = r.end;
        foot = add(hock, mv, -META);
        const fd = unit(sub(kn, HJ)), sd = unit(sub(hock, kn));
        // бедро: широкая масса от таза к колену; голень: икра в верхней трети, ахилл, пяточный бугор; плюсна
        const thigh = limb([[add(HJ, fd, -2), 5, 5.4], [HJ, 7.6, 7.6], [lerpV(HJ, kn, 0.35), 8.4, 8.6], [lerpV(HJ, kn, 0.7), 6.8, 7.6],
          [kn, 4.8, 5.6], [add(kn, fd, 1.6), 3.2, 3.8]]);
        parts.push(thigh, limb([[add(kn, sd, -2.4), 3.6, 4.4], [kn, 4.2, 5.4], [lerpV(kn, hock, 0.24), 4, 5.8], [lerpV(kn, hock, 0.52), 3.5, 4.8],
          [lerpV(kn, hock, 0.82), 3, 3.6], [hock, 3, 3.6], [lerpV(hock, foot, 0.3), 2.9, 3.1], [lerpV(hock, foot, 0.7), 2.8, 2.8], [foot, 2.9, 2.9]]),
          ell(kn.x, kn.y, 4.8, 4.8, 0, 12), ell(hock.x, hock.y, 3.3, 3.3, 0, 12));
        // задняя группа мышц бедра: от седалищного бугра к икре — сзади нога идёт плавной линией, а не зигзагом
        const PB = add(atH(HIP[0] + ISCH[0], HIP[1] + ISCH[1]), off), calf = add(lerpV(kn, hock, 0.3), V(-sd.y, sd.x), 4.4 * sg);
        if (!flip && (calf.x - kn.x) * uH.x + (calf.y - kn.y) * uH.y < 0) parts.push([HJ, PB, add(lerpV(PB, calf, 0.5), uH, -1.6), calf, kn]);
        if (!flip && (calf.x - kn.x) * uH.x + (calf.y - kn.y) * uH.y < 0) for (const t of [0.12, 0.38, 0.64, 0.9])
          parts.push(tuft(add(lerpV(PB, calf, t), uH, 0.6), add(V(-uH.x * 0.7, -uH.y * 0.7), nH, 0.8), 3.8, 2.6));
        const pw = pawAt(foot, mv, 4.3);
        paw = pw.poly;
        legs[k] = { paw: pw.c, foot, knee: kn, hock, hj: HJ };
        if (!farLeg) muscles.push(thigh);
        skel.push([HJ, kn, hock, foot]);
      }
      if (farLeg) far.push(...inner2, ...parts, paw);
      else if (over.includes(k)) { body.push(...inner2); legsN.push(...parts, paw); }
      else body.push(...inner2, ...parts, paw);
      (farLeg ? paws.far : paws.near).push(paw);
    }

    // хвост: от корня над седалищными буграми, сужается к кончику, не уходит под землю
    const tail = [];
    let tp = atH(-5.6, -2.4), th = P.tail.a;
    const TN = 14, TL = P.tail.len || 38;
    tail.push(tp);
    for (let i = 1; i <= TN; i++) {
      const t = i / TN;
      th += P.tail.curl / TN + (P.tail.wave || 0) * Math.cos(t * Math.PI * 1.5 + (P.tail.ph || 0)) * 0.14 * t;
      tp = add(tp, dirA(th), TL / TN);
      if (tp.y > -4) tp = V(tp.x, -4);
      tail.push(tp);
    }
    const tw = i => 3.9 + 1.5 * Math.sin(Math.PI * Math.pow(i / TN, 0.75)) - 0.9 * Math.pow(i / TN, 3); // пушистый: шире к середине
    const tip = tail[TN];
    const tailParts = [limb(tail.map((p, i) => [p, tw(i), tw(i)])), ell(tip.x, tip.y, 3, 3, 0, 12)];

    // на земле силуэт ложится плоско
    for (const poly of tailParts) for (const p of poly) if (p.y > -0.1) p.y = -0.1;
    if (!flip) for (const list of [body, far, legsN]) for (const poly of list) for (const p of poly) if (p.y > -0.1) p.y = -0.1;

    A.head = Hc;
    A.eyeN = hp(4.1, -1.7); A.eyeF = null; A.eyeAng = -ht * sg; A.eyeR = [1.5 * HS, 1.9 * HS];
    A.mouth = hp(7.9, 2.4);
    A.paw = legs.FL.paw;
    A.top = Math.min(...head.map(p => p.y), ...earN.poly.map(p => p.y), ...chain.map(c => c[0].y - c[1]));
    A.body = lerpV(H, S, 0.5);
    return { H, S, C, u, n: V(n.x * sg, n.y * sg), uS, nS, ang: Math.atan2(u.y, u.x), hp, body, far, legsN, paws, tail, tailParts, legs, muscles, skel, anchors: A, flip, sg };
  }

  // ---------- позы ----------
  // стоя: спина ровная, круп на уровне холки, голова над линией спины; хвост расслаблен — вниз и кончиком вверх
  const TAIL = (a, curl, len = 38) => ({ a, curl, wave: 0, ph: 0, len });
  const STAND = {
    H: [-17, -33.5], S: [15, -32], arch: 0.8, scap: 0.3, flip: 0,
    feet: { FL: [19, FY], FR: [22.5, FY], HL: [-18, FY], HR: [-14, FY] }, meta: { HL: 0.47, HR: 0.47 }, carp: { FL: 0.5, FR: 0.5 },
    neck: 0.8, neckLen: 12.5, headTilt: -0.1, ears: 0, tongue: 0,
    tail: TAIL(3.5, -1.3), tailFront: 0,
  };
  // сидя: круп на земле, плюсны лежат, колени подняты к животу, передние прямые, хвост обвивает лапки
  const SIT = {
    H: [-10, -9.4], S: [6, -29], arch: 3, scap: 0.1, flip: 0,
    feet: { FL: [16, FY], FR: [18.5, FY], HL: [4, FY], HR: [6.5, FY] }, meta: { HL: 1.5, HR: 1.5 }, carp: { FL: 0.4, FR: 0.4 },
    neck: 1.15, neckLen: 12, headTilt: -0.1, ears: 0, tongue: 0,
    tail: TAIL(4.5, 2.1), tailFront: 1,
  };
  // «буханка»: лежит на груди, предплечья и плюсны на земле
  const LOAF = {
    H: [-14, -10], S: [11, -11.2], arch: 1.6, scap: 0.2, flip: 0,
    feet: { FL: [18, FY], FR: [21, FY], HL: [-1, FY], HR: [2, FY] }, meta: { HL: 1.5, HR: 1.5 }, carp: { FL: 1.45, FR: 1.45 },
    neck: 0.95, neckLen: 11.5, headTilt: -0.05, ears: 0.1, tongue: 0,
    tail: TAIL(3.8, 2.4), tailFront: 1,
  };
  // спит клубком: спина круглым куполом, голова уткнута вниз к лапам, хвост укрывает нос
  const CURL = {
    H: [-10, -9.6], S: [8, -10.4], arch: 6.5, scap: 0, flip: 0,
    feet: { FL: [14, FY], FR: [16, FY], HL: [2, FY], HR: [4, FY] }, meta: { HL: 1.5, HR: 1.5 }, carp: { FL: 1.45, FR: 1.45 },
    neck: -0.5, neckLen: 10, headTilt: -0.5, ears: 0.3, tongue: 0,
    tail: TAIL(4.5, 1.9, 40), tailFront: 1,
  };
  // валяется на боку, вытянувшись: лапы вперёд и назад
  const SPRAWL = {
    H: [-20, -8.6], S: [12, -9.4], arch: -0.6, scap: 0, flip: 0,
    feet: { FL: [46, -4], FR: [43, -2.4], HL: [-42, -5.5], HR: [-39, -3] }, meta: { HL: -1.4, HR: -1.4 }, carp: { FL: 1.5, FR: 1.5 },
    neck: 0.1, neckLen: 12.5, headTilt: 0.1, ears: 0.15, tongue: 0,
    tail: TAIL(3.18, 0.15), tailFront: 0,
  };
  // на спине пузом вверх, лапки кверху согнуты
  const ROLL = {
    H: [-18, -8.6], S: [12, -9.2], arch: -1, scap: 0, flip: 1,
    feet: { FL: [22, -27], FR: [18, -25], HL: [-10, -28], HR: [-14, -26] }, meta: { HL: 2.7, HR: 2.7 }, carp: { FL: null, FR: null },
    neck: 0.3, neckLen: 12, headTilt: 0.35, ears: 0.9, tongue: 0,
    tail: TAIL(3.2, 0.4), tailFront: 0,
  };
  // припала к земле перед прыжком: лопатки выше спины, лапы под собой
  const CROUCH = {
    H: [-16, -18.5], S: [14, -16], arch: -0.3, scap: 1.5, flip: 0,
    feet: { FL: [23, FY], FR: [26, FY], HL: [-10, FY], HR: [-7, FY] }, meta: { HL: 1.1, HR: 1.1 }, carp: { FL: 0.6, FR: 0.6 },
    neck: 0.2, neckLen: 12, headTilt: 0.05, ears: 0.25, tongue: 0,
    tail: TAIL(3.15, 0.2), tailFront: 0,
  };
  // потягушки: «поклон» (передние вперёд, грудь к земле, круп вверх, спина прогнута) …
  const BOW = {
    H: [-14, -34], S: [19, -14.5], arch: -3, scap: 1.2, flip: 0,
    feet: { FL: [42, FY], FR: [45, FY], HL: [-16, FY], HR: [-12, FY] }, meta: { HL: 0.35, HR: 0.35 }, carp: { FL: 1.3, FR: 1.3 },
    neck: 0.3, neckLen: 12.5, headTilt: 0.25, ears: 0.3, tongue: 0,
    tail: TAIL(1.9, -0.7), tailFront: 0,
  };
  // … затем вперёд на передние и вытянуть заднюю лапу назад
  const HINDSTRETCH = {
    H: [-10, -31], S: [21, -31], arch: 1.5, scap: 0.6, flip: 0,
    feet: { FL: [23, FY], FR: [26.5, FY], HL: [-47, -6], HR: [-9, FY] }, meta: { HL: -1.3, HR: 0.5 }, carp: { FL: 0.4, FR: 0.4 },
    neck: 0.85, neckLen: 12.5, headTilt: 0.05, ears: 0.1, tongue: 0,
    tail: TAIL(3.0, -0.4), tailFront: 0,
  };
  // сидит на корточках и бьёт лапкой
  const BAT = {
    H: [-12, -15], S: [12, -25], arch: 1, scap: 0.6, flip: 0,
    feet: { FL: [20, FY], FR: [22, FY], HL: [-3, FY], HR: [0, FY] }, meta: { HL: 1.3, HR: 1.3 }, carp: { FL: null, FR: 0.5 },
    neck: 0.55, neckLen: 12, headTilt: -0.05, ears: 0.3, tongue: 0,
    tail: TAIL(3.3, 0.4), tailFront: 0,
  };

  // смешивание поз (числа, массивы и вложенные объекты)
  function mix(a, b, t) {
    if (a == null) return t < 0.5 ? a : b;
    if (typeof a === 'number') return lerp(a, b ?? a, t);
    if (typeof a !== 'object') return t < 0.5 ? a : b ?? a;
    if (b == null) return a;
    if (Array.isArray(a)) return a.map((v, i) => mix(v, b[i], t));
    const o = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) o[k] = k in a ? (k in b ? mix(a[k], b[k], t) : a[k]) : b[k];
    return o;
  }
  const clone = p => JSON.parse(JSON.stringify(p));
  function edit(p, f) { const q = clone(p); f(q); return q; }

  // Шаг: латеральная последовательность ЛЗ→ЛП→ПЗ→ПП, опора ~2/3 цикла (у кошки 64–70%). В опоре пальцы стоят на
  // месте, тело проходит над лапой: A — половина пути лапы под телом. Угол пясти (передние) и плюсны (задние)
  // по фазе: в опоре лапа перекатывается с подушечек на пальцы, в конце пятка/запястье отрываются (peel);
  // в переносе сустав сгибается одной волной, пальцы отстают, к постановке лапа разгибается.
  const GAIT = { F: { a0: 0.6, a1: -0.2, peel: 0.45, flex: 0.9 }, H: { a0: 0.62, a1: -0.08, peel: 0.45, flex: 0.55 } };
  const gaitSt = (G, s) => lerp(G.a0, G.a1, s) - G.peel * seg(s, 0.75, 1);
  const gaitSw = (G, s) => lerp(G.a1 - G.peel, G.a0, smooth(s)) - G.flex * Math.sin(Math.PI * Math.pow(s, 0.85)) ** 2;
  function gait(base, ph, offs, stance, A, lift, flex = 1, reach = 0) {
    const q = clone(base);
    // ближние и дальние лапы шагают одинаково относительно своих суставов — шаг у пары одной длины
    q.feet.FR[0] = q.feet.FL[0] + FAR[0]; q.feet.HR[0] = q.feet.HL[0] + FAR[0];
    for (const k in offs) {
      const p = ((ph + offs[k]) % 1 + 1) % 1, f = q.feet[k], fr = k[0] === 'F', G = GAIT[k[0]];
      const b = (fr ? base.carp : base.meta)[k] - (fr ? 0.5 : 0.47);
      let a;
      if (p < stance) {
        const s = p / stance; f[0] += A * (1 - 2 * s);
        a = gaitSt(G, s);
        if (k === 'FL') q.scap += 0.7 * Math.sin(Math.PI * s);
      } else {
        // лапа плавно поднимается и опускается к постановке
        const s = (p - stance) / (1 - stance);
        f[0] += A * (-1 + 2 * smooth(s)); f[1] -= lift * (fr ? 1.25 : 1) * Math.sin(Math.PI * s);
        // на галопе передние выносятся далеко вперёд перед постановкой, задние выбрасываются назад после толчка
        if (reach) f[0] += fr ? reach * Math.exp(-(((s - 0.72) / 0.22) ** 2)) : -reach * Math.exp(-(((s - 0.18) / 0.2) ** 2));
        a = gaitSw(G, s);
      }
      (fr ? q.carp : q.meta)[k] = b + a * flex;
    }
    return q;
  }
  function walkPose(i, n, base, A, lift, bob) {
    const ph = i / n, q = gait(base, ph, { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, 0.66, A, lift);
    // корпус чуть опускается, когда лапа выносится далеко, голова кивает в такт передним
    q.H[1] += bob * Math.sin(ph * TAU * 2); q.S[1] += bob * Math.sin(ph * TAU * 2 + 0.6);
    q.neck += 0.03 * Math.sin(ph * TAU * 2 + 1.2);
    q.tail.wave = 0.5 * Math.sin(ph * TAU);
    return q;
  }
  // на шагу голова несётся на уровне спины
  const WALKB = edit(STAND, q => { q.feet.FL[0] = 18; q.H[1] = -32.5; q.S[1] = -31; q.neck = 0.42; q.headTilt = -0.05; q.tail = TAIL(3.3, -0.9); });
  const WALKUPB = edit(WALKB, q => { q.neck = 0.6; q.headTilt = -0.1; q.tail = TAIL(1.95, -0.9); });
  // крадётся: низко на согнутых, лопатки выше спины, голова вытянута вперёд на уровне спины
  const STALKB = edit(STAND, q => {
    q.feet.FL[0] = 18; q.H = [-17, -27.5]; q.S = [15, -25.5]; q.arch = -0.4; q.scap = 1.5; q.neck = 0.18; q.neckLen = 12.5; q.headTilt = 0.05; q.ears = 0.2;
    q.meta = { HL: 0.8, HR: 0.8 }; q.carp = { FL: 0.6, FR: 0.6 };
    q.tail = TAIL(3.25, -0.2);
  });
  // Галоп по фазам: задние ставятся далеко под живот (спина дугой) и толкают → вытянутый полёт (передние вперёд,
  // задние назад, спина прямая и длинная) → приземление на передние, тело проходит над ними → сбор в полёте: задние
  // подтягиваются под живот. В опоре лапа стоит на месте: путь под телом = опора * длина цикла (скорость RUN).
  const RUN_N = 18, RUN_FPS = 34, RUN_ST = 0.33, RUN_PATH = RUN_ST * 135 * RUN_N / RUN_FPS;
  const RUNB = edit(STAND, q => { q.ears = 0.4; q.scap = 0.6; q.tail = TAIL(3.05, 0.25); });
  // td — где лапа ставится, a — угол плюсны/пясти в начале и конце опоры, sw — перенос: [доля, x, y, угол]
  const RUNK = {
    H: { td: -6, a: [0.95, -0.55], sw: [[0.18, -52, -18, -1.4], [0.48, -24, -19, -0.1], [0.82, -2, -12, 0.8]] },
    F: { td: 33, a: [0.4, -0.35], sw: [[0.2, 2, -12, null], [0.5, 20, -19, null], [0.8, 46, -15, null]] },
  };
  const cr = (p0, p1, p2, p3, u) => 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);
  function runLeg(K, p) {
    const lo = K.td - RUN_PATH;
    if (p < RUN_ST) { const s = p / RUN_ST; return [K.td - RUN_PATH * s, FY, lerp(K.a[0], K.a[1], s) - 0.3 * seg(s, 0.7, 1)]; }
    const s = (p - RUN_ST) / (1 - RUN_ST), pts = [[0, lo, FY, K.a[1] - 0.3], ...K.sw, [1, K.td, FY, K.a[0]]];
    let i = 0;
    while (i < pts.length - 2 && s > pts[i + 1][0]) i++;
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[i + 1], d = pts[Math.min(pts.length - 1, i + 2)], u = (s - b[0]) / (c[0] - b[0]);
    const ang = b[3] == null || c[3] == null ? null : lerp(b[3], c[3], smooth(u));
    return [cr(a[1], b[1], c[1], d[1], u), Math.min(FY, cr(a[2], b[2], c[2], d[2], u)), ang];
  }
  const bump = (ph, c, w) => { const d = ((ph - c) % 1 + 1.5) % 1 - 0.5; return Math.exp(-((d / w) ** 2)); };
  function runPose(i, n) {
    const ph = i / n, q = clone(RUNB), offs = { HL: 0, HR: 0.1, FL: 0.5, FR: 0.61 };
    for (const k in offs) {
      const fr = k[0] === 'F', [x, y, a] = runLeg(RUNK[k[0]], ((ph - offs[k]) % 1 + 1) % 1);
      q.feet[k] = [x + (k[1] === 'R' ? FAR[0] : 0), y];
      (fr ? q.carp : q.meta)[k] = a;
    }
    // ext: +1 — вытянутый полёт, −1 — сбор
    const ext = Math.cos(TAU * (ph - 0.43)), air = bump(ph, 0.45, 0.07) + bump(ph, 0.96, 0.06);
    q.H[0] = -17 - 4.5 * ext; q.S[0] = 15 + 3 * ext; q.arch = 1.4 - 4 * ext;
    // в полёте корпус выше; на опоре задних ниже круп, на опоре передних — грудь, а круп заносится вверх
    const hs = bump(ph, 0.18, 0.13), fs = bump(ph, 0.66, 0.17);
    q.H[1] = -32 - 4.5 * air + 2.5 * hs - 2.5 * fs; q.S[1] = -31 - 4.5 * air + 3 * fs - 1.5 * hs;
    q.neck = 0.32 - 0.12 * ext + 0.1 * fs; q.neckLen = 12.5 + 1 * ext; q.headTilt = 0.02 + 0.06 * ext;
    q.tail.a = 3.05 + 0.18 * ext; q.tail.wave = 0.35 * Math.sin(ph * TAU);
    return q;
  }
  const POUNCE = [
    edit(CROUCH, q => { q.H = [-16, -16.5]; q.ears = 0.45; }),
    edit(CROUCH, q => { q.H = [-20, -24]; q.S = [17, -32]; q.arch = -1; q.feet = { FL: [40, -30], FR: [37, -27], HL: [-42, -3], HR: [-45, -3] }; q.meta = { HL: -0.7, HR: -0.7 }; q.carp = { FL: null, FR: null }; q.neck = 0.5; q.ears = 0.45; }),
    edit(CROUCH, q => { q.H = [-23, -29]; q.S = [20, -31]; q.arch = -2; q.feet = { FL: [52, -27], FR: [49, -24], HL: [-60, -16], HR: [-62, -13] }; q.meta = { HL: -1.2, HR: -1.2 }; q.carp = { FL: null, FR: null }; q.neck = 0.4; q.ears = 0.5; q.tail = TAIL(3.0, 0.2); }),
    edit(CROUCH, q => { q.H = [-20, -28]; q.S = [19, -26]; q.arch = 1; q.feet = { FL: [45, -9], FR: [42, -7], HL: [-54, -18], HR: [-56, -15] }; q.meta = { HL: -1.0, HR: -1.0 }; q.carp = { FL: null, FR: null }; q.neck = 0.3; q.ears = 0.45; q.tail = TAIL(3.0, 0.5); }),
    edit(CROUCH, q => { q.H = [-16, -24]; q.S = [16, -17]; q.arch = 2; q.feet = { FL: [32, FY], FR: [29, FY], HL: [-12, -8], HR: [-15, -6] }; q.meta = { HL: 0.9, HR: 0.9 }; q.ears = 0.35; }),
    edit(CROUCH, q => { q.feet.FL = [29, FY]; q.feet.FR = [26, FY]; q.ears = 0.3; }),
  ];
  const BAT_PAW = [[20, FY], [24, -14], [29, -18], [34, -8], [32, -2.4], [26, -5]];
  // умывание передней лапой: лизнуть подушечку (голова к лапе) и провести лапой по уху и щеке
  const GROOM_PAW = [[22, -27], [22, -25.5], [22, -27], [22, -25.5], [22, -27], [24, -35], [20, -42], [14, -45], [18, -36], [22, -28]];
  // «виолончель»: сидя на бедре, задняя лапа задрана вверх, голова к животу и внутренней стороне бедра
  const GROOM_LEG = edit(SIT, q => {
    q.H = [-7, -9.4]; q.S = [-2, -27]; q.arch = 4.5;
    q.feet.HL = [16, -52]; q.meta.HL = Math.PI; q.feet.HR = [5, FY]; q.over = 'HL';
    q.feet.FL = [9, FY]; q.feet.FR = [12, FY];
    q.neck = -0.25; q.neckLen = 10.5; q.headTilt = -0.75; q.ears = 0.15; q.tongue = 1;
    q.tail = TAIL(3.6, 0.4); q.tailFront = 0;
  });

  const ANIMS = {
    stand: { n: 8, fps: 3, pose: i => edit(STAND, q => { q.tail.wave = 0.5 * Math.sin(i / 8 * TAU); q.tail.ph = i / 8 * TAU; }) },
    walk: { n: 32, fps: 29, pose: i => walkPose(i, 32, WALKB, 13.1, 4, 0.5) },
    walkUp: { n: 32, fps: 29, pose: i => walkPose(i, 32, WALKUPB, 13.1, 4, 0.5) },
    stalk: { n: 32, fps: 20, pose: i => walkPose(i, 32, STALKB, 6.05, 2.6, 0.25) },
    run: { n: RUN_N, fps: RUN_FPS, pose: i => runPose(i, RUN_N) },
    crouch: { n: 4, fps: 8, pose: i => edit(CROUCH, q => { q.H[0] += 1.3 * Math.sin(i / 4 * TAU); q.H[1] += 0.5 * Math.cos(i / 4 * TAU); q.tail.wave = 0.9 * Math.sin(i / 4 * TAU); q.tail.ph = 2; }) },
    pounce: { n: 6, fps: 11, once: true, pose: i => POUNCE[i] },
    bat: { n: 6, fps: 9, strike: 3, pose: i => edit(BAT, q => { q.feet.FL = BAT_PAW[i].slice(); q.carp.FL = i ? null : 0.5; q.over = 'FL'; q.headTilt = -0.05 + 0.08 * Math.sin(i / 6 * TAU); q.tail.wave = 0.6 * Math.sin(i / 6 * TAU); }) },
    sit: { n: 6, fps: 2, pose: i => edit(SIT, q => { q.tail.curl += 0.25 * Math.sin(i / 6 * TAU); }) },
    sitDown: { n: 5, fps: 9, once: true, pose: i => mix(STAND, SIT, smooth(i / 4)) },
    wait: { n: 6, fps: 3, pose: i => edit(SIT, q => { q.headTilt = 0.12; q.neck = 1.2; q.tail.curl += 0.4 * Math.sin(i / 6 * TAU); q.ears = -0.1; }) },
    petted: { n: 4, fps: 2, pose: i => edit(SIT, q => { q.headTilt = 0.3 + 0.05 * Math.sin(i / 4 * TAU); q.neck = 1.1; q.ears = 0.2; q.tail.curl += 0.3 * Math.sin(i / 4 * TAU); }) },
    groom: {
      n: 10, fps: 4, pose: i => edit(SIT, q => {
        const wipe = i >= 5;
        q.feet.FL = GROOM_PAW[i].slice(); q.carp.FL = null; q.over = 'FL';
        q.neck = wipe ? 0.75 : 0.6; q.neckLen = 11; q.headTilt = wipe ? -0.5 + 0.1 * Math.sin(i) : -0.45 + 0.1 * (i % 2);
        q.ears = wipe ? 0.35 : 0.1; q.tongue = !wipe && i % 2 === 0 ? 1 : 0;
      }),
    },
    groomLeg: { n: 8, fps: 4, pose: i => edit(GROOM_LEG, q => { q.headTilt += 0.1 * Math.sin(i / 8 * TAU * 2); q.neckLen += 0.6 * Math.sin(i / 8 * TAU * 2); q.tongue = i % 2 ? 0 : 1; q.feet.HL[1] += 1.2 * Math.sin(i / 8 * TAU); }) },
    legUp: { n: 5, fps: 7, once: true, pose: i => mix(SIT, GROOM_LEG, smooth(i / 4)) },
    stretch: {
      n: 14, fps: 4, once: true, pose: i => {
        const t = i / 13;
        if (t < 0.45) return mix(STAND, BOW, seg(t, 0, 0.25));
        if (t < 0.8) return mix(BOW, HINDSTRETCH, seg(t, 0.45, 0.62));
        return mix(HINDSTRETCH, STAND, seg(t, 0.8, 1));
      },
    },
    loaf: { n: 4, fps: 1.2, pose: i => edit(LOAF, q => { q.H[1] -= 0.4 * Math.sin(i / 4 * TAU); q.S[1] -= 0.3 * Math.sin(i / 4 * TAU); }) },
    // ложится как кошка: сначала садится, потом съезжает передними вперёд
    lieDown: { n: 6, fps: 7, once: true, pose: i => { const t = i / 5; return t <= 0.5 ? mix(STAND, SIT, smooth(t * 2)) : mix(SIT, LOAF, smooth(t * 2 - 1)); } },
    curl: { n: 4, fps: 1, pose: i => edit(CURL, q => { q.arch += 0.4 * Math.sin(i / 4 * TAU); q.H[1] -= 0.3 * Math.sin(i / 4 * TAU); }) },
    curlIn: { n: 5, fps: 5, once: true, pose: i => mix(LOAF, CURL, smooth(i / 4)) },
    sprawl: { n: 4, fps: 1, pose: i => edit(SPRAWL, q => { q.arch -= 0.3 * Math.sin(i / 4 * TAU); q.tail.wave = 0.3 * Math.sin(i / 4 * TAU); }) },
    flop: { n: 5, fps: 7, once: true, pose: i => mix(LOAF, SPRAWL, smooth(i / 4)) },
    roll: {
      n: 6, fps: 3, pose: i => edit(ROLL, q => {
        const w = Math.sin(i / 6 * TAU);
        for (const k of ['FL', 'FR']) q.feet[k][0] += 2 * w;
        for (const k of ['HL', 'HR']) q.feet[k][1] += 1.5 * Math.cos(i / 6 * TAU);
        q.headTilt += 0.12 * w; q.tail.curl = 0.4 + 0.9 * w;
      }),
    },
    rollOver: { n: 5, fps: 8, once: true, pose: i => mix(SPRAWL, ROLL, smooth(i / 4)) },
    boop: { n: 4, fps: 3, pose: i => edit(STAND, q => { q.neck = 0.3; q.neckLen = 14 + 0.8 * Math.sin(i / 4 * TAU); q.headTilt = 0.1; q.tail = TAIL(1.9, -0.9); q.tail.wave = 0.4 * Math.sin(i / 4 * TAU); }) },
    // взаимное вылизывание: один, сидя повыше, лижет другому голову и ухо; тот склоняет голову
    lickOther: { n: 6, fps: 4, pose: i => edit(SIT, q => { q.neck = 0.6; q.neckLen = 14 + Math.sin(i / 6 * TAU * 2); q.headTilt = -0.5 + 0.15 * Math.sin(i / 6 * TAU * 2); q.tongue = i % 2 ? 0 : 1; q.ears = 0; }) },
    groomed: { n: 4, fps: 2, pose: i => edit(SIT, q => { q.neck = 0.95; q.headTilt = -0.4 + 0.04 * Math.sin(i / 4 * TAU); q.ears = 0.3; q.tail.curl += 0.3 * Math.sin(i / 4 * TAU); }) },
  };

  // ---------- рендер ----------
  const SPR = { W: 160, H: 122, OX: 78, OY: 108 };
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
    const g = buildCat(P), A = g.anchors, hp = g.hp, ov = P.over || '';
    const W = Math.ceil(SPR.W * s), H = Math.ceil(SPR.H * s);
    const setT = c => c.setTransform(s, 0, 0, s, SPR.OX * s, SPR.OY * s);
    const out = mk(W, H), o = out.getContext('2d');
    const r = rng(look.seed * 13);
    const whitePaws = (c, list) => {
      if (!look.white.paws) return;
      c.filter = `blur(${0.7 * s}px)`; c.fillStyle = 'rgba(255,252,246,0.92)';
      for (const p of list) { c.beginPath(); trace(c, p.map(q => V(q.x, q.y - 0.5))); c.fill(); }
      c.filter = 'none';
    };
    const shadeGrad = (c, top, bot, a1, a2) => {
      const gr = c.createLinearGradient(0, top, 0, bot);
      gr.addColorStop(0, hexA(look.light, a1)); gr.addColorStop(0.45, hexA(look.light, 0.1));
      gr.addColorStop(0.8, hexA(look.shade, 0.15)); gr.addColorStop(1, hexA(look.shade, a2));
      c.fillStyle = gr; c.fillRect(-SPR.OX, -SPR.OY, SPR.W, SPR.H);
    };
    const layer = (parts, color, deco, edgeA, inkA) => {
      if (!parts.length) return;
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
    // полоски поперёк конечности
    const across = (c, a, b, t, w) => { const p = lerpV(a, b, t), d = unit(sub(b, a)), nn = V(-d.y * w, d.x * w); stripe(c, add(p, nn), add(p, nn, -1), 1.5, look.stripe, 0.45); };
    const legStripes = (c, k) => {
      const L = g.legs[k];
      if (k[0] === 'H') {
        for (const t of [0.3, 0.55, 0.8]) across(c, L.hj, L.knee, t, 7.5 - 3 * t);
        for (const t of [0.3, 0.62]) across(c, L.knee, L.hock, t, 4.4);
      } else for (const t of [0.25, 0.55]) across(c, L.elbow, L.wrist, t, 4);
    };
    const tailLayer = () => layer(g.tailParts, look.base, c => {
      const gr = c.createLinearGradient(0, -40, 0, 0);
      gr.addColorStop(0, hexA(look.light, 0.35)); gr.addColorStop(1, hexA(look.shade, 0.25));
      c.fillStyle = gr; c.fillRect(-SPR.OX, -SPR.OY, SPR.W, SPR.H);
      if (look.tabby) {
        c.filter = `blur(${0.5 * s}px)`;
        for (let i = 3; i < g.tail.length - 1; i += 2) {
          const a = g.tail[i - 1], b = g.tail[i + 1], d = sub(b, a), l = len(d) || 1, nn = V(-d.y / l * 5.4, d.x / l * 5.4);
          stripe(c, add(g.tail[i], nn), add(g.tail[i], nn, -1), 1.6, look.stripe, 0.6);
        }
        c.filter = 'none';
      }
    }, 0.5, 0.5);
    // мышечная масса читается мягкой тенью по её краю (бедро, плечо), как в рисунке с натуры
    const muscleShade = (c, polys, a) => {
      c.filter = `blur(${1.3 * s}px)`;
      c.strokeStyle = hexA(look.shade, a); c.lineWidth = 1.5; c.lineJoin = 'round';
      for (const p of polys) { c.beginPath(); trace(c, p); c.stroke(); }
      c.filter = 'none';
    };

    if (!P.tailFront) tailLayer();
    // дальние лапы и дальнее ухо
    layer(g.far, look.far, c => {
      if (look.tabby) { c.filter = `blur(${0.5 * s}px)`; legStripes(c, 'FR'); legStripes(c, 'HR'); c.filter = 'none'; }
      c.filter = `blur(${0.5 * s}px)`; c.fillStyle = hexA(look.inner, 0.6);
      c.beginPath(); trace(c, A.innerEarF); c.fill(); c.filter = 'none';
      whitePaws(c, g.paws.far);
    }, 0.5, 0.35);

    // корпус и голова
    layer(g.body, look.base, c => {
      shadeGrad(c, A.top, 0, 0.55, 0.45);
      c.filter = `blur(${3 * s}px)`;
      for (let k = 0; k < 8; k++) {
        const x = A.body.x + (r() - 0.5) * 50, y = A.body.y + (r() - 0.5) * 20;
        c.fillStyle = r() < 0.5 ? hexA(look.light, 0.28) : hexA(look.shade, 0.18);
        c.beginPath(); c.arc(x, y, 4 + r() * 7, 0, TAU); c.fill();
      }
      c.filter = 'none';
      const { H: Hh, S: Ss, C: Cc, sg } = g;
      if (look.tabby) {
        // полоски от хребта вниз по бокам, «М» на лбу, стрелки от глаза по щеке
        c.filter = `blur(${0.55 * s}px)`;
        for (let i = 0; i < 8; i++) {
          const t = 0.03 + i * 0.125, p0 = qb(Hh, Cc, Ss, t), d = unit(sub(qb(Hh, Cc, Ss, t + 0.02), p0));
          const back = V(d.y * sg, -d.x * sg), top = add(p0, back, 8);
          stripe(c, top, add(add(top, back, -(10 + (i % 2) * 3.5)), d, -2.4), 2.2, look.stripe, 0.55);
        }
        for (const [a, b] of [[[-0.6, -6], [1, -3.6]], [[1.8, -5.6], [3, -3.6]], [[-3.2, -5.6], [-1.6, -3.4]]]) stripe(c, hp(...a), hp(...b), 1.2, look.stripe, 0.5);
        for (const [a, b] of [[[2.4, -0.6], [-3.4, 0.6]], [[2.6, 1.6], [-3, 3.4]]]) stripe(c, hp(...a), hp(...b), 1.1, look.stripe, 0.45);
        if (!ov.includes('HL')) legStripes(c, 'HL');
        if (!ov.includes('FL')) legStripes(c, 'FL');
        c.filter = 'none';
      }
      muscleShade(c, g.muscles.filter((_, i) => !ov.includes(i ? 'HL' : 'FL')), 0.42);
      // белое: манишка на груди (и живот, когда на спине), мордочка с подбородком
      c.filter = `blur(${1.6 * s}px)`;
      c.fillStyle = `rgba(255,252,246,${0.9 * look.white.chest})`;
      const ch = add(add(Ss, g.uS, 7.5), g.nS, 2.5);
      c.beginPath(); c.ellipse(ch.x, ch.y, 4, 7.5, Math.atan2(g.uS.y, g.uS.x), 0, TAU); c.fill();
      if (g.flip) { const bl = add(lerpV(Hh, Ss, 0.45), g.n, 6); c.beginPath(); c.ellipse(bl.x, bl.y, 13, 4.5, g.ang, 0, TAU); c.fill(); }
      c.filter = `blur(${0.9 * s}px)`;
      c.fillStyle = `rgba(255,252,246,${0.92 * look.white.muzzle})`;
      const mz = hp(6.5, 1.9), mz2 = hp(5.3, 3.6), ha = -(P.headTilt || 0) * sg;
      c.beginPath(); c.ellipse(mz.x, mz.y, 2.9, 2.5, ha, 0, TAU); c.fill();
      c.beginPath(); c.ellipse(mz2.x, mz2.y, 3.4, 1.9, ha, 0, TAU); c.fill();
      c.filter = 'none';
      whitePaws(c, g.paws.near.filter((_, i) => !ov.includes(i ? 'HL' : 'FL')));
    }, 0.55, 0.55);

    // ближние лапы — поверх корпуса, со своим контуром (поднятая лапка)
    layer(g.legsN, look.base, c => {
      shadeGrad(c, A.top, 0, 0.45, 0.4);
      if (look.tabby) { c.filter = `blur(${0.5 * s}px)`; for (const k of ['FL', 'HL']) if (ov.includes(k)) legStripes(c, k); c.filter = 'none'; }
      whitePaws(c, g.paws.near.filter((_, i) => ov.includes(i ? 'HL' : 'FL')));
    }, 0.5, 0.45);
    if (P.tailFront) tailLayer();

    // детали: ухо внутри, нос, рот, язычок, усы
    setT(o);
    o.save();
    o.filter = `blur(${0.5 * s}px)`;
    o.fillStyle = hexA(look.inner, 0.75);
    o.beginPath(); trace(o, A.innerEar); o.fill();
    o.restore();
    if (P.tongue > 0.5) {
      const tg = hp(8.1, 2.8);
      o.fillStyle = '#e07f8a';
      o.beginPath(); o.ellipse(tg.x, tg.y, 1.5, 1, -(P.headTilt || 0) * g.sg + 0.5, 0, TAU); o.fill();
    }
    o.fillStyle = look.nose;
    o.beginPath(); trace(o, [hp(7.4, -1.3), hp(8.2, -0.6), hp(7.9, 0.7), hp(7.2, 0.4)]); o.fill();
    o.strokeStyle = hexA(look.ink, 0.6); o.lineWidth = 0.7; o.lineCap = 'round';
    // рот: от мочки носа вниз и назад к уголку
    const m0 = hp(7.5, 0.8), m1 = hp(7.3, 2.4), m2 = hp(6.2, 3), m3 = hp(5.1, 2.6);
    o.beginPath(); o.moveTo(m0.x, m0.y); o.lineTo(m1.x, m1.y); o.quadraticCurveTo(m2.x, m2.y, m3.x, m3.y); o.stroke();
    o.strokeStyle = hexA(look.ink, 0.4); o.lineWidth = 0.4;
    for (const [a, b, c] of [[[6.9, 1.4], [11, 0.4], [15, 0.6]], [[6.8, 2], [11, 2.6], [14.7, 4]], [[6.5, 2.5], [9.5, 4.6], [12.5, 7]], [[6, 2.2], [2.8, 3.6], [-0.5, 6.4]]]) {
      const [A1, B1, C1] = [a, b, c].map(q => { const p = hp(...q); return g.flip ? p : V(p.x, Math.min(p.y, -0.4)); });
      o.beginPath(); o.moveTo(A1.x, A1.y); o.quadraticCurveTo(B1.x, B1.y, C1.x, C1.y); o.stroke();
    }

    // маска для попадания мышью (половинное разрешение)
    const mw = Math.ceil(W / 2), mh = Math.ceil(H / 2);
    const mc = mk(mw, mh), mcx = mc.getContext('2d', { willReadFrequently: true });
    mcx.drawImage(out, 0, 0, mw, mh);
    const md = mcx.getImageData(0, 0, mw, mh).data, mask = new Uint8Array(mw * mh);
    for (let i = 0; i < mask.length; i++) mask[i] = md[i * 4 + 3];
    return { c: out, mask, mw, mh, s, anchors: A, skel: g.skel };
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
