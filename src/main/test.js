// Minimal test - check if electron module is working
const electron = require('electron');
console.log('Type of electron:', typeof electron);
console.log('Keys:', Object.getOwnPropertyNames(electron).slice(0, 20));
console.log('app:', electron.app);
console.log('BrowserWindow:', electron.BrowserWindow);

if (electron.app) {
  electron.app.whenReady().then(() => {
    console.log('App is ready!');
    const win = new electron.BrowserWindow({ width: 800, height: 600 });
    win.loadURL('data:text/html,<h1>Hello Electron!</h1>');
  });
} else {
  console.log('ERROR: electron.app is undefined');
  process.exit(1);
}
