// Запуск: NODE_PATH=<папка>/node_modules node tools/check.js renderer/art.js
// числом: лапа в опоре попадает в цель (IK не упирается в предел), шаг всех лап равен, суставы не уходят под землю
const fs = require('fs'), vm = require('vm'); const { createCanvas } = require('@napi-rs/canvas');
const ctx = { document: { createElement: () => createCanvas(1, 1) }, console, Math }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8') + '\nthis.Art = Art;', ctx); const Art = ctx.Art;
const K = ['FL', 'FR', 'HL', 'HR'];
for (const name of ['walk', 'walkUp', 'stalk', 'run']) {
  const a = Art.ANIMS[name]; let miss = 0, low = 0; const xs = { FL: [], FR: [], HL: [], HR: [] }; let ang = { elbow: [9, 0], knee: [9, 0], hock: [9, 0] };
  for (let i = 0; i < a.n; i++) {
    const P = a.pose(i), f = Art.renderFrame(P, Art.LOOKS.ginger, 0.5);
    K.forEach((k, j) => {
      const ch = f.skel[j + 1], ft = ch[ch.length - 1], t = P.feet[k];
      miss = Math.max(miss, Math.hypot(ft.x - t[0], ft.y - t[1]));
      if (t[1] > -1.9) xs[k].push(t[0]);
      for (const p of ch) low = Math.max(low, p.y);
      const A3 = (p, q, r) => Math.acos(((p.x - q.x) * (r.x - q.x) + (p.y - q.y) * (r.y - q.y)) / Math.hypot(p.x - q.x, p.y - q.y) / Math.hypot(r.x - q.x, r.y - q.y)) * 180 / Math.PI;
      const upd = (n, v) => { ang[n][0] = Math.min(ang[n][0] === 9 ? 999 : ang[n][0], v); ang[n][1] = Math.max(ang[n][1], v); };
      if (k[0] === 'F') upd('elbow', A3(ch[1], ch[2], ch[3])); else { upd('knee', A3(ch[0], ch[1], ch[2])); upd('hock', A3(ch[1], ch[2], ch[3])); }
    });
  }
  const step = K.map(k => (Math.max(...xs[k]) - Math.min(...xs[k])).toFixed(1));
  console.log(name, 'промах лапы макс', miss.toFixed(2), '| путь в опоре', step.join('/'), '| ниже земли', low.toFixed(2),
    '| локоть', ang.elbow.map(v => v.toFixed(0)).join('–'), 'колено', ang.knee.map(v => v.toFixed(0)).join('–'), 'скакат.', ang.hock.map(v => v.toFixed(0)).join('–'));
}
