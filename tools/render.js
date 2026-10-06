// Локальный рендер кадров без Electron. Нужен @napi-rs/canvas: npm i @napi-rs/canvas в любую временную папку и NODE_PATH=<папка>/node_modules
// node render.js <art.js> <out.png> <scale> <cols> spec... ; spec = look:anim:frame | look:anim:* (все кадры) ; SKEL=1 — суставы поверх
const fs = require('fs'), vm = require('vm');
const { createCanvas } = require('@napi-rs/canvas');
const [artPath, out, sS, cS, ...specs] = process.argv.slice(2);
const s = +sS, cols = +cS;
const ctx = { document: { createElement: () => createCanvas(1, 1) }, console, Math };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(artPath, 'utf8') + '\nthis.Art = Art;', ctx);
const Art = ctx.Art, SPR = Art.SPR;
const list = [];
for (const sp of specs) {
  const [look, anim, fr] = sp.split(':');
  const a = Art.ANIMS[anim];
  if (!a) { console.error('нет анимации', anim); continue; }
  if (fr === '*') for (let i = 0; i < a.n; i++) list.push([look, anim, i]);
  else if (fr.startsWith('/')) for (let i = 0; i < a.n; i += +fr.slice(1)) list.push([look, anim, i]);
  else list.push([look, anim, +fr]);
}
const cw = Math.ceil(SPR.W * s), ch = Math.ceil(SPR.H * s), rows = Math.ceil(list.length / cols);
const sheet = createCanvas(cols * cw, rows * ch), g = sheet.getContext('2d');
g.fillStyle = '#f4efe6'; g.fillRect(0, 0, sheet.width, sheet.height);
function eyes(g, look, a, closed) {
  for (const [p, rx, ry] of [[a.eyeN, a.eyeRN || 2.5, 2.2], [a.eyeF, a.eyeRF || 2.15, 2.05]]) {
    if (!p) continue;
    g.save(); g.translate(p.x, p.y); g.rotate(a.eyeAng || 0);
    if (!closed) {
      g.fillStyle = look.iris; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 7); g.fill();
      g.strokeStyle = Art.hexA(look.ink, 0.8); g.lineWidth = 0.55; g.stroke();
      g.fillStyle = '#1d1512'; g.beginPath(); g.ellipse(rx * 0.12, 0, rx * 0.35, ry * 0.9, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(rx * 0.3, -ry * 0.4, 0.6, 0, 7); g.fill();
    } else {
      g.strokeStyle = look.ink; g.lineWidth = 0.75; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-rx, -0.2); g.quadraticCurveTo(0, 1.4, rx, -0.2); g.stroke();
    }
    g.restore();
  }
}
list.forEach(([lk, anim, i], j) => {
  const look = Art.LOOKS[lk], P = Art.ANIMS[anim].pose(i), f = Art.renderFrame(P, look, s);
  const x = (j % cols) * cw, y = Math.floor(j / cols) * ch;
  g.drawImage(f.c, x, y);
  g.save(); g.translate(x + SPR.OX * s, y + SPR.OY * s); g.scale(s, s);
  eyes(g, look, f.anchors, ['curl', 'curlIn', 'sleep'].includes(anim));
  g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = 0.3; g.beginPath(); g.moveTo(-SPR.OX, 0); g.lineTo(SPR.W - SPR.OX, 0); g.stroke();
  if (process.env.SKEL && f.skel) {
    g.strokeStyle = 'rgba(0,90,255,0.9)'; g.lineWidth = 0.6; g.fillStyle = 'rgba(255,0,0,0.9)';
    for (const ch of f.skel) { g.beginPath(); ch.forEach((p, q) => q ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); for (const p of ch) { g.beginPath(); g.arc(p.x, p.y, 0.8, 0, 7); g.fill(); } }
  }
  g.restore();
  g.fillStyle = '#555'; g.font = `${Math.max(10, 5 * s)}px sans-serif`; g.fillText(`${anim} ${i}`, x + 4, y + 12 + 2 * s);
});
fs.writeFileSync(out, sheet.toBuffer('image/png'));
console.log(out, sheet.width + 'x' + sheet.height, list.length, 'кадров');
