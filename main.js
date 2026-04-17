const {
  app, BrowserWindow, Menu, ipcMain, session, shell, protocol,
  nativeTheme, webContents, screen
} = require('electron');
const path = require('path');
const fs   = require('fs');

let mainWindow = null;

// ============================================================================
// Constants
// ============================================================================

const SETTINGS_VERSION = 3;

// Per-category feature defaults. When new keys are added later, they flow in
// via the migration path in loadSettings() without wiping existing values.
const FEATURES_DEFAULTS = Object.freeze({
  worship: Object.freeze({
    prayerTimes:        false,
    azanNotifications:  false,
    qibla:              false,
    hijriCalendar:      false,
    quranQuickAccess:   false,
    duaBookmarks:       false
  }),
  contentSafety: Object.freeze({
    halalFilter:        false,
    ramadanMode:        false,
    familySafeMode:     false,
    imageModesty:       false
  }),
  privacy: Object.freeze({
    blockAdTracking:    true,
    blockCryptoGambling: false,
    blockRibaAds:       false,
    localDataOnly:      true
  }),
  interface: Object.freeze({
    language:           'en',
    rtl:                false
  })
});

const ONBOARDING_DEFAULTS = Object.freeze({
  complete:    false,
  completedAt: null
});

const LOCATION_DEFAULTS = Object.freeze({
  city:    null,
  country: null,
  lat:     null,
  lng:     null
});

const UI_DEFAULTS = Object.freeze({
  showBookmarkBar: 'always'   // 'always' | 'new-tab-only' | 'never'
});
const BOOKMARK_BAR_MODES = Object.freeze(['always', 'new-tab-only', 'never']);

const SETTINGS_DEFAULTS = Object.freeze({
  theme:              'light',                   // 'light' | 'dark' | 'auto'
  searchEngine:       'google',
  homepage:           'noorani://home',
  useCustomHomepage:  false,
  version:            SETTINGS_VERSION,
  onboarding:         ONBOARDING_DEFAULTS,
  location:           LOCATION_DEFAULTS,
  features:           FEATURES_DEFAULTS,
  ui:                 UI_DEFAULTS
});

const SUPPORTED_LANGUAGES = Object.freeze(['en', 'ur', 'ar', 'id', 'tr', 'ms']);

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

