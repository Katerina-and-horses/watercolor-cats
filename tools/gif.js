// GIF в реальном темпе: кошка идёт по земле со скоростью игры. Нужны @napi-rs/canvas и gifenc (NODE_PATH).
// node tools/gif.js <art.js> <out.gif> <anim> <скорость> <look> <секунды> [шаг кадра, с: 0.04; для бега 0.02]   напр. renderer/art.js walk.gif walk 36 ginger 4.4
const fs = require('fs'), vm = require('vm'); const { createCanvas } = require('@napi-rs/canvas');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const [artPath, out, anim, speed, lk, secs, dtS] = process.argv.slice(2);
const ctx = { document: { createElement: () => createCanvas(1, 1) }, console, Math }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(artPath, 'utf8') + '\nthis.Art = Art;', ctx); const Art = ctx.Art, S = Art.SPR;
const s = 2.5, a = Art.ANIMS[anim], look = Art.LOOKS[lk];
const eye = (f, look) => { for (const [p, rx, ry] of f.anchors.eyes) { g.save(); g.translate(p.x, p.y); g.rotate(f.anchors.eyeAng); g.fillStyle = look.iris; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 7); g.fill(); g.strokeStyle = Art.hexA(look.ink, 0.8); g.lineWidth = 0.5; g.stroke(); g.fillStyle = '#1d1512'; g.beginPath(); g.ellipse(rx * .1, 0, rx * .3, ry * .9, 0, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(rx * .3, -ry * .4, .6, 0, 7); g.fill(); g.restore(); } };
const frames = []; for (let i = 0; i < a.n; i++) frames.push(Art.renderFrame(a.pose(i), look, s));
const Wu = 300, W = Math.round(Wu * s), H = Math.round(80 * s), gy = H - 10 * s, dt = +dtS || 0.04, gif = GIFEncoder();
const c = createCanvas(W, H), g = c.getContext('2d');
for (let t = 0; t < +secs; t += dt) {
  const f = frames[Math.floor(t * a.fps) % a.n], x = ((40 + t * speed) % (Wu + 80)) - 40;
  g.fillStyle = '#f7f2e8'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#d8ceb8'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, gy); g.lineTo(W, gy); g.stroke();
  for (let m = 0; m < Wu; m += 20) { g.beginPath(); g.moveTo(m * s, gy); g.lineTo(m * s, gy + 5); g.stroke(); }
  g.save(); g.translate(x * s, gy); g.drawImage(f.c, -S.OX * s, -S.OY * s); g.scale(s, s);
  eye(f, look); g.restore();
  const d = g.getImageData(0, 0, W, H).data, pal = quantize(d, 128);
  gif.writeFrame(applyPalette(d, pal), W, H, { palette: pal, delay: Math.round(dt * 1000) });
}
gif.finish(); fs.writeFileSync(out, gif.bytes()); console.log(out, (fs.statSync(out).size / 1e6).toFixed(1) + ' МБ');
