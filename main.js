const {
  app, BrowserWindow, Menu, ipcMain, session, shell, protocol,
  nativeTheme, dialog, webContents
} = require('electron');
const path = require('path');
const fs   = require('fs');

let mainWindow = null;

// ============================================================================
// Constants
// ============================================================================

const SETTINGS_DEFAULTS = Object.freeze({
  theme:              'light',                   // 'light' | 'dark' | 'auto'
  searchEngine:       'google',
  homepage:           'noorani://home',
  useCustomHomepage:  false,
  version:            1
});

const SEARCH_ENGINES = Object.freeze({
  google:     { name: 'Google',     search: 'https://www.google.com/search?q=' },
  bing:       { name: 'Bing',       search: 'https://www.bing.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', search: 'https://duckduckgo.com/?q=' },
  brave:      { name: 'Brave',      search: 'https://search.brave.com/search?q=' },
  ecosia:     { name: 'Ecosia',     search: 'https://www.ecosia.org/search?q=' }
});

// ============================================================================
// Storage layer
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

function loadSettings() {
  const raw = loadJSON('settings.json', null);
  const base = (raw && typeof raw === 'object') ? raw : {};
  const merged = { ...SETTINGS_DEFAULTS, ...base };
  if (!['light','dark','auto'].includes(merged.theme)) merged.theme = SETTINGS_DEFAULTS.theme;
  if (!SEARCH_ENGINES[merged.searchEngine])             merged.searchEngine = SETTINGS_DEFAULTS.searchEngine;
  if (typeof merged.useCustomHomepage !== 'boolean')    merged.useCustomHomepage = SETTINGS_DEFAULTS.useCustomHomepage;
  if (typeof merged.homepage !== 'string')              merged.homepage = SETTINGS_DEFAULTS.homepage;
  return merged;
}

function saveSettings(settings) {
  saveJSON('settings.json', settings);
}

function getEffectiveTheme(settings) {
  if (settings.theme === 'auto') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
  return settings.theme;
}

function getVersions() {
  return {
    app:      app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node:     process.versions.node
  };
}

// ============================================================================
// noorani:// protocol
// ============================================================================

protocol.registerSchemesAsPrivileged([{
  scheme: 'noorani',
  privileges: {
    standard: true, secure: true,
    supportFetchAPI: true, stream: true,
    bypassCSP: false, allowServiceWorkers: false
  }
}]);