// Shallow-merge a single feature category so per-category updates don't wipe
// keys the user hasn't explicitly set. Called during schema migration and
// during onboarding:complete.
function mergeCategory(defaults, existing) {
  const out = { ...defaults };
  if (existing && typeof existing === 'object') {
    for (const [k, v] of Object.entries(existing)) {
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

// Migrate a raw settings object to the current schema (v2). Preserves any
// existing user values; fills in missing keys from defaults. Pure function —
// doesn't touch disk.
function migrateSettings(raw) {
  if (!raw || typeof raw !== 'object') raw = {};
  const rawFeatures = (raw.features && typeof raw.features === 'object') ? raw.features : {};

  const merged = {
    theme:             raw.theme             !== undefined ? raw.theme             : SETTINGS_DEFAULTS.theme,
    searchEngine:      raw.searchEngine      !== undefined ? raw.searchEngine      : SETTINGS_DEFAULTS.searchEngine,
    homepage:          raw.homepage          !== undefined ? raw.homepage          : SETTINGS_DEFAULTS.homepage,
    useCustomHomepage: raw.useCustomHomepage !== undefined ? raw.useCustomHomepage : SETTINGS_DEFAULTS.useCustomHomepage,
    onboarding:        mergeCategory(ONBOARDING_DEFAULTS, raw.onboarding),
    location:          mergeCategory(LOCATION_DEFAULTS,   raw.location),
    features: {
      worship:       mergeCategory(FEATURES_DEFAULTS.worship,       rawFeatures.worship),
      contentSafety: mergeCategory(FEATURES_DEFAULTS.contentSafety, rawFeatures.contentSafety),
      privacy:       mergeCategory(FEATURES_DEFAULTS.privacy,       rawFeatures.privacy),
      interface:     mergeCategory(FEATURES_DEFAULTS.interface,     rawFeatures.interface)
    },
    ui:       mergeCategory(UI_DEFAULTS, raw.ui),
    version:  SETTINGS_VERSION
  };

  // Validation for the flat fields
  if (!['light','dark','auto'].includes(merged.theme)) merged.theme = SETTINGS_DEFAULTS.theme;
  if (!SEARCH_ENGINES[merged.searchEngine])            merged.searchEngine = SETTINGS_DEFAULTS.searchEngine;
  if (typeof merged.useCustomHomepage !== 'boolean')   merged.useCustomHomepage = SETTINGS_DEFAULTS.useCustomHomepage;
  if (typeof merged.homepage !== 'string')             merged.homepage = SETTINGS_DEFAULTS.homepage;

  if (!SUPPORTED_LANGUAGES.includes(merged.features.interface.language)) {
    merged.features.interface.language = FEATURES_DEFAULTS.interface.language;
  }
  if (typeof merged.features.interface.rtl !== 'boolean') {
    merged.features.interface.rtl = FEATURES_DEFAULTS.interface.rtl;
  }
  if (!BOOKMARK_BAR_MODES.includes(merged.ui.showBookmarkBar)) {
    merged.ui.showBookmarkBar = UI_DEFAULTS.showBookmarkBar;
  }

  return merged;
}

function loadSettings() {
  const raw = loadJSON('settings.json', null);
  const migrated = migrateSettings(raw);
  // Persist the migration once so the file on disk matches the current schema.
  const needsMigration = !raw || !raw.version || raw.version < SETTINGS_VERSION;
  if (needsMigration) saveJSON('settings.json', migrated);
  return migrated;
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

// Static asset files that noorani:// pages may request. Each is served with
// a fixed content-type from the app directory. Whitelisted explicitly so a
// malformed URL can never pull arbitrary files off disk.
const NOORANI_ASSETS = Object.freeze({
  '/modal.js':              'text/javascript; charset=utf-8',
  '/css/typography.css':    'text/css; charset=utf-8'
});

function registerNooraniProtocol() {
  protocol.handle('noorani', (request) => {
    try {
      const u = new URL(request.url);
      const page = u.hostname;
      const pathname = u.pathname || '/';

      // Static asset (modal.js etc.) served for any hostname.
      if (NOORANI_ASSETS[pathname]) {
        const filePath = path.join(__dirname, pathname.slice(1));
        if (!fs.existsSync(filePath)) {
          return new Response('Not Found', { status: 404 });
        }
        const body = fs.readFileSync(filePath);
        return new Response(body, {
          status: 200,
          headers: { 'content-type': NOORANI_ASSETS[pathname] }
        });
      }

      if (pathname !== '/' && pathname !== '') {
        return new Response('Not Found', { status: 404 });
      }
      if (page === 'home' || page === 'settings' || page === 'welcome') {
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
  // Supports renaming the title AND changing the URL. Changing the URL
  // clears the favicon so the new origin re-fetches one on next visit.
  // Refuses the URL change if another bookmark already uses the new URL.
  ipcMain.handle('bookmarks:update', (_e, payload) => {
    if (!payload || !payload.url) return loadJSON('bookmarks.json', []);
    const list = loadJSON('bookmarks.json', []);
    const idx = list.findIndex(b => b.url === payload.url);
    if (idx < 0) return list;
    const entry = list[idx];

    if (typeof payload.title === 'string' && payload.title.trim()) {
      entry.title = payload.title.trim();
    }
    if (typeof payload.newUrl === 'string' && payload.newUrl.trim()) {
      const newUrl = payload.newUrl.trim();
      if (newUrl !== entry.url) {
        const dup = list.findIndex((b, i) => i !== idx && b.url === newUrl);
        if (dup < 0) {
          entry.url = newUrl;
          entry.favicon = null;
        }
      }
    }

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
  // Confirmation lives in the renderer (nooraniModal). This handler trusts
  // the renderer and just performs the deletion.
  ipcMain.handle('browsing-data:clear', async (_e, options) => {
    options = options || {};
    const selected = Object.keys(options).filter(k => options[k]);
    if (selected.length === 0) return { cleared: [] };

    if (options.history)   saveJSON('history.json',   []);
    if (options.bookmarks) saveJSON('bookmarks.json', []);
    if (options.downloads) { downloads.length = 0; broadcastDownloads(); }
    if (options.settings)  saveSettings({ ...SETTINGS_DEFAULTS });

    if (options.history)   broadcastToAll('history:changed',   []);
    if (options.bookmarks) broadcastToAll('bookmarks:changed', []);
    if (options.settings)  broadcastSettings();

    return { cleared: selected };
  });

  // Onboarding --------------------------------------------------------------
  // The welcome flow collects features + location in the renderer, then
  // commits everything in one shot so settings.json transitions atomically
  // from "onboarding incomplete" to "onboarding complete with these choices".
  ipcMain.handle('onboarding:complete', (_e, payload) => {
    const s = loadSettings();
    const p = (payload && typeof payload === 'object') ? payload : {};

    if (p.features && typeof p.features === 'object') {
      for (const cat of Object.keys(FEATURES_DEFAULTS)) {
        if (p.features[cat]) {
          s.features[cat] = mergeCategory(s.features[cat], p.features[cat]);
        }
      }
      // Re-validate interface fields in case the renderer sent bad values.
      if (!SUPPORTED_LANGUAGES.includes(s.features.interface.language)) {
        s.features.interface.language = FEATURES_DEFAULTS.interface.language;
      }
      if (typeof s.features.interface.rtl !== 'boolean') {
        s.features.interface.rtl = FEATURES_DEFAULTS.interface.rtl;
      }
    }
    if (p.location && typeof p.location === 'object') {
      s.location = mergeCategory(s.location, p.location);
    }
    s.onboarding = { complete: true, completedAt: new Date().toISOString() };

    saveSettings(s);
    broadcastSettings();
    return { ...s, _effectiveTheme: getEffectiveTheme(s) };
  });

  ipcMain.handle('onboarding:reset', () => {
    const s = loadSettings();
    s.onboarding = { complete: false, completedAt: null };
    saveSettings(s);
    broadcastSettings();
    return { ...s, _effectiveTheme: getEffectiveTheme(s) };
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
        { label: 'Toggle Bookmark Bar', accelerator: 'CmdOrCtrl+Shift+B',
          click: () => sendShortcut('toggle-bookmark-bar') },
        { type: 'separator' },
        { label: 'Toggle DevTools',     accelerator: 'CmdOrCtrl+Shift+I',
          role: 'toggleDevTools' }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

// ============================================================================
// Window state persistence
// ============================================================================

const WINDOW_STATE_FILE    = 'window-state.json';
const WINDOW_DEFAULT_WIDTH  = 1280;
const WINDOW_DEFAULT_HEIGHT = 800;
let   windowStateSaveTimer  = null;

// A saved position is only used if at least one connected display still
// contains (x, y) — otherwise the window could end up off-screen when a
// monitor was disconnected since last launch.
function boundsAreVisible(bounds) {
  if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number' ||
      typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
    return false;
  }
  const displays = screen.getAllDisplays();
  return displays.some((d) => {
    const a = d.workArea;
    return bounds.x < a.x + a.width &&
           bounds.x + bounds.width  > a.x &&
           bounds.y < a.y + a.height &&
           bounds.y + bounds.height > a.y;
  });
}

function loadWindowState() {
  return loadJSON(WINDOW_STATE_FILE, null);
}
function saveWindowState(state) {
  saveJSON(WINDOW_STATE_FILE, state);
}

function captureWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  // getNormalBounds() returns the non-maximized / non-fullscreen bounds, so
  // reopening after a maximize still restores the user's prior window size.
  const bounds = (typeof mainWindow.getNormalBounds === 'function')
    ? mainWindow.getNormalBounds()
    : mainWindow.getBounds();
  return {
    x:            bounds.x,
    y:            bounds.y,
    width:        bounds.width,
    height:       bounds.height,
    isMaximized:  mainWindow.isMaximized(),
    isFullScreen: mainWindow.isFullScreen()
  };
}

function scheduleWindowStateSave() {
  if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null;
    const state = captureWindowState();
    if (state) saveWindowState(state);
  }, 500);
}

function flushWindowStateSave() {
  if (windowStateSaveTimer) {
    clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = null;
  }
  const state = captureWindowState();
  if (state) saveWindowState(state);
}

// ============================================================================
// Window lifecycle
// ============================================================================

function createWindow() {
  const saved = loadWindowState();
  const useSaved = saved && boundsAreVisible(saved);

  const options = {
    width:           useSaved ? saved.width  : WINDOW_DEFAULT_WIDTH,
    height:          useSaved ? saved.height : WINDOW_DEFAULT_HEIGHT,
    title:           'Noorani Browser',
    backgroundColor: '#faf7f2',
    autoHideMenuBar: true,
    icon:            path.join(__dirname, 'assets', 'icons', 'icon-256.png'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webviewTag:       true
    }
  };
  if (useSaved) {
    options.x = saved.x;
    options.y = saved.y;
  }

  mainWindow = new BrowserWindow(options);

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // First launch (no saved state) OR saved state was off-screen — maximize.
  // If saved state explicitly said maximized/fullscreen, honour that.
  if (!saved || !useSaved) {
    mainWindow.maximize();
  } else {
    if (saved.isMaximized)  mainWindow.maximize();
    if (saved.isFullScreen) mainWindow.setFullScreen(true);
  }

  mainWindow.on('resize',            scheduleWindowStateSave);
  mainWindow.on('move',              scheduleWindowStateSave);
  mainWindow.on('maximize',          scheduleWindowStateSave);
  mainWindow.on('unmaximize',        scheduleWindowStateSave);
  mainWindow.on('enter-full-screen', scheduleWindowStateSave);
  mainWindow.on('leave-full-screen', scheduleWindowStateSave);
  mainWindow.on('close',             flushWindowStateSave);

  mainWindow.on('closed', () => { mainWindow = null; });
}

// Windows taskbar grouping — must be set before the first window opens.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.noorani.browser');
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
