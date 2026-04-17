const {
  app, BrowserWindow, Menu, ipcMain, session, shell, protocol
} = require('electron');
const path = require('path');
const fs   = require('fs');

let mainWindow = null;

// ============================================================================
// Storage layer — JSON files under userData/data/
// On Windows this resolves to %APPDATA%\noorani-browser\data\
// ============================================================================

const dataDir = () => path.join(app.getPath('userData'), 'data');

function ensureDataDir() {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJSON(filename, fallback) {
  ensureDataDir();
  const p = path.join(dataDir(), filename);
  try {
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, 'utf-8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error(`[noorani] load ${filename} failed:`, err);
    return fallback;
  }
}

function saveJSON(filename, data) {
  ensureDataDir();
  const p = path.join(dataDir(), filename);
  try {
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[noorani] save ${filename} failed:`, err);
  }
}

// ============================================================================
// Custom noorani:// protocol (must be registered before app-ready)
// ============================================================================

protocol.registerSchemesAsPrivileged([{
  scheme: 'noorani',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    bypassCSP: false,
    allowServiceWorkers: false
  }
}]);

function computeTopSites(limit = 6) {
  const history = loadJSON('history.json', []);
  const counts  = new Map();
  for (const h of history) {
    if (!h || !h.url) continue;
    const ex = counts.get(h.url) ||
      { url: h.url, title: h.title, favicon: h.favicon, count: 0 };
    ex.count++;
    if (h.title)   ex.title   = h.title;
    if (h.favicon) ex.favicon = h.favicon;
    counts.set(h.url, ex);
  }
  const top = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  if (top.length < limit) {
    const bookmarks = loadJSON('bookmarks.json', []);
    for (const b of bookmarks) {
      if (top.length >= limit) break;
      if (!top.some(t => t.url === b.url)) {
        top.push({ url: b.url, title: b.title, favicon: b.favicon, count: 0 });
      }
    }
  }
  return top;
}

function buildHomeHtml() {
  const templatePath = path.join(__dirname, 'home.html');
  const template = fs.readFileSync(templatePath, 'utf-8');
  const top = computeTopSites(6);
  const inject =
    `<script id="__noorani_data">window.__NOORANI_TOP_SITES__ = ` +
    `${JSON.stringify(top).replace(/</g, '\\u003c')};</script>`;
  return template.replace('<!-- NOORANI_DATA -->', inject);
}

function registerNooraniProtocol() {
  protocol.handle('noorani', (request) => {
    try {
      const u = new URL(request.url);
      if (u.hostname === 'home' && (u.pathname === '/' || u.pathname === '')) {
        return new Response(buildHomeHtml(), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      }
      return new Response('Not Found', { status: 404 });
    } catch (err) {
      return new Response('noorani:// handler error: ' + err.message,
        { status: 500 });
    }
  });
}

// ============================================================================
// Downloads (session-only tracking)
// ============================================================================

const downloads       = [];      // serializable info shown to renderer
const downloadItems   = new Map(); // id -> live DownloadItem (for cancel)
let   dlCounter       = 0;

function broadcastDownloads() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('downloads:update', downloads.slice());
  }
}

function setupDownloads() {
  session.defaultSession.on('will-download', (_event, item) => {
    const id = 'dl-' + (++dlCounter);
    const info = {
      id,
      filename:      item.getFilename(),
      url:           item.getURL(),
      savedPath:     null,
      totalBytes:    item.getTotalBytes(),
      receivedBytes: 0,
      progress:      0,
      state:         'started',
      startedAt:     Date.now()
    };
    downloads.unshift(info);
    downloadItems.set(id, item);
    broadcastDownloads();

    item.on('updated', (_e, state) => {
      info.receivedBytes = item.getReceivedBytes();
      info.totalBytes    = item.getTotalBytes();
      info.progress      = info.totalBytes > 0
        ? info.receivedBytes / info.totalBytes
        : 0;
      info.state = state; // 'progressing' | 'interrupted'
      broadcastDownloads();
    });

    item.once('done', (_e, state) => {
      info.state     = state; // 'completed' | 'cancelled' | 'interrupted'
      info.savedPath = item.getSavePath();
      if (state === 'completed') info.progress = 1;
      downloadItems.delete(id);
      broadcastDownloads();
    });
  });
}

// ============================================================================
// IPC handlers — renderer's only door to disk
// ============================================================================

function registerIpc() {
  // Bookmarks ---------------------------------------------------------------
  ipcMain.handle('bookmarks:get', () => loadJSON('bookmarks.json', []));
  ipcMain.handle('bookmarks:has', (_e, url) => {
    const list = loadJSON('bookmarks.json', []);
    return list.some(b => b.url === url);
  });
  ipcMain.handle('bookmarks:add', (_e, entry) => {
    if (!entry || !entry.url) return loadJSON('bookmarks.json', []);
    const list = loadJSON('bookmarks.json', []);
    if (!list.some(b => b.url === entry.url)) {
      list.push({
        url:     entry.url,
        title:   entry.title   || entry.url,
        favicon: entry.favicon || null,
        addedAt: Date.now()
      });
      saveJSON('bookmarks.json', list);
    }
    return list;
  });
  ipcMain.handle('bookmarks:remove', (_e, url) => {
    const list = loadJSON('bookmarks.json', []).filter(b => b.url !== url);
    saveJSON('bookmarks.json', list);
    return list;
  });

  // History -----------------------------------------------------------------
  ipcMain.handle('history:get', () => loadJSON('history.json', []));
  ipcMain.handle('history:add', (_e, entry) => {
    if (!entry || !entry.url) return;
    const url = entry.url;
    if (url.startsWith('noorani:') ||
        url === 'about:blank' ||
        url.startsWith('about:') ||
        url.startsWith('chrome-error:')) return;

    const list = loadJSON('history.json', []);
    list.push({
      url,
      title:     entry.title   || url,
      favicon:   entry.favicon || null,
      visitedAt: entry.visitedAt || Date.now()
    });
    // Cap to 5000 entries
    if (list.length > 5000) list.splice(0, list.length - 5000);
    saveJSON('history.json', list);
  });
  ipcMain.handle('history:clear', () => {
    saveJSON('history.json', []);
    return [];
  });

  // Downloads ---------------------------------------------------------------
  ipcMain.handle('downloads:get', () => downloads.slice());
  ipcMain.handle('downloads:open-file', async (_e, id) => {
    const d = downloads.find(x => x.id === id);
    if (d && d.savedPath && d.state === 'completed') {
      return shell.openPath(d.savedPath);
    }
  });
  ipcMain.handle('downloads:open-folder', async (_e, id) => {
    const d = downloads.find(x => x.id === id);
    if (d && d.savedPath) shell.showItemInFolder(d.savedPath);
  });
  ipcMain.handle('downloads:cancel', (_e, id) => {
    const item = downloadItems.get(id);
    if (item) item.cancel();
  });

  // Home data (for dynamic refresh, not used by static build but available) -
  ipcMain.handle('home:top-sites', () => computeTopSites(6));

  // Expose userData path so renderer can show it in UI if needed -----------
  ipcMain.handle('app:data-dir', () => dataDir());
}

// ============================================================================
// Application menu (accelerators) — Phase 3.5 behavior preserved
// ============================================================================

function sendShortcut(action, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('shortcut', action, ...args);
  }
}

function buildMenu() {
  const tabSwitchItems = Array.from({ length: 9 }, (_, i) => ({
    label:       `Go to Tab ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click:       () => sendShortcut('switch-tab', i + 1)
  }));

  const template = [
    {
      label: 'Tabs',
      submenu: [
        { label: 'New Tab',      accelerator: 'CmdOrCtrl+T',    click: () => sendShortcut('new-tab') },
        { label: 'Close Tab',    accelerator: 'CmdOrCtrl+W',    click: () => sendShortcut('close-tab') },
        { type: 'separator' },
        { label: 'Next Tab',     accelerator: 'Ctrl+Tab',       click: () => sendShortcut('next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => sendShortcut('prev-tab') },
        { type: 'separator' },
        ...tabSwitchItems
      ]
    },
    {
      label: 'Navigation',
      submenu: [
        { label: 'Back',          accelerator: 'Alt+Left',         click: () => sendShortcut('back') },
        { label: 'Forward',       accelerator: 'Alt+Right',        click: () => sendShortcut('forward') },
        { label: 'Reload',        accelerator: 'CmdOrCtrl+R',      click: () => sendShortcut('reload') },
        { label: 'Reload (F5)',   accelerator: 'F5',               click: () => sendShortcut('reload') },
        { label: 'Focus URL Bar', accelerator: 'CmdOrCtrl+L',      click: () => sendShortcut('focus-url') },
        { label: 'Home',          accelerator: 'Alt+Home',         click: () => sendShortcut('home') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle DevTools', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

// ============================================================================
// Window lifecycle
// ============================================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width:             1280,
    height:            800,
    title:             'Noorani Browser',
    backgroundColor:   '#1a1a1a',
    autoHideMenuBar:   true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webviewTag:       true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  ensureDataDir();
  registerNooraniProtocol();
  setupDownloads();
  registerIpc();
  Menu.setApplicationMenu(buildMenu());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