function computeTopSites(limit = 6) {
  const history = loadJSON('history.json', []);
  const counts = new Map();
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

function buildInternalHtml(pageName) {
  const templatePath = path.join(__dirname, `${pageName}.html`);
  if (!fs.existsSync(templatePath)) return null;
  const template = fs.readFileSync(templatePath, 'utf-8');
  const settings = loadSettings();
  const data = {
    page:           pageName,
    topSites:       computeTopSites(6),
    settings,
    effectiveTheme: getEffectiveTheme(settings),
    versions:       getVersions(),
    engines:        { ...SEARCH_ENGINES }
  };
  const inject =
    `<script id="__noorani_data">` +
    `window.__NOORANI_DATA__ = ${JSON.stringify(data).replace(/</g, '\\u003c')};` +
    `</script>`;
  return template.replace('<!-- NOORANI_DATA -->', inject);
}

function registerNooraniProtocol() {
  protocol.handle('noorani', (request) => {
    try {
      const u = new URL(request.url);
      const page = u.hostname;
      if (u.pathname !== '/' && u.pathname !== '') {
        return new Response('Not Found', { status: 404 });
      }
      if (page === 'home' || page === 'settings') {
        const html = buildInternalHtml(page);
        if (!html) return new Response('Template missing', { status: 500 });
        return new Response(html, {
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
// Broadcasts — reach chrome renderer + every webview guest
// ============================================================================

function broadcastToAll(channel, payload) {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) {
      try { wc.send(channel, payload); } catch (_) { /* swallow */ }
    }
  }
}

function broadcastSettings() {
  const s = loadSettings();
  broadcastToAll('settings:changed', {
    ...s,
    _effectiveTheme: getEffectiveTheme(s)
  });
}

// ============================================================================
// Downloads — session-only tracking
// ============================================================================

const downloads     = [];
const downloadItems = new Map();
let   dlCounter     = 0;

function broadcastDownloads() {
  broadcastToAll('downloads:update', downloads.slice());
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
      info.state = state;
      broadcastDownloads();
    });

    item.once('done', (_e, state) => {
      info.state     = state;
      info.savedPath = item.getSavePath();
      if (state === 'completed') info.progress = 1;
      downloadItems.delete(id);
      broadcastDownloads();
    });
  });
}

// ============================================================================
// IPC handlers
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
      broadcastToAll('bookmarks:changed', list);
    }
    return list;
  });
  ipcMain.handle('bookmarks:remove', (_e, url) => {
    const list = loadJSON('bookmarks.json', []).filter(b => b.url !== url);
    saveJSON('bookmarks.json', list);
    broadcastToAll('bookmarks:changed', list);
    return list;
  });

  // History -----------------------------------------------------------------
  ipcMain.handle('history:get', () => loadJSON('history.json', []));
  ipcMain.handle('history:add', (_e, entry) => {
    if (!entry || !entry.url) return;
    const url = entry.url;
    if (url.startsWith('noorani:')     ||
        url === 'about:blank'          ||
        url.startsWith('about:')       ||
        url.startsWith('chrome-error:')) return;
    const list = loadJSON('history.json', []);
    list.push({
      url,
      title:     entry.title   || url,
      favicon:   entry.favicon || null,
      visitedAt: entry.visitedAt || Date.now()
    });
    if (list.length > 5000) list.splice(0, list.length - 5000);
    saveJSON('history.json', list);
  });
  ipcMain.handle('history:clear', () => {
    saveJSON('history.json', []);
    broadcastToAll('history:changed', []);
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

  // Settings ----------------------------------------------------------------
  ipcMain.handle('settings:get', () => {
    const s = loadSettings();
    return { ...s, _effectiveTheme: getEffectiveTheme(s) };
  });
  ipcMain.handle('settings:update', (_e, payload) => {
    if (!payload || typeof payload.key !== 'string') return null;
    const s = loadSettings();
    s[payload.key] = payload.value;
    saveSettings(s);
    broadcastSettings();
    return { ...s, _effectiveTheme: getEffectiveTheme(s) };
  });

  // Clear browsing data -----------------------------------------------------
  ipcMain.handle('browsing-data:clear', async (_e, options) => {
    options = options || {};
    const selected = Object.keys(options).filter(k => options[k]);
    if (selected.length === 0) return { cleared: [] };

    const labels = {
      history:   'browsing history',
      bookmarks: 'bookmarks',
      downloads: 'downloads list',
      settings:  'all settings (will reset to defaults)'
    };
    const detail = selected.map(k => '• ' + (labels[k] || k)).join('\n');

    const focused = BrowserWindow.getFocusedWindow() || mainWindow;
    const result = await dialog.showMessageBox(focused || undefined, {
      type:        'warning',
      buttons:     ['Cancel', 'Clear'],
      defaultId:   0,
      cancelId:    0,
      title:       'Clear Browsing Data',
      message:     'This will permanently delete:',
      detail
    });
    if (result.response !== 1) return { cleared: [] };

    if (options.history)   saveJSON('history.json',   []);
    if (options.bookmarks) saveJSON('bookmarks.json', []);
    if (options.downloads) { downloads.length = 0; broadcastDownloads(); }
    if (options.settings)  saveSettings({ ...SETTINGS_DEFAULTS });

    if (options.history)   broadcastToAll('history:changed',   []);
    if (options.bookmarks) broadcastToAll('bookmarks:changed', []);
    if (options.settings)  broadcastSettings();

    return { cleared: selected };
  });

  // Search engines / versions / misc ---------------------------------------
  ipcMain.handle('search:engines', () => ({ ...SEARCH_ENGINES }));
  ipcMain.handle('app:versions',   () => getVersions());
  ipcMain.handle('app:data-dir',   () => dataDir());
  ipcMain.handle('home:top-sites', () => computeTopSites(6));
}

// ============================================================================
// Menu / accelerators
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
        { label: 'Back',          accelerator: 'Alt+Left',    click: () => sendShortcut('back') },
        { label: 'Forward',       accelerator: 'Alt+Right',   click: () => sendShortcut('forward') },
        { label: 'Reload',        accelerator: 'CmdOrCtrl+R', click: () => sendShortcut('reload') },
        { label: 'Reload (F5)',   accelerator: 'F5',          click: () => sendShortcut('reload') },
        { label: 'Focus URL Bar', accelerator: 'CmdOrCtrl+L', click: () => sendShortcut('focus-url') },
        { label: 'Home',          accelerator: 'Alt+Home',    click: () => sendShortcut('home') },
        { type: 'separator' },
        { label: 'Settings',      accelerator: 'CmdOrCtrl+,', click: () => sendShortcut('open-settings') }
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
    width:           1280,
    height:          800,
    title:           'Noorani Browser',
    backgroundColor: '#faf7f2',
    autoHideMenuBar: true,
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

  // "auto" theme follows the OS — re-broadcast when it flips
  nativeTheme.on('updated', () => {
    const s = loadSettings();
    if (s.theme === 'auto') broadcastSettings();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
