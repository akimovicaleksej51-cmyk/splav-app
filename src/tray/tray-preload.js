const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tray', {
  onNp: (cb) => ipcRenderer.on('np', (_e, d) => cb(d)),
  cmd: (c) => ipcRenderer.send('tray:cmd', c),
});
