const electron = require('electron');
const { app, BrowserWindow, dialog } = electron;
const ipcMain = electron.ipcMain;
const path = require('path');
const express = require('express');

let mainWindow = null;
let tileServer = null;

function createTileServer() {
  const server = express();
  const tilesDir = path.join(__dirname, '..', '..', 'assets', 'tiles');
  server.use('/tiles', express.static(tilesDir));
  server.use('/data', express.static(path.join(__dirname, '..', '..', 'assets', 'data')));

  // Serve local mbtiles (future: full mbtiles protocol support)
  server.get('/mbtiles/:z/:x/:y.pbf', (req, res) => {
    res.status(404).json({ error: 'No mbtiles loaded' });
  });

  return new Promise((resolve) => {
    const instance = server.listen(0, () => {
      const port = instance.address().port;
      resolve({ server: instance, port });
    });
  });
}

function createWindow(tilePort) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: '离线地图路径规划工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Pass tile server port to renderer
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('tile-server-port', tilePort);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(async () => {
  // Setup IPC handlers after app is ready
  ipcMain.handle('open-file-dialog', async (event, filters) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }]
    });
    return result.filePaths;
  });

  ipcMain.handle('get-app-path', () => {
    return app.getPath('userData');
  });

  ipcMain.handle('get-assets-path', () => {
    return path.join(__dirname, '..', '..', 'assets');
  });

  const { server, port } = await createTileServer();
  tileServer = server;
  createWindow(port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(port);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (tileServer) {
    tileServer.close();
  }
});
