// Noorani Browser — renderer.js (Phase 3: Tabs)
//
// Runs in the host page's renderer process with contextIsolation=true and
// nodeIntegration=false. Multi-tab model: many <webview> elements stacked in
// #content; only the active one is visible. No IPC needed — the <webview> API
// is enough for Phase 3.

// ------- DOM refs -------
const tabsEl     = document.getElementById('tabs');
const newTabBtn  = document.getElementById('new-tab');
const contentEl  = document.getElementById('content');
const urlInput   = document.getElementById('url');
const backBtn    = document.getElementById('back');
const forwardBtn = document.getElementById('forward');
const reloadBtn  = document.getElementById('reload');

// ------- Constants -------
const HOMEPAGE = 'https://www.google.com';

// Fallback favicon: inline SVG globe as a data URL. Shown before a site
// reports a favicon, or when its favicon fails to load.
const FALLBACK_FAVICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
    'fill="none" stroke="#9a9a9a" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="10"/>' +
    '<line x1="2" y1="12" x2="22" y2="12"/>' +
    '<path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/>' +
    '</svg>'
  );

// ------- State -------
const tabs = [];        // ordered array of tab objects
let currentTabId = null;
let nextIdCounter = 1;
const newId = () => 'tab-' + nextIdCounter++;

function activeTab() {
  return tabs.find(t => t.id === currentTabId) || null;
}

// ============ URL parsing ============

function parseInput(raw) {
  const input = raw.trim();
  if (!input) return null;

  if (/^(https?|file|about|data):/i.test(input)) return input;
  if (/^localhost(:\d+)?(\/|$)/i.test(input)) return 'http://' + input;
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/|$)?/.test(input)) return 'http://' + input;

  const hostPart = input.split(/[\/?#]/)[0];
  if (!/\s/.test(input) && hostPart.includes('.') && !hostPart.endsWith('.')) {
    return 'https://' + input;
  }
  return 'https://www.google.com/search?q=' + encodeURIComponent(input);
}

function navigate(raw) {
  const target = parseInput(raw);
  const tab = activeTab();
  if (target && tab) tab.webview.loadURL(target);
}

// ============ Tab creation ============

function createTab(url = HOMEPAGE) {
  const id = newId();

  // --- Webview element ---
  const webview = document.createElement('webview');
  webview.setAttribute('src', url);
  webview.setAttribute('allowpopups', '');
  webview.classList.add('hidden'); // reveal via switchToTab

  // --- Tab strip element ---
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.tabId = id;
  tabEl.setAttribute('role', 'tab');

  const favEl = document.createElement('img');
  favEl.className = 'tab__favicon';
  favEl.src = FALLBACK_FAVICON;
  favEl.alt = '';

  const titleEl = document.createElement('div');
  titleEl.className = 'tab__title';
  titleEl.textContent = 'New Tab';

  const closeEl = document.createElement('button');
  closeEl.className = 'tab__close';
  closeEl.type = 'button';
  closeEl.setAttribute('aria-label', 'Close tab');
  closeEl.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
    '<line x1="6" y1="6" x2="18" y2="18"/>' +
    '<line x1="18" y1="6" x2="6" y2="18"/></svg>';

  tabEl.append(favEl, titleEl, closeEl);
  tabsEl.appendChild(tabEl);

  contentEl.appendChild(webview);

  const tab = {
    id,
    webview,
    tabEl, favEl, titleEl, closeEl,
    title: null,        // null until page reports one
    url,
    favicon: null,
    isLoading: true
  };
  tabs.push(tab);

  wireTab(tab);
  switchToTab(id);
  return tab;
}

// ============ Tab event wiring ============

function wireTab(tab) {
  // Strip: left-click to activate, middle-click to close, close-button to close
  tab.tabEl.addEventListener('mousedown', (e) => {
    if (e.button === 0 && !e.target.closest('.tab__close')) {
      switchToTab(tab.id);
    } else if (e.button === 1) {
      // Middle-click closes the tab
      e.preventDefault();
      closeTab(tab.id);
    }
  });
  tab.closeEl.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(tab.id);
  });

  const wv = tab.webview;

  wv.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    if (tab.id === currentTabId) {
      urlInput.value = e.url;
      updateNavButtons();
    }
  });

  wv.addEventListener('did-navigate-in-page', (e) => {
    // Only treat main-frame in-page navs as bar-updating
    if (e.isMainFrame === false) return;
    tab.url = e.url;
    if (tab.id === currentTabId) {
      urlInput.value = e.url;
      updateNavButtons();
    }
  });

  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || null;
    tab.titleEl.textContent = tab.title || 'Untitled';
    tab.tabEl.title = tab.title || '';
    if (tab.id === currentTabId) syncWindowTitle();
  });

  wv.addEventListener('page-favicon-updated', (e) => {
    const favs = (e.favicons && e.favicons.length) ? e.favicons : [];
    if (!favs.length) return;
    tab.favicon = favs[0];
    tab.favEl.src = favs[0];
    tab.favEl.onerror = () => {
      tab.favEl.onerror = null;
      tab.favEl.src = FALLBACK_FAVICON;
    };
  });

  wv.addEventListener('did-start-loading', () => {
    tab.isLoading = true;
    tab.tabEl.classList.add('loading');
  });

  wv.addEventListener('did-stop-loading', () => {
    tab.isLoading = false;
    tab.tabEl.classList.remove('loading');
    if (tab.id === currentTabId) updateNavButtons();
  });

  wv.addEventListener('dom-ready', () => {
    if (tab.id === currentTabId) updateNavButtons();
  });

  // Intercept window.open / target=_blank / middle-clicks-as-new-window and
  // reroute to a new tab instead of letting Electron spawn a detached window.
  // (Event is deprecated in newer Electron versions but still dispatched by
  // the <webview> element; harmless if it no-ops.)
  wv.addEventListener('new-window', (e) => {
    try { e.preventDefault(); } catch (_) {}
    if (e.url) createTab(e.url);
  });
}

