const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow = null;

// Send a shortcut action to the renderer. Menu-accelerator click handlers
// route here; the renderer owns all tab/navigation state.
function sendShortcut(action, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('shortcut', action, ...args);
  }
}

function buildMenu() {
  // Ctrl+1 .. Ctrl+9 tab-jump accelerators.
  const tabSwitchItems = Array.from({ length: 9 }, (_, i) => ({
    label: `Go to Tab ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: () => sendShortcut('switch-tab', i + 1)
  }));

  const template = [
    {
      label: 'Tabs',
      submenu: [
        { label: 'New Tab',         accelerator: 'CmdOrCtrl+T',       click: () => sendShortcut('new-tab') },
        { label: 'Close Tab',       accelerator: 'CmdOrCtrl+W',       click: () => sendShortcut('close-tab') },
        { type: 'separator' },
        { label: 'Next Tab',        accelerator: 'Ctrl+Tab',          click: () => sendShortcut('next-tab') },
        { label: 'Previous Tab',    accelerator: 'Ctrl+Shift+Tab',    click: () => sendShortcut('prev-tab') },
        { type: 'separator' },
        ...tabSwitchItems
      ]
    },
    {
      label: 'Navigation',
      submenu: [
        { label: 'Back',            accelerator: 'Alt+Left',          click: () => sendShortcut('back') },
        { label: 'Forward',         accelerator: 'Alt+Right',         click: () => sendShortcut('forward') },
        { label: 'Reload',          accelerator: 'CmdOrCtrl+R',       click: () => sendShortcut('reload') },
        { label: 'Reload (F5)',     accelerator: 'F5',                click: () => sendShortcut('reload') },
        { label: 'Focus URL Bar',   accelerator: 'CmdOrCtrl+L',       click: () => sendShortcut('focus-url') }
      ]
    },
    {
      // Dev helpers — accelerators only, hidden menu entry.
      label: 'View',
      submenu: [
        { label: 'Toggle DevTools', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Noorani Browser',
    backgroundColor: '#1a1a1a',
    autoHideMenuBar: true, // Alt-reveal off by default on Windows
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  // Belt + suspenders: fully hide the menu bar. Accelerators still fire
  // because the menu is set as the application menu.
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildMenu());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
