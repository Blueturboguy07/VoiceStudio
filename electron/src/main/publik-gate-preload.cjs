// publik-gate-preload.cjs — the one bridge of the publik gate window (publik-gate.ts): a button
// press reaches the main process. Nothing else is exposed to the page. electron-builder ships this
// file as it is (`files` in electron-builder.config.mjs): a sandboxed preload must be CommonJS.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('publikGate', {
  press: (action) => ipcRenderer.send('publik-gate:press', String(action)),
});
