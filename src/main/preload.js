const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: (filters) => ipcRenderer.invoke('open-file-dialog', filters),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getAssetsPath: () => ipcRenderer.invoke('get-assets-path'),
  onTileServerPort: (callback) => ipcRenderer.on('tile-server-port', (event, port) => callback(port))
});
