const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('catAPI', {
  setIgnore: v => ipcRenderer.send('set-ignore', !!v),
  getStore: () => ipcRenderer.invoke('get-store'),
  save: d => ipcRenderer.send('save', d),
  onCmd: f => ipcRenderer.on('cmd', (_e, m) => f(m)),
  showMenu: () => ipcRenderer.send('show-menu'),
  selftestDone: d => ipcRenderer.send('selftest-done', d),
});
