// The launcher's only capability surface: window control and the two connection choices. Nothing about Node, the file
// system or `require` reaches the page (contextIsolation + sandbox), and main.mjs refuses every call that does not come
// from a file:// frame — so a remote server's page loaded in this window cannot drive the desktop shell.
//
// CommonJS on purpose: a sandboxed preload cannot be an ES module (Electron loads it as a script), and package.json's
// "type": "module" would otherwise claim this file.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  startLocal: () => ipcRenderer.invoke('desktop:start-local'),
  connectRemote: (url) => ipcRenderer.invoke('desktop:connect-remote', url),
  launcher: () => ipcRenderer.invoke('desktop:launcher'),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
});