// ============ Tab switching / closing ============

function switchToTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  for (const t of tabs) {
    const isActive = (t.id === id);
    t.webview.classList.toggle('hidden', !isActive);
    t.tabEl.classList.toggle('active', isActive);
  }
  currentTabId = id;

  urlInput.value = tab.url || '';
  syncWindowTitle();
  updateNavButtons();

  // Make sure the active tab is visible in the tab strip
  tab.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];
  tab.webview.remove();
  tab.tabEl.remove();
  tabs.splice(idx, 1);

  // Decision: closing the last tab closes the window (Chrome-style).
  if (tabs.length === 0) {
    window.close();
    return;
  }

  if (currentTabId === id) {
    // Activate the tab that took this slot; fall back to the last tab.
    const newIdx = Math.min(idx, tabs.length - 1);
    switchToTab(tabs[newIdx].id);
  }
}

// ============ Toolbar / title sync ============

function updateNavButtons() {
  const tab = activeTab();
  if (!tab) {
    backBtn.disabled = true;
    forwardBtn.disabled = true;
    return;
  }
  // canGoBack/canGoForward throw before guest webContents attach.
  try {
    backBtn.disabled    = !tab.webview.canGoBack();
    forwardBtn.disabled = !tab.webview.canGoForward();
  } catch (_) {
    backBtn.disabled = true;
    forwardBtn.disabled = true;
  }
}

function syncWindowTitle() {
  const tab = activeTab();
  document.title = (tab && tab.title)
    ? `${tab.title} - Noorani Browser`
    : 'Noorani Browser';
}

// ============ Toolbar wiring ============

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    navigate(urlInput.value);
    urlInput.blur();
  }
});

backBtn.addEventListener('click', () => {
  const tab = activeTab();
  if (tab && tab.webview.canGoBack()) tab.webview.goBack();
});
forwardBtn.addEventListener('click', () => {
  const tab = activeTab();
  if (tab && tab.webview.canGoForward()) tab.webview.goForward();
});
reloadBtn.addEventListener('click', () => {
  const tab = activeTab();
  if (tab) tab.webview.reload();
});

newTabBtn.addEventListener('click', () => {
  createTab();
  // Focus URL bar so the user can type immediately.
  urlInput.focus();
  urlInput.select();
});

// ============ Shortcut action helpers ============

function focusURLBar() {
  urlInput.focus();
  urlInput.select();
}

// Ctrl+W policy: never let the window become empty. If the active tab is
// the only tab, open a fresh HOMEPAGE tab first, then close the old one.
function closeActiveTab() {
  const tab = activeTab();
  if (!tab) return;
  if (tabs.length === 1) {
    createTab(HOMEPAGE);
    closeTab(tab.id);
  } else {
    closeTab(tab.id);
  }
}

function cycleTab(delta) {
  if (tabs.length < 2) return;
  const idx = tabs.findIndex(t => t.id === currentTabId);
  const next = ((idx + delta) % tabs.length + tabs.length) % tabs.length;
  switchToTab(tabs[next].id);
}

function switchToIndex(oneBased) {
  const tab = tabs[oneBased - 1];
  if (tab) switchToTab(tab.id);
}

function backActive() {
  const tab = activeTab();
  if (tab && tab.webview.canGoBack()) tab.webview.goBack();
}

function forwardActive() {
  const tab = activeTab();
  if (tab && tab.webview.canGoForward()) tab.webview.goForward();
}

function reloadActive() {
  const tab = activeTab();
  if (tab) tab.webview.reload();
}

// ============ IPC shortcut subscription ============
//
// Keyboard shortcuts come from main.js menu accelerators via IPC. This works
// even when a <webview> has focus (the renderer-level keydown handler used
// in Phase 3 couldn't catch those). See preload.js for the bridge.

if (window.nooraniAPI && typeof window.nooraniAPI.onShortcut === 'function') {
  window.nooraniAPI.onShortcut((action, ...args) => {
    switch (action) {
      case 'new-tab':
        createTab();
        focusURLBar();
        break;
      case 'close-tab':
        closeActiveTab();
        break;
      case 'next-tab':     cycleTab(+1); break;
      case 'prev-tab':     cycleTab(-1); break;
      case 'switch-tab':   switchToIndex(args[0]); break;
      case 'back':         backActive(); break;
      case 'forward':      forwardActive(); break;
      case 'reload':       reloadActive(); break;
      case 'focus-url':    focusURLBar(); break;
    }
  });
}

// ============ Startup ============

createTab(HOMEPAGE);
urlInput.focus();
urlInput.select();
