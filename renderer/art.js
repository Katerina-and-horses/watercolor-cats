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
  // sag — лёжа живот оседает на землю между бёдрами и локтями.
  // Точка лапы в позе — пальцевый сустав (основание пальцев), сами пальцы лежат от него вперёд.
  // flip — лёжа на спине, лапы вверх; headFlip — голова зеркально: затылком на земле, носом вверх. over — ближние лапы, которые рисуются поверх тела своим слоем.
  const SCAP = 10, HUM = 14.2, RAD = 13.1, CARP = 4.7, FEMUR = 15, TIBIA = 16, META = 9.7;
  const FAR = [1.8, -0.8]; // дальние лапы чуть смещены
  const SCAP_TOP = [3, -6.5], SCAP_A = 1.1, SCAP_SWING = 0.4; // лопатка: ~63° к оси груди, качается на ±23°
  const HIP = [-2, 1], ISCH = [-4.6, 1.6]; // тазобедренный сустав от центра таза; седалищный бугор от сустава
  const FY = -1.8; // высота пальцевого сустава стоящей лапы
  // профиль корпуса вдоль позвоночника от таза (t=0) до лопаток (t=1): [t, над осью, под осью]
  const TORSO = [[0, 6.6, 8], [0.18, 7.5, 9.8], [0.42, 7.2, 11.6], [0.68, 6.8, 12.6], [0.86, 8, 12.8], [1, 8.8, 11]];
  // круп за тазом: [назад от таза, наклон вниз, над осью, под осью] — спина скругляется к корню хвоста, а не обрывается углом
  const CROUP = [[8.8, 0.66, 1.3, 2.4], [6.9, 0.58, 3, 4.8], [4.5, 0.45, 4.7, 6.4], [2.2, 0.25, 5.8, 7.3]];
  const TAIL_ROOT = [6.8, 0.6];
  const HS = 1; // масштаб головы
  const NECK = 4.5; // шея от плеч до затылка: голова несётся на шее, а не лежит на груди
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
    const body = [], crisp = [], crispN = [], far = [], legsN = [], paws = { near: [], far: [] }, A = {}, skel = [], inner = [];
    const lift = p => (flip ? p : V(p.x, Math.min(p.y, -2.6)));

    // корпус
    const chain = [], scap = P.scap ?? 0.3;
    const croup = (d, a) => add(add(H, uH, -d * Math.cos(a)), nH, d * Math.sin(a));
    for (const [d, a, top, bot] of CROUP) chain.push([croup(d, a), flip ? bot : top, flip ? top : bot]);
    for (let i = 0; i <= 14; i++) {
      const t = i / 14, top = prof(t, 1) + scap * 1.3 * gauss(t, 0.88, 0.15), bot = prof(t, 2) + (P.sag || 0) * gauss(t, 0.45, 0.32);
      chain.push([qb(H, C, S, t), flip ? bot : top, flip ? top : bot]);
    }
    const rumpC = atH(0.8, 1.6), chestC = atS(1.6, 0.8);
    body.push(limb(chain), ell(rumpC.x, rumpC.y, 5.4, 7.6, Math.atan2(uH.y, uH.x), 20), ell(chestC.x, chestC.y, 8, 9.6, Math.atan2(uS.y, uS.x), 20));
    skel.push([H, C, S]);
    // шерсть: мягкие пряди по краю силуэта — манишка на груди, подшёрсток на животе, щёки, «штаны» на бёдрах
    const tuft = (p, dir, L, w) => { const d = unit(dir), nn = V(-d.y, d.x); return [add(p, nn, w), add(add(p, d, L * 0.55), nn, w * 0.6), add(p, d, L), add(add(p, d, L * 0.5), nn, -w * 0.65), add(p, nn, -w)]; };
    if (!flip) for (let t = 0.2; t < 0.86; t += 0.082) {
      const p = qb(H, C, S, t), d = unit(sub(qb(H, C, S, t + 0.02), p)), dn = V(-d.y, d.x);
      body.push(tuft(add(p, dn, prof(t, 2) - 1.6), add(V(dn.x * 0.8, dn.y * 0.8), d, -0.7), 2.7, 3.4));
    }
    for (const a of [0.15, 0.55, 0.95, 1.35]) {
      const o = add(V(uS.x * Math.cos(a), uS.y * Math.cos(a)), nS, Math.sin(a));
      body.push(tuft(add(chestC, o, 7.2), add(o, nS, 0.7), 2.8, 3.3));
    }

    // шея и голова
    const NB = atS(5, -2.5);
    let Hc = add(NB, dirA(P.neck), P.neckLen + NECK);
    if (Hc.y > -9.8 * HS) Hc = V(Hc.x, -9.8 * HS);
    const ht = P.headTilt || 0, hm = (P.headFlip || 0) > 0.5 ? -1 : 1, hp = (x, y) => add(Hc, rot(V(x * HS * hm, y * HS), ht));
    const hmap = pts => pts.map(p => hp(p.x, p.y));
    const nd = unit(sub(Hc, NB));
    // шея сужается от плеч к затылку: сверху загривок от холки, снизу горло от подбородка к груди
    body.push(limb([[atS(0.5, -0.4), 9, 9.8], [lerpV(NB, Hc, 0.28), 7.8, 8.4], [lerpV(NB, Hc, 0.6), 6.6, 7], [add(Hc, nd, -3), 6.2, 6.2]]));
    // голова повёрнута к зрителю в три четверти — так кошачья морда узнаётся: череп, щёки, мордочка, оба уха и оба глаза
    const head = [hmap(ell(0, 0, 11, 9.6, 0, 24)), hmap(ell(0.1, 3.6, 11.4, 7, 0, 24)), hmap(ell(5.6, 4.6, 5, 3.7, 0, 16))];
    const e = P.ears || 0;
    const ears = [[[-10.3, -3], [-2.6, -9.2], [-9.2, -15.6], [-5, 6]], [[1, -9.7], [9.3, -4.8], [6.6, -15.8], [4.5, 6.5]]].map(([b1, b2, tip, dt]) =>
      ({ b1: P2(b1), b2: P2(b2), t: V(tip[0] + dt[0] * e, tip[1] + dt[1] * e) }));
    for (const E of ears) {
      const out = add(lerpV(E.b1, E.t, 0.5), V(-(E.t.y - E.b1.y), E.t.x - E.b1.x), -0.06);
      head.push(hmap([E.b1, out, E.t, E.t, lerpV(E.t, E.b2, 0.5), E.b2, lerpV(E.b2, E.b1, 0.5)]));
    }
    // пушистые щёки
    for (const [x, y, dx, dy, L] of [[-9.4, 4.4, -1, 0.6, 2.2], [-8.2, 7, -0.8, 0.9, 2.4], [-5.6, 9, -0.4, 1, 1.8], [9.2, 7.2, 0.6, 1, 1.4]]) head.push(tuft(hp(x, y), sub(hp(x + dx, y + dy), hp(x, y)), L * HS, 2.6 * HS));
    crisp.push(...head);
    A.innerEars = ears.map(E => {
      const c = V((E.b1.x + E.b2.x + E.t.x) / 3, (E.b1.y + E.b2.y + E.t.y) / 3 + 0.8);
      return hmap([E.b1, E.t, E.t, E.b2].map(q => lerpV(c, q, 0.58)));
    });

    // пальцы — продолжение пясти/плюсны: на земле лежат плоско, в воздухе следуют за лапой
    const pawAt = (foot, up, rx) => {
      let f = V(-up.y * sg, up.x * sg);
      const w = flip ? 1 : clampN((-foot.y - 2.2) / 4, 0, 1);
      f = unit(lerpV(V(1, 0), f, w));
      const c = add(add(foot, f, 1.5 - 0.5 * w), up, 0.1 + 0.3 * w);
      return { c, f, rx: rx - 0.4 * w, poly: ell(c.x, c.y, rx - 0.4 * w, 2.5, Math.atan2(f.y, f.x), 14) };
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
        // поднятая лапа (свой слой) — тоньше к запястью, а сама лапка крупнее: читается кисть, а не трубка
        const tp = over.includes(k) ? 0.74 : 1;
        parts.push(limb([[add(el, fa, -2.4), 3.4, 3.8], [el, 4, 4.6], [lerpV(el, w, 0.22), 4 * lerp(1, tp, 0.4), 4.1 * lerp(1, tp, 0.4)], [lerpV(el, w, 0.55), 3.4 * tp, 3.4 * tp],
          [lerpV(el, w, 0.85), 2.9 * tp, 3 * tp], [w, 2.9 * tp, 3.2 * tp], [lerpV(w, foot, 0.5), 2.7 * tp, 2.8 * tp], [foot, 2.7, 2.6]]), ell(el.x, el.y, 4.1, 4.1, 0, 12));
        const pw = pawAt(foot, up, tp < 1 ? 4.1 : 3.5);
        paw = pw.poly;
        legs[k] = { paw: pw.c, pawF: pw.f, pawR: pw.rx, foot, elbow: el, wrist: w, sj: SJ, top: T };
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
        const thigh = limb([[add(HJ, fd, -5), 2, 2], [add(HJ, fd, -2.6), 4.6, 4.6], [HJ, 6.2, 6.2], [lerpV(HJ, kn, 0.35), 8.2, 8], [lerpV(HJ, kn, 0.7), 6.8, 7.6],
          [kn, 4.8, 5.6], [add(kn, fd, 1.6), 3.2, 3.8]]);
        parts.push(thigh, limb([[add(kn, sd, -2.4), 3.6, 4.4], [kn, 4, 5.2], [lerpV(kn, hock, 0.24), 3.7, 5.4], [lerpV(kn, hock, 0.52), 3.1, 4.3],
          [lerpV(kn, hock, 0.82), 2.6, 3], [hock, 2.7, 3.5], [lerpV(hock, foot, 0.3), 2.6, 2.8], [lerpV(hock, foot, 0.7), 2.5, 2.5], [foot, 2.6, 2.6]]),
          ell(kn.x, kn.y, 4.5, 4.5, 0, 12));
        // задняя группа мышц бедра: от седалищного бугра к икре — сзади нога идёт плавной линией, а не зигзагом
        const PB = add(atH(HIP[0] + ISCH[0], HIP[1] + ISCH[1]), off), calf = add(lerpV(kn, hock, 0.3), V(-sd.y, sd.x), 4.4 * sg), heel = add(lerpV(kn, hock, 0.8), V(-sd.y, sd.x), 2.6 * sg);
        if (!flip && (calf.x - kn.x) * uH.x + (calf.y - kn.y) * uH.y < 0) parts.push([HJ, PB, add(lerpV(PB, heel, 0.35), uH, -0.7), add(lerpV(PB, heel, 0.7), uH, 1), heel, lerpV(kn, hock, 0.6), kn]);
        const pw = pawAt(foot, mv, 3.7);
        paw = pw.poly;
        legs[k] = { paw: pw.c, pawF: pw.f, pawR: pw.rx, foot, knee: kn, hock, hj: HJ };
        if (!farLeg) muscles.push(thigh);
        skel.push([HJ, kn, hock, foot]);
      }
      if (farLeg) far.push(...inner2, ...parts, paw);
      else if (over.includes(k)) { body.push(...inner2); legsN.push(...parts); crispN.push(paw); }
      else { body.push(...inner2, ...parts); crisp.push(paw); }
      (farLeg ? paws.far : paws.near).push(paw);
    }

    // хвост: от корня над седалищными буграми, сужается к кончику, не уходит под землю
    const tail = [];
    let tp = croup(TAIL_ROOT[0], TAIL_ROOT[1]), th = P.tail.a;
    const TN = 14, TL = P.tail.len || 38;
    const tw = i => 3.6 + 1.5 * Math.sin(Math.PI * Math.pow(i / TN, 0.7)) - 1.2 * Math.pow(i / TN, 3); // пушистый: шире к середине, к кончику у́же
    tail.push(tp);
    for (let i = 1; i <= TN; i++) {
      const t = i / TN;
      th += P.tail.curl / TN + (P.tail.wave || 0) * Math.cos(t * Math.PI * 1.5 + (P.tail.ph || 0)) * 0.14 * t;
      tp = add(tp, dirA(th), TL / TN);
      if (tp.y > -tw(i) - 0.2) tp = V(tp.x, -tw(i) - 0.2);
      tail.push(tp);
    }
    const tip = tail[TN];
    const tailParts = [limb(tail.map((p, i) => [p, tw(i), tw(i)])), ell(tip.x, tip.y, 2.4, 2.4, 0, 12)];

    // на земле силуэт ложится плоско
    for (const poly of tailParts) for (const p of poly) if (p.y > -0.1) p.y = -0.1;
    for (const list of [body, crisp, crispN, far, legsN]) for (const poly of list) for (const p of poly) if (p.y > -0.1) p.y = -0.1;

    A.head = Hc;
    A.eyeN = hp(-1.4, -0.6); A.eyeF = hp(6.4, -1); A.eyeAng = -ht;
    A.eyes = [[A.eyeN, 2.7 * HS, 2.5 * HS], [A.eyeF, 2.3 * HS, 2.3 * HS]];
    A.mouth = hp(6.3, 5.2);
    A.paw = legs.FL.paw;
    A.top = Math.min(...head.flat().map(p => p.y), ...chain.map(c => c[0].y - c[1]));
    A.body = lerpV(H, S, 0.5);
    return { H, S, C, u, n: V(n.x * sg, n.y * sg), uS, nS, ang: Math.atan2(u.y, u.x), hp, body, crisp, crispN, far, legsN, paws, tail, tailParts, legs, muscles, skel, anchors: A, flip, sg };
  }

  // ---------- позы ----------
  // стоя: спина ровная, круп на уровне холки, голова над линией спины; хвост расслаблен — вниз и кончиком вверх
  const TAIL = (a, curl, len = 38) => ({ a, curl, wave: 0, ph: 0, len });
  const STAND = {
    H: [-17, -35.2], S: [15, -32], arch: 0.8, scap: 0.3, flip: 0,
    feet: { FL: [18, FY], FR: [23.5, FY], HL: [-21, FY], HR: [-15, FY] }, meta: { HL: 0.47, HR: 0.47 }, carp: { FL: 0.3, FR: 0.3 },
    neck: 0.98, neckLen: 12.5, headTilt: 0.04, ears: 0, tongue: 0,
    tail: TAIL(3.5, -1.3), tailFront: 0,
  };
  // сидя: круп на земле, плюсны лежат, колени подняты к животу, передние прямые, хвост обвивает лапки
  const SIT = {
    H: [-10, -10.5], S: [7, -32], arch: 4.5, scap: 0.1, flip: 0,
    feet: { FL: [12, FY], FR: [15.5, FY], HL: [3, FY], HR: [6, FY] }, meta: { HL: 1.5, HR: 1.5 }, carp: { FL: 0.2, FR: 0.2 },
    neck: 1.25, neckLen: 12, headTilt: 0.04, ears: 0, tongue: 0,
    tail: TAIL(4.3, 2.2, 34), tailFront: 1,
  };
  // «буханка»: лежит на груди, предплечья и плюсны на земле
  const LOAF = {
    H: [-13, -12.4], S: [10, -14], arch: 3.2, sag: 4, scap: 0.2, flip: 0,
    feet: { FL: [17, FY], FR: [19.5, FY], HL: [-2, FY], HR: [1, FY] }, meta: { HL: 1.5, HR: 1.5 }, carp: { FL: 1.45, FR: 1.45 },
    neck: 1.05, neckLen: 9, headTilt: 0.04, ears: 0.05, tongue: 0,
    tail: TAIL(4.5, 2, 34), tailFront: 1,
  };
  // спит клубком: спина круглым куполом, голова уткнута вниз к лапам, хвост укрывает нос
  const CURL = {
    H: [-10, -11.6], S: [8, -12], arch: 6.5, sag: 5, scap: 0, flip: 0,
    feet: { FL: [14, FY], FR: [16, FY], HL: [2, FY], HR: [4, FY] }, meta: { HL: 1.5, HR: 1.5 }, carp: { FL: 1.45, FR: 1.45 },
    neck: -0.55, neckLen: 8.5, headTilt: -0.5, ears: 0.3, tongue: 0,
    tail: TAIL(4.5, 1.9, 40), tailFront: 1,
  };
  // лежит, вытянув передние лапы вперёд и уложив на них голову; задние поджаты, круп и живот на земле
  const SPRAWL = {
    H: [-17, -11.6], S: [10, -11.4], arch: 2, sag: 4, scap: 0.5, flip: 0,
    feet: { FL: [33, FY], FR: [36, FY], HL: [-6, FY], HR: [-3, FY] }, meta: { HL: 1.5, HR: 1.5 }, carp: { FL: 1.5, FR: 1.5 },
    neck: 0.02, neckLen: 9.5, headTilt: 0.1, ears: 0.15, tongue: 0,
    tail: TAIL(3.3, -0.35), tailFront: 0,
  };
  // на спине пузом вверх: затылок на земле, нос кверху, лапки согнуты над грудью и животом
  const ROLL = {
    H: [-16, -11.5], S: [13, -12.5], arch: -1.5, scap: 0, flip: 1, headFlip: 1,
    feet: { FL: [21, -37], FR: [16, -34], HL: [-9, -38], HR: [-15, -35] }, meta: { HL: 2.5, HR: 2.5 }, carp: { FL: 2.1, FR: 2.1 },
    neck: 0.02, neckLen: 10.5, headTilt: -1.15, ears: 0.15, tongue: 0,
    tail: TAIL(3.25, 0.25), tailFront: 0,
  };
  // припала к земле перед прыжком: лопатки выше спины, лапы под собой
  const CROUCH = {
    H: [-14, -26], S: [14, -19], arch: 1.2, scap: 1.4, flip: 0,
    feet: { FL: [21, FY], FR: [24, FY], HL: [-12, FY], HR: [-9, FY] }, meta: { HL: 0.95, HR: 0.95 }, carp: { FL: 0.6, FR: 0.6 },
    neck: 0.22, neckLen: 11, headTilt: 0.05, ears: 0.25, tongue: 0,
    tail: TAIL(3.2, 0.15), tailFront: 0,
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
  const WALKB = edit(STAND, q => { q.feet.FL[0] = 18; q.feet.HL[0] = -20; q.H[1] = -34.2; q.S[1] = -31; q.neck = 0.72; q.headTilt = 0.03; q.tail = TAIL(3.3, -0.9); });
  const WALKUPB = edit(WALKB, q => { q.neck = 0.9; q.headTilt = 0.06; q.tail = TAIL(1.95, -0.9); });
  // крадётся: низко на согнутых, лопатки выше спины, голова вытянута вперёд на уровне спины
  const STALKB = edit(STAND, q => {
    q.feet.FL[0] = 18; q.feet.HL[0] = -20; q.H = [-17, -28.6]; q.S = [15, -25.5]; q.arch = -0.4; q.scap = 1.5; q.neck = 0.18; q.neckLen = 12.5; q.headTilt = 0.05; q.ears = 0.2;
    q.meta = { HL: 0.8, HR: 0.8 }; q.carp = { FL: 0.6, FR: 0.6 };
    q.tail = TAIL(3.25, -0.2);
  });
  // Галоп по фазам: задние ставятся далеко под живот (спина дугой) и толкают → вытянутый полёт (передние вперёд,
  // задние назад, спина прямая и длинная) → приземление на передние, тело проходит над ними → сбор в полёте: задние
  // подтягиваются под живот. В опоре лапа стоит на месте: путь под телом = опора * длина цикла (скорость RUN).
  const RUN_N = 32, RUN_FPS = 60, RUN_ST = 0.33, RUN_PATH = RUN_ST * 135 * RUN_N / RUN_FPS;
  const RUNB = edit(STAND, q => { q.ears = 0.4; q.scap = 0.6; q.tail = TAIL(3.05, 0.25); });
  // td — где лапа ставится; a — угол плюсны/пясти в начале и конце опоры; sw — углы в переносе: [доля, угол].
  // Перенос — плавная дуга: на отрыве лапа ещё идёт назад со скоростью опоры (k0 — во сколько раз быстрее: задние
  // после толчка вытягиваются назад), к постановке уже идёт назад вместе с землёй (k1: передние перед этим
  // выносятся вперёд). Скорость лапы на отрыве и постановке не скачет — бег не дёргается.
  const RUNK = {
    H: { td: -6, k0: 1.9, k1: 1, lift: 11, skew: 0.8, a: [0.95, -0.55], sw: [[0.2, -1.3], [0.5, 0.3], [0.82, 0.85]] },
    F: { td: 33, k0: 1, k1: 1.8, lift: 15, skew: 1.1, a: [0.4, -0.35], sw: [[0.22, -1.2], [0.52, -0.8], [0.82, 0.2]] },
  };
  const cr = (p0, p1, p2, p3, u) => 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);
  function runLeg(K, p) {
    const lo = K.td - RUN_PATH, aEnd = K.a[1] - 0.3;
    if (p < RUN_ST) { const s = p / RUN_ST; return [K.td - RUN_PATH * s, FY, lerp(K.a[0], K.a[1], s) - 0.3 * seg(s, 0.7, 1)]; }
    const s = (p - RUN_ST) / (1 - RUN_ST), s2 = s * s, s3 = s2 * s, v = RUN_PATH / RUN_ST * (1 - RUN_ST);
    const x = (2 * s3 - 3 * s2 + 1) * lo - (s3 - 2 * s2 + s) * v * K.k0 + (3 * s2 - 2 * s3) * K.td - (s3 - s2) * v * K.k1;
    const y = FY - K.lift * Math.sin(Math.PI * Math.pow(s, K.skew)) ** 1.5;
    const pts = [[0, aEnd], ...K.sw, [1, K.a[0]]];
    let i = 0;
    while (i < pts.length - 2 && s > pts[i + 1][0]) i++;
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[i + 1], d = pts[Math.min(pts.length - 1, i + 2)];
    return [x, y, cr(a[1], b[1], c[1], d[1], (s - b[0]) / (c[0] - b[0]))];
  }
  function runPose(i, n) {
    const ph = i / n, q = clone(RUNB), offs = { HL: 0, HR: 0.1, FL: 0.5, FR: 0.61 }, wave = c => Math.cos(TAU * (ph - c));
    for (const k in offs) {
      const fr = k[0] === 'F', [x, y, a] = runLeg(RUNK[k[0]], ((ph - offs[k]) % 1 + 1) % 1);
      q.feet[k] = [x + (k[1] === 'R' ? FAR[0] : 0), y];
      (fr ? q.carp : q.meta)[k] = a;
    }
    // ext: +1 — вытянутый полёт, −1 — сбор
    const ext = wave(0.43);
    q.H[0] = -17 - 1.5 * ext; q.S[0] = 15 + 1.5 * ext; q.arch = 1.6 - 3 * ext;
    // корпус качается плавно: круп ниже всего на опоре задних, грудь — на опоре передних; в полётах тело чуть выше
    const up = 1 * Math.cos(2 * TAU * (ph - 0.46));
    q.H[1] = -33.4 + 2 * wave(0.2) - up; q.S[1] = -31.2 + 2 * wave(0.72) - up;
    // голова держится ровно: шея отыгрывает качку груди
    q.neck = 0.34 - 0.1 * ext + 0.07 * wave(0.72); q.neckLen = 12.5 + 1 * ext; q.headTilt = 0.02 + 0.05 * ext;
    q.tail.a = 3.05 + 0.18 * ext; q.tail.wave = 0.35 * Math.sin(ph * TAU);
    return q;
  }
  const POUNCE = [
    edit(CROUCH, q => { q.H = [-14, -22]; q.ears = 0.45; }),
    // толчок: задние лапы почти выпрямлены и ещё на земле, тело вытянуто вперёд-вверх
    edit(CROUCH, q => { q.H = [-14, -27.5]; q.S = [17, -37]; q.arch = 0; q.feet = { FL: [42, -24], FR: [38, -21], HL: [-44, FY], HR: [-41, FY] }; q.meta = { HL: -0.55, HR: -0.55 }; q.carp = { FL: null, FR: null }; q.neck = 0.45; q.ears = 0.45; q.tail = TAIL(3.3, 0.1); }),
    edit(CROUCH, q => { q.H = [-17, -30]; q.S = [16, -32]; q.arch = -1; q.feet = { FL: [48, -27], FR: [45, -24], HL: [-50, -9], HR: [-52, -6] }; q.meta = { HL: -1.0, HR: -1.0 }; q.carp = { FL: null, FR: null }; q.neck = 0.4; q.ears = 0.5; q.tail = TAIL(2.45, 0.5); }),
    edit(CROUCH, q => { q.H = [-17, -29]; q.S = [15, -25]; q.arch = 1.5; q.feet = { FL: [40, -7], FR: [37, -5], HL: [-48, -10], HR: [-50, -7] }; q.meta = { HL: -1.0, HR: -1.0 }; q.carp = { FL: null, FR: null }; q.neck = 0.3; q.ears = 0.45; q.tail = TAIL(2.4, 0.6); }),
    edit(CROUCH, q => { q.H = [-15, -27]; q.S = [15, -20]; q.arch = 2.5; q.feet = { FL: [32, FY], FR: [29, FY], HL: [-22, -6], HR: [-25, -4.5] }; q.meta = { HL: 0.35, HR: 0.35 }; q.ears = 0.35; }),
    edit(CROUCH, q => { q.feet.FL = [29, FY]; q.feet.FR = [26, FY]; q.ears = 0.3; }),
  ];
  const BAT_PAW = [[20, FY], [24, -14], [29, -18], [34, -8], [32, -2.4], [26, -5]];
  const BAT_CARP = [0.5, -0.3, 1.0, 0.5, 0.5, 0.2]; // запястье согнуто: лапка замахивается и шлёпает сверху
  // умывание передней лапой: лизнуть подушечку (голова к лапе) и провести лапой по уху и щеке
  const GROOM_PAW = [[25.5, -30], [25.5, -28.5], [25.5, -30], [25.5, -28.5], [25.5, -30], [27.5, -38], [23.5, -45], [17.5, -48], [21.5, -39], [25.5, -31]];
  // «виолончель»: сидя на бедре, задняя лапа задрана вверх, голова к животу и внутренней стороне бедра
  const GROOM_LEG = edit(SIT, q => {
    q.H = [-7, -9.4]; q.S = [-2, -27]; q.arch = 4.5;
    q.feet.HL = [3, -52]; q.meta.HL = Math.PI; q.feet.HR = [5, FY]; q.over = 'HL';
    q.feet.FL = [9, FY]; q.feet.FR = [12, FY];
    q.neck = -0.25; q.neckLen = 7.5; q.headTilt = -0.75; q.ears = 0.15; q.tongue = 1;
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
    bat: { n: 6, fps: 9, strike: 3, pose: i => edit(BAT, q => { q.feet.FL = BAT_PAW[i].slice(); q.carp.FL = BAT_CARP[i]; q.over = 'FL'; q.headTilt = -0.05 + 0.08 * Math.sin(i / 6 * TAU); q.tail.wave = 0.6 * Math.sin(i / 6 * TAU); }) },
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
        q.headTilt += 0.12 * w; q.tail.curl = 0.25 + 0.5 * w;
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
  // Силуэт собран из многих масс; на стыках остаются зубцы и ступеньки. Сглаживаем по альфе: размытие и порог
  // посередине — впадины заливаются, углы скругляются, прямые края остаются на месте.
  const SOFT = 1.5;
  function soften(cv, s) {
    const W = cv.width, H = cv.height, t = mk(W, H), c = t.getContext('2d', { willReadFrequently: true });
    c.filter = `blur(${SOFT * s}px)`; c.drawImage(cv, 0, 0); c.filter = 'none';
    const im = c.getImageData(0, 0, W, H), d = im.data;
    for (let i = 3; i < d.length; i += 4) d[i] = Math.max(0, Math.min(255, (d[i] - 112) * 8));
    c.putImageData(im, 0, 0);
    return t;
  }
  // тушь по краю сглаженного силуэта
  function inkContour(o, mask, ink, s, alpha, W, H) {
    const c = mk(W, H), ic = c.getContext('2d'), r = 0.85 * s;
    for (let i = 0; i < 10; i++) ic.drawImage(mask, Math.cos(i / 10 * TAU) * r, Math.sin(i / 10 * TAU) * r);
    ic.globalCompositeOperation = 'source-in';
    ic.fillStyle = ink; ic.fillRect(0, 0, W, H);
    ic.globalCompositeOperation = 'destination-out';
    ic.drawImage(mask, 0, 0);
    o.save(); o.setTransform(1, 0, 0, 1, 0, 0); o.globalAlpha = alpha; o.drawImage(c, 0, 0); o.restore();
  }
  // клиновидная изогнутая полоска: от a через изгиб m к острию b
  function wedge(c, a, m, b, w, color, alpha) {
    const L = [], R = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, p = qb(a, m, b, t), q = qb(a, m, b, Math.min(1, t + 0.05)), o = qb(a, m, b, Math.max(0, t - 0.05));
      const d = unit(sub(q, o)), hw = w * 0.5 * (0.35 + 0.65 * Math.sin(Math.PI * Math.pow(t, 0.6))) * (1 - t * t * 0.85);
      L.push(V(p.x - d.y * hw, p.y + d.x * hw)); R.push(V(p.x + d.y * hw, p.y - d.x * hw));
    }
    c.fillStyle = hexA(color, alpha); c.beginPath(); trace(c, L.concat(R.reverse())); c.fill();
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
    const layer = (parts, color, deco, edgeA, inkA, crisp = [], o2 = o) => {
      if (!parts.length) return;
      const cv = mk(W, H), c = cv.getContext('2d');
      setT(c);
      c.fillStyle = '#000'; fillEach(c, parts);
      const m = soften(cv, s);
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, W, H); c.drawImage(m, 0, 0);
      if (crisp.length) { const mc = m.getContext('2d'); setT(mc); mc.fillStyle = '#000'; fillEach(mc, crisp); c.drawImage(m, 0, 0); }
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = color; c.fillRect(0, 0, W, H);
      setT(c);
      c.globalCompositeOperation = 'source-atop';
      if (deco) deco(c);
      c.globalCompositeOperation = 'source-over';
      washify(cv, look.shade, s, edgeA, 0.45);
      o2.setTransform(1, 0, 0, 1, 0, 0);
      o2.drawImage(cv, 0, 0);
      inkContour(o2, m, look.ink, s, inkA, W, H);
    };
    // полоски поперёк конечности
    const across = (c, a, b, t, w) => { const p = lerpV(a, b, t), d = unit(sub(b, a)), nn = V(-d.y * w, d.x * w); stripe(c, add(p, nn), add(p, nn, -1), 1.3, look.stripe, 0.3); };
    const legStripes = (c, k) => {
      const L = g.legs[k];
      if (k[0] === 'H') {
        for (const t of [0.35, 0.65]) across(c, L.hj, L.knee, t, 7 - 3 * t);
        across(c, L.knee, L.hock, 0.45, 4);
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
        const sr = rng(look.seed * 7 + 3);
        for (let i = 0; i < 11; i++) {
          const t = 0.02 + i * 0.094 + (sr() - 0.5) * 0.02, p0 = qb(Hh, Cc, Ss, t), d = unit(sub(qb(Hh, Cc, Ss, t + 0.02), p0));
          const back = V(d.y * sg, -d.x * sg), top = add(p0, back, prof(clampN(t, 0, 1), 1) + 1);
          // длинные через одну, изгиб выпуклостью к голове — как рёбра
          const L = (i % 2 ? 8.5 : 14) + sr() * 3, lean = -3.2 - sr() * 1.5;
          wedge(c, top, add(add(top, back, -L * 0.55), d, 1.3), add(add(top, back, -L), d, lean), 2.5, look.stripe, 0.5);
        }
        // тёмный ремень по хребту
        c.strokeStyle = hexA(look.stripe, 0.3); c.lineWidth = 2.4; c.lineCap = 'round'; c.beginPath();
        for (let i = 0; i <= 10; i++) { const t = i / 10, p0 = qb(Hh, Cc, Ss, t), d = unit(sub(qb(Hh, Cc, Ss, t + 0.02), p0)), q = add(p0, V(d.y * sg, -d.x * sg), prof(t, 1) - 0.6); i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); }
        c.stroke();
        for (const [a, b] of [[[-1, -9], [-0.6, -4.8]], [[2.6, -9.4], [2.8, -5.2]], [[-4.2, -8.3], [-3.4, -4.9]], [[5.8, -8.5], [5.4, -5.4]]]) stripe(c, hp(...a), hp(...b), 1.3, look.stripe, 0.55);
        for (const [a, b] of [[[-6, 1.6], [-10.5, 0.6]], [[-5.6, 4], [-10.5, 4.6]]]) stripe(c, hp(...a), hp(...b), 1.2, look.stripe, 0.5);
        if (!ov.includes('HL')) legStripes(c, 'HL');
        if (!ov.includes('FL')) legStripes(c, 'FL');
        c.filter = 'none';
      }
      muscleShade(c, g.muscles.filter((_, i) => !ov.includes(i ? 'HL' : 'FL')), 0.28);
      // белое: манишка на груди (и живот, когда на спине), мордочка с подбородком
      c.filter = `blur(${1.6 * s}px)`;
      c.fillStyle = `rgba(255,252,246,${0.9 * look.white.chest})`;
      const thr = hp(1.5, 9), cp = add(add(Ss, g.uS, 8.2), g.nS, 1.5);
      c.beginPath(); trace(c, capsule(thr, 4.4, cp, 3.2, 6)); c.fill();
      if (g.flip) { const bl = add(lerpV(Hh, Ss, 0.45), g.n, 6); c.beginPath(); c.ellipse(bl.x, bl.y, 13, 4.5, g.ang, 0, TAU); c.fill(); }
      c.filter = `blur(${0.9 * s}px)`;
      c.fillStyle = `rgba(255,252,246,${0.92 * look.white.muzzle})`;
      const mz = hp(5.6, 5), mz2 = hp(2.5, 6.4), ha = -(P.headTilt || 0);
      c.beginPath(); c.ellipse(mz.x, mz.y, 5.2 * HS, 3.6 * HS, ha, 0, TAU); c.fill();
      c.beginPath(); c.ellipse(mz2.x, mz2.y, 5.4 * HS, 3 * HS, ha, 0, TAU); c.fill();
      c.filter = 'none';
      whitePaws(c, g.paws.near.filter((_, i) => !ov.includes(i ? 'HL' : 'FL')));
    }, 0.55, 0.55, g.crisp);

    // ближние лапы — поверх корпуса, со своим контуром (поднятая лапка); слой отдаётся и отдельно (over):
    // глаза рисуются поверх кадра, и лапу, закрывающую морду, кладут ещё раз поверх глаз
    const over = g.legsN.length ? mk(W, H) : null;
    if (over) layer(g.legsN, look.base, c => {
      shadeGrad(c, A.top, 0, 0.45, 0.4);
      if (look.tabby) { c.filter = `blur(${0.5 * s}px)`; for (const k of ['FL', 'HL']) if (ov.includes(k)) legStripes(c, k); c.filter = 'none'; }
      whitePaws(c, g.paws.near.filter((_, i) => ov.includes(i ? 'HL' : 'FL')));
    }, 0.5, 0.45, g.crispN, over.getContext('2d'));
    if (over) { o.setTransform(1, 0, 0, 1, 0, 0); o.drawImage(over, 0, 0); }
    if (P.tailFront) tailLayer();

    // детали: уши внутри, нос, рот, язычок, усы
    setT(o);
    o.save();
    o.filter = `blur(${0.5 * s}px)`;
    o.fillStyle = hexA(look.inner, 0.75);
    for (const p of A.innerEars) { o.beginPath(); trace(o, p); o.fill(); }
    o.restore();
    o.strokeStyle = hexA(look.ink, 0.4); o.lineWidth = 0.45; o.lineCap = 'round';
    for (const k of ['FL', 'HL']) {
      const L = g.legs[k], f = L.pawF, nn = V(-f.y, f.x);
      for (const d of [-0.2, 0.75]) {
        const a = add(add(L.paw, f, L.pawR * 0.86), nn, d), b = add(add(L.paw, f, L.pawR * 0.42), nn, d + 0.9);
        line(o, add(a, nn, 0.2), b);
      }
    }
    if (P.tongue > 0.5) {
      const tg = hp(6.4, 6.3);
      o.fillStyle = '#e07f8a';
      o.beginPath(); o.ellipse(tg.x, tg.y, 1.5 * HS, 1.15 * HS, -(P.headTilt || 0), 0, TAU); o.fill();
    }
    o.fillStyle = look.nose;
    o.beginPath(); trace(o, [hp(4.8, 1.6), hp(7.8, 1.6), hp(6.3, 3.3)]); o.fill();
    o.strokeStyle = hexA(look.ink, 0.6); o.lineWidth = 0.7; o.lineCap = 'round';
    o.beginPath();
    const n0 = hp(6.3, 3.2), n1 = hp(6.3, 4.4);
    o.moveTo(n0.x, n0.y); o.lineTo(n1.x, n1.y);
    for (const [qq, ee] of [[[5.3, 5.6], [4, 4.2]], [[7.3, 5.6], [8.6, 4.2]]]) { // уголки рта приподняты
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
    return { c: out, over, mask, mw, mh, s, anchors: A, skel: g.skel };
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
