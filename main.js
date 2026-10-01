'use strict';
// Котики: прозрачная полоска над панелью задач, клики проходят насквозь везде, кроме котиков, клубков и корзинки.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, powerMonitor, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const selftestArg = process.argv.find(a => a.startsWith('--selftest'));
const SELFTEST_DIR = selftestArg ? (selftestArg.split('=')[1] || 'selftest-out') : null;

if (!SELFTEST_DIR && !app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('ru.cats.watercolor');

const SIZES = { tiny: 0.75, small: 0.9, medium: 1.05, large: 1.25, huge: 1.5 };
const SIZE_NAMES = { tiny: 'Крошечные', small: 'Маленькие', medium: 'Средние', large: 'Крупные', huge: 'Большие' };
const STRIP = 175; // высота полосы в единицах рисунка: котик + высота прыжков клубка
let win = null, tray = null, menu = null, store = {}, hideTimer = null, hidden = false;

const storePath = () => path.join(app.getPath('userData'), 'cats.json');
function loadStore() { try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')); } catch { return {}; } }
function saveStore() {
  try { fs.mkdirSync(path.dirname(storePath()), { recursive: true }); fs.writeFileSync(storePath(), JSON.stringify(store, null, 1)); } catch (e) { console.error(e); }
}
const scale = () => SIZES[store.size] || SIZES.medium;

function stripBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const h = Math.round(STRIP * scale());
  return { x: wa.x, y: wa.y + wa.height - h, width: wa.width, height: h };
}
const send = m => { if (win && !win.isDestroyed()) win.webContents.send('cmd', m); };

function createWindow() {
  win = new BrowserWindow({
    ...stripBounds(),
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.on('render-process-gone', () => { win.destroy(); createWindow(); });
}

function reposition() {
  if (!win || win.isDestroyed()) return;
  win.setBounds(stripBounds());
}

function hideFor(ms) {
  clearTimeout(hideTimer);
  send({ type: 'save' });
  hidden = true;
  win.hide();
  if (ms) hideTimer = setTimeout(show, ms);
  buildMenu();
}
function show() {
  clearTimeout(hideTimer);
  hidden = false;
  win.showInactive();
  win.setAlwaysOnTop(true, 'floating');
  send({ type: 'greet' });
  buildMenu();
}

function buildMenu() {
  if (!tray) return;
  const autostart = app.getLoginItemSettings().openAtLogin;
  menu = Menu.buildFromTemplate([
    { label: 'Рыжик и Дымка', enabled: false },
    { type: 'separator' },
    { label: 'Позвать котиков', click: () => (hidden ? show() : send({ type: 'greet' })) },
    { label: 'Бросить клубочек', click: () => { if (hidden) show(); send({ type: 'yarn' }); } },
    { label: 'Убрать клубочки', click: () => send({ type: 'clearYarn' }) },
    { label: 'Отпустить погулять', click: () => send({ type: 'walkAway' }) },
    { type: 'separator' },
    hidden
      ? { label: 'Показать котиков  (Ctrl+Alt+K)', click: show }
      : { label: 'Спрятать', submenu: [
        { label: 'На 30 минут', click: () => hideFor(30 * 60e3) },
        { label: 'На час', click: () => hideFor(60 * 60e3) },
        { label: 'Пока не позову  (Ctrl+Alt+K)', click: () => hideFor(0) },
      ] },
    { label: 'Размер', submenu: Object.entries(SIZE_NAMES).map(([k, label]) => ({
      label, type: 'radio', checked: (store.size || 'medium') === k,
      click: () => { store.size = k; saveStore(); reposition(); setTimeout(() => send({ type: 'scale', value: scale() }), 150); },
    })) },
    { label: 'Корзинка с клубками', type: 'checkbox', checked: store.basket !== false,
      click: i => { store.basket = i.checked; saveStore(); send({ type: 'basket', value: i.checked }); } },
    { label: 'Запускать вместе с Windows', type: 'checkbox', checked: autostart,
      click: i => { app.setLoginItemSettings({ openAtLogin: i.checked }); store.autostart = i.checked; saveStore(); } },
    { type: 'separator' },
    { label: 'Выход', click: () => { send({ type: 'save' }); setTimeout(() => app.quit(), 300); } },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(img.isEmpty() ? img : img.resize({ width: 16, height: 16, quality: 'best' }));
  tray.setToolTip('Котики — Рыжик и Дымка');
  tray.on('click', () => (hidden ? show() : send({ type: 'greet' })));
  buildMenu();
  if (!store.hintShown) {
    store.hintShown = true; saveStore();
    setTimeout(() => tray.displayBalloon({ title: 'Котики пришли!', content: 'Клубочек — в корзинке справа: вытащите и бросьте. Меню — правый клик по котику или по значку в трее.' }), 8000);
  }
}

ipcMain.on('set-ignore', (_e, v) => { if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(v, { forward: true }); });
ipcMain.on('show-menu', () => { if (menu && win) { buildMenu(); menu.popup({ window: win }); } });
ipcMain.handle('get-store', () => ({ ...store, scale: scale() }));
ipcMain.on('save', (_e, d) => { if (d && typeof d === 'object') { Object.assign(store, d); saveStore(); } });

// ---------- самопроверка для CI ----------
function runSelftest() {
  fs.mkdirSync(SELFTEST_DIR, { recursive: true });
  const logf = path.join(SELFTEST_DIR, 'log.txt');
  const log = s => fs.appendFileSync(logf, s + '\n');
  fs.writeFileSync(logf, '');
  win = new BrowserWindow({ width: 1600, height: Math.round(STRIP * scale()), show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  win.webContents.on('console-message', (...a) => { const m = a[0] && a[0].message !== undefined ? a[0].message : a[2]; log('console: ' + m); });
  win.webContents.on('render-process-gone', (_e, d) => { log('renderer gone ' + JSON.stringify(d)); app.exit(3); });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { selftest: '1' } });
  const timer = setTimeout(() => { log('TIMEOUT'); app.exit(2); }, 300e3);
  ipcMain.on('selftest-done', (_e, d) => {
    clearTimeout(timer);
    const png = (name, url) => fs.writeFileSync(path.join(SELFTEST_DIR, name), Buffer.from(url.split(',')[1], 'base64'));
    if (d.error) { log('ERROR ' + d.error); app.exit(1); return; }
    png('sheet.png', d.sheet);
    png('closeup.png', d.closeup);
    d.scenes.forEach((s, i) => png(`scene${i + 1}.png`, s));
    for (const l of d.log) log(l);
    log('OK');
    app.exit(0);
  });
}

app.whenReady().then(() => {
  if (SELFTEST_DIR) { runSelftest(); return; }
  store = loadStore();
  if (app.isPackaged && store.autostart === undefined) {
    app.setLoginItemSettings({ openAtLogin: true });
    store.autostart = true;
    saveStore();
  }
  createWindow();
  createTray();
  try { globalShortcut.register('Control+Alt+K', () => (hidden ? show() : hideFor(0))); } catch { /* занято — не страшно */ }
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  // вернулись к компьютеру — котики приходят поздороваться
  powerMonitor.on('unlock-screen', () => setTimeout(() => (hidden ? null : send({ type: 'greet' })), 1500));
  powerMonitor.on('resume', () => setTimeout(() => { reposition(); if (!hidden) send({ type: 'greet' }); }, 3000));
  setInterval(() => { if (win && !hidden) win.setAlwaysOnTop(true, 'floating'); }, 5 * 60e3);
});

app.on('second-instance', () => (hidden ? show() : send({ type: 'greet' })));
app.on('window-all-closed', e => { if (!SELFTEST_DIR) e.preventDefault(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
