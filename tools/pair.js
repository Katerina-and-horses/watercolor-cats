// Два котика лицом друг к другу — проверка дистанций «нос к носу» и вылизывания. Нужен @napi-rs/canvas (NODE_PATH).
// node tools/pair.js <art.js> <out.png> <масштаб> <animA:кадр> <animB:кадр> <дистанция> ...
const fs = require('fs'), vm = require('vm'); const { createCanvas } = require('@napi-rs/canvas');
const [artPath, out, sS, ...rest] = process.argv.slice(2), s = +sS;
const ctx = { document: { createElement: () => createCanvas(1, 1) }, console, Math }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(artPath, 'utf8') + '\nthis.Art = Art;', ctx); const Art = ctx.Art, S = Art.SPR;
const n = rest.length / 3, CW = 260, c = createCanvas(CW * s * n, 130 * s), g = c.getContext('2d');
g.fillStyle = '#f4efe6'; g.fillRect(0, 0, c.width, c.height);
const eyes = (look, a, closed) => { for (const [p, rx, ry] of a.eyes) { g.save(); g.translate(p.x, p.y); g.rotate(a.eyeAng || 0);
  g.fillStyle = look.iris; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 7); g.fill(); g.strokeStyle = Art.hexA(look.ink, 0.8); g.lineWidth = 0.55; g.stroke();
  g.fillStyle = '#1d1512'; g.beginPath(); g.ellipse(rx * 0.1, 0, rx * 0.3, ry * 0.9, 0, 0, 7); g.fill(); g.restore(); } };
for (let j = 0; j < n; j++) {
  const [a, b, d] = rest.slice(j * 3, j * 3 + 3), gy = 115 * s, x0 = (j * CW + CW / 2 - d / 2) * s;
  [[a, 'ginger', 0, 1], [b, 'smoky', +d, -1]].forEach(([sp, lk, dx, dir]) => {
    const [an, fr] = sp.split(':'), look = Art.LOOKS[lk], f = Art.renderFrame(Art.ANIMS[an].pose(+fr), look, s);
    g.save(); g.translate(x0 + dx * s, gy); g.scale(dir, 1); g.drawImage(f.c, -S.OX * s, -S.OY * s); g.scale(s, s); eyes(look, f.anchors); g.restore();
  });
  g.fillStyle = '#555'; g.font = '14px sans-serif'; g.fillText(`${a}+${b} d=${d}`, j * CW * s + 6, 16);
}
fs.writeFileSync(out, c.toBuffer('image/png'));
