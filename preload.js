'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('krzDesktop', {
  isElectron: true,
  loadDiskData: () => ipcRenderer.sendSync('krz:load-data'),
  saveDiskData: (jsonStr) => ipcRenderer.send('krz:save-data', jsonStr)
});
