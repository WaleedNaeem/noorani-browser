// Noorani Browser — renderer.js (Phase 5: settings, themes, search engine)
//
// contextIsolation=true, nodeIntegration=false. Everything disk-bound goes
// through window.nooraniAPI (preload.js).

// ------- DOM refs --------
const tabsEl         = document.getElementById('tabs');
const newTabBtn      = document.getElementById('new-tab');
const contentEl      = document.getElementById('content');
const urlInput       = document.getElementById('url');
const backBtn        = document.getElementById('back');
const forwardBtn     = document.getElementById('forward');
const reloadBtn      = document.getElementById('reload');
const homeBtn        = document.getElementById('home-btn');
const starBtn        = document.getElementById('star-btn');
const bookmarksBtn   = document.getElementById('bookmarks-btn');
const historyBtn     = document.getElementById('history-btn');
const downloadsBtn   = document.getElementById('downloads-btn');
const settingsBtn    = document.getElementById('settings-btn');
const dlBadge        = document.getElementById('dl-badge');

const loadingBarEl   = document.getElementById('loading-bar');
const bookmarkBarEl  = document.getElementById('bookmark-bar');
const bookmarkItemsEl= document.getElementById('bookmark-bar-items');
const bookmarkOverflowBtn = document.getElementById('bookmark-bar-overflow');
const panelEl        = document.getElementById('panel');
const panelTitle     = document.getElementById('panel-title');
const panelClose     = document.getElementById('panel-close');
const panelClear     = document.getElementById('panel-clear');
const bookmarksList  = document.getElementById('bookmarks-list');
const historyList    = document.getElementById('history-list');
const downloadsListEl = document.getElementById('downloads-list');
const historySearch  = document.getElementById('history-search');

// ------- Constants / resources --------
const INTERNAL_HOMEPAGE = 'noorani://home';
const INTERNAL_SETTINGS = 'noorani://settings';
const INTERNAL_WELCOME  = 'noorani://welcome';

// webview preload — same preload.js, activated only on trusted schemes.
const PRELOAD_URL = new URL('preload.js', window.location.href).href;

const FALLBACK_FAVICON =
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
    'fill="none" stroke="#9a9a9a" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="10"/>' +
    '<line x1="2" y1="12" x2="22" y2="12"/>' +
    '<path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/>' +
    '</svg>'
  );

const PANEL_TITLES = {
  bookmarks: 'Bookmarks',
  history:   'History',
  downloads: 'Downloads'
};

// Search engine URL prefixes — filled in once at startup from the API.
let SEARCH_ENGINES = {
  google: { name: 'Google', search: 'https://www.google.com/search?q=' }
};

// Live settings cache — mutated on settings:changed.
let currentSettings = {
  theme:             'light',
  searchEngine:      'google',
  homepage:          INTERNAL_HOMEPAGE,
  useCustomHomepage: false,
  _effectiveTheme:   'light'
};

// ------- Tab state --------
const tabs = [];
let currentTabId = null;
let nextIdCounter = 1;
const newId = () => 'tab-' + (nextIdCounter++);
let downloadsState = [];

function activeTab() {
  return tabs.find(t => t.id === currentTabId) || null;
}

// Loading bar — reflects the currently active tab's loading state.
let _loadingDoneTimer = null;
function syncLoadingBar() {
  const tab = activeTab();
  const isLoading = !!(tab && tab.isLoading);
  if (!loadingBarEl) return;

  if (_loadingDoneTimer) { clearTimeout(_loadingDoneTimer); _loadingDoneTimer = null; }

  if (isLoading) {
    loadingBarEl.classList.remove('is-done');
    // Reset to 0, then in the next frame let the transition run to 88%.
    loadingBarEl.classList.remove('is-loading');
    loadingBarEl.style.width = '0';
    // eslint-disable-next-line no-unused-expressions
    loadingBarEl.offsetWidth;
    requestAnimationFrame(() => loadingBarEl.classList.add('is-loading'));
  } else {
    loadingBarEl.classList.remove('is-loading');
    loadingBarEl.classList.add('is-done');
    _loadingDoneTimer = setTimeout(() => {
      loadingBarEl.classList.remove('is-done');
      loadingBarEl.style.width = '';
      _loadingDoneTimer = null;
    }, 500);
  }
}

// ============ Theme + homepage + engine helpers ============

function applyTheme(effective) {
  const theme = (effective === 'dark') ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('noorani-effective-theme', theme); } catch (_) {}
}

function getSearchPrefix() {
  const engine = SEARCH_ENGINES[currentSettings.searchEngine]
              || SEARCH_ENGINES.google;
  return engine.search;
}

function getHomepage() {
  if (currentSettings.useCustomHomepage &&
      currentSettings.homepage &&
      currentSettings.homepage !== INTERNAL_HOMEPAGE) {
    return currentSettings.homepage;
  }
  return INTERNAL_HOMEPAGE;
}

// ============ URL parsing ============

function parseInput(raw) {
  const input = raw.trim();
  if (!input) return null;

  if (/^(https?|file|about|data|noorani):/i.test(input)) return input;
  if (/^localhost(:\d+)?(\/|$)/i.test(input)) return 'http://' + input;
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/|$)?/.test(input)) return 'http://' + input;

  const hostPart = input.split(/[\/?#]/)[0];
  if (!/\s/.test(input) && hostPart.includes('.') && !hostPart.endsWith('.')) {
    return 'https://' + input;
  }
  return getSearchPrefix() + encodeURIComponent(input);
}

function navigate(raw) {
  const target = parseInput(raw);
  const tab = activeTab();
  if (target && tab) tab.webview.loadURL(target);
}

function urlBarValueFor(url) {
  if (!url || url.startsWith('noorani:')) return '';
  return url;
}

// ============ DOM builder helper ============

function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className')    n.className = v;
      else if (k === 'text')     n.textContent = v;
      else if (k === 'onClick')  n.addEventListener('click', v);
      else if (v === false || v == null) continue;
      else if (v === true)       n.setAttribute(k, '');
      else                       n.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

function hostLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

// Build a panel empty-state with a soft icon above the text.
const EMPTY_ICONS = {
  bookmarks: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  history:   '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/><polyline points="12 7 12 12 15 14"/>',
  downloads: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'
};
function emptyState(kind, text) {
  const wrap = document.createElement('div');
  wrap.className = 'panel__empty';
  wrap.innerHTML =
    '<svg class="panel__empty__icon" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
    'stroke-linejoin="round">' + (EMPTY_ICONS[kind] || '') + '</svg>' +
    '<div></div>';
  wrap.lastChild.textContent = text;
  return wrap;
}

// ============ Tab creation ============

function createTab(url) {
  const openUrl = url || getHomepage();
  const id = newId();

  const webview = document.createElement('webview');
  webview.setAttribute('src', openUrl);
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('preload', PRELOAD_URL);
  webview.classList.add('hidden');

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
  tabsEl.insertBefore(tabEl, newTabBtn);

  contentEl.insertBefore(webview, panelEl);

  const tab = {
    id, webview, tabEl, favEl, titleEl, closeEl,
    title: null,
    url: openUrl,
    favicon: null,
    isLoading: true,
    _loggedUrl: null
  };
  tabs.push(tab);

  wireTab(tab);
  switchToTab(id);
  return tab;
}

// ============ Tab event wiring ============

function wireTab(tab) {
  tab.tabEl.addEventListener('mousedown', (e) => {
    if (e.button === 0 && !e.target.closest('.tab__close')) {
      switchToTab(tab.id);
    } else if (e.button === 1) {
      e.preventDefault();
      closeTab(tab.id);
    }
  });
  tab.tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showTabContextMenu(tab.id, e.clientX, e.clientY);
  });
  tab.closeEl.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(tab.id);
  });

  const wv = tab.webview;

  wv.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    tab._loggedUrl = null;
    tab.title = null;
    tab.titleEl.textContent = hostLabel(e.url) || 'Loading…';
    if (tab.id === currentTabId) {
      urlInput.value = urlBarValueFor(e.url);
      updateNavButtons();
      syncStar();
      updateBookmarkBarVisibility();
    }
  });

  wv.addEventListener('did-navigate-in-page', (e) => {
    if (e.isMainFrame === false) return;
    tab.url = e.url;
    if (tab.id === currentTabId) {
      urlInput.value = urlBarValueFor(e.url);
      updateNavButtons();
      syncStar();
      updateBookmarkBarVisibility();
    }
  });

  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || null;
    tab.titleEl.textContent = tab.title || hostLabel(tab.url) || 'Untitled';
    tab.tabEl.title = tab.title || '';
    if (tab.id === currentTabId) syncWindowTitle();
    maybeLogHistory(tab);
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
    if (tab.id === currentTabId) syncLoadingBar();
  });

  wv.addEventListener('did-stop-loading', () => {
    tab.isLoading = false;
    tab.tabEl.classList.remove('loading');
    if (tab.id === currentTabId) {
      updateNavButtons();
      syncLoadingBar();
    }
    maybeLogHistory(tab);
  });

  wv.addEventListener('dom-ready', () => {
    if (tab.id === currentTabId) updateNavButtons();
  });

  wv.addEventListener('new-window', (e) => {
    try { e.preventDefault(); } catch (_) {}
    if (e.url) createTab(e.url);
  });

  // Right-click inside the guest page. In this Electron build, params.x/y
  // for the webview's context-menu event are already reported in chrome-
  // window viewport coordinates (not webview-local). Earlier versions of
  // this code added webview.getBoundingClientRect() on top, which dropped
  // the menu 100–200px below the cursor — exactly rect.top's worth of
  // extra offset. Use params coords directly.
  wv.addEventListener('context-menu', (e) => {
    try { e.preventDefault(); } catch (_) {}
    const params = e.params || {};
    const items = buildWebviewContextMenu(tab, params);
    if (!items.length) return;
    window.nooraniContextMenu.show({
      x: params.x || 0,
      y: params.y || 0,
      items
    });
  });
}

function maybeLogHistory(tab) {
  if (!tab.url) return;
  if (tab._loggedUrl === tab.url) return;
  tab._loggedUrl = tab.url;
  window.nooraniAPI.history.add({
    url:     tab.url,
    title:   tab.title || hostLabel(tab.url),
    favicon: tab.favicon
  });
}

// ============ Switching / closing ============

function switchToTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  // Hide any open context menu — stale context from the previous tab.
  if (window.nooraniContextMenu) window.nooraniContextMenu.hide();
  for (const t of tabs) {
    const isActive = (t.id === id);
    t.webview.classList.toggle('hidden', !isActive);
    t.tabEl.classList.toggle('active', isActive);
  }
  // Gentle fade-in on the new webview so fast tab switching feels fluid.
  // The outgoing tab hid instantly above — no visible overlap.
  tab.webview.classList.add('is-entering');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => tab.webview.classList.remove('is-entering'));
  });
  currentTabId = id;

  urlInput.value = urlBarValueFor(tab.url);
  syncWindowTitle();
  updateNavButtons();
  syncStar();
  syncLoadingBar();
  updateBookmarkBarVisibility();
  tab.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];
  // Drop logical state + the webview immediately so switchToTab stays sane.
  tabs.splice(idx, 1);
  tab.webview.remove();

  // Animate the tab chrome element out, then remove from DOM.
  const node = tab.tabEl;
  node.classList.add('is-leaving');
  setTimeout(() => { if (node.parentNode) node.remove(); }, 170);

  if (tabs.length === 0) {
    window.close();
    return;
  }
  if (currentTabId === id) {
    const newIdx = Math.min(idx, tabs.length - 1);
    switchToTab(tabs[newIdx].id);
  }
}

// ============ Toolbar / title ============

function updateNavButtons() {
  const tab = activeTab();
  if (!tab) { backBtn.disabled = true; forwardBtn.disabled = true; return; }
  try {
    backBtn.disabled    = !tab.webview.canGoBack();
    forwardBtn.disabled = !tab.webview.canGoForward();
  } catch (_) {
    backBtn.disabled = true; forwardBtn.disabled = true;
  }
}

function syncWindowTitle() {
  const tab = activeTab();
  if (!tab) { document.title = 'Noorani Browser'; return; }
  if (tab.url && tab.url.startsWith('noorani:')) {
    document.title = 'Noorani Browser';
    return;
  }
  document.title = tab.title
    ? `${tab.title} - Noorani Browser`
    : 'Noorani Browser';
}

async function syncStar() {
  const tab = activeTab();
  const url = tab && tab.url;
  const bookmarkable = !!url && !url.startsWith('noorani:') && !url.startsWith('about:');
  starBtn.disabled = !bookmarkable;

  if (!bookmarkable) {
    starBtn.classList.remove('active-star');
    starBtn.title = 'Bookmark this page';
    return;
  }
  try {
    const has = await window.nooraniAPI.bookmarks.has(url);
    starBtn.classList.toggle('active-star', has);
    starBtn.title = has ? 'Remove bookmark' : 'Bookmark this page';
  } catch (_) { /* swallow */ }
}

// ============ URL bar / nav buttons ============

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    navigate(urlInput.value);
    urlInput.blur();
  }
});
backBtn.addEventListener('click',    () => { const t = activeTab(); if (t && t.webview.canGoBack())    t.webview.goBack(); });
forwardBtn.addEventListener('click', () => { const t = activeTab(); if (t && t.webview.canGoForward()) t.webview.goForward(); });
reloadBtn.addEventListener('click',  () => { const t = activeTab(); if (t) t.webview.reload(); });
newTabBtn.addEventListener('click',  () => { createTab(); focusURLBar(); });
homeBtn.addEventListener('click',    () => goHome());
settingsBtn.addEventListener('click',() => openSettings());

// ============ Shortcut helpers ============

function focusURLBar() { urlInput.focus(); urlInput.select(); }

function closeActiveTab() {
  const tab = activeTab();
  if (!tab) return;
  if (tabs.length === 1) {
    createTab();
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
function switchToIndex(n) { const t = tabs[n - 1]; if (t) switchToTab(t.id); }
function backActive()    { const t = activeTab(); if (t && t.webview.canGoBack())    t.webview.goBack(); }
function forwardActive() { const t = activeTab(); if (t && t.webview.canGoForward()) t.webview.goForward(); }
function reloadActive()  { const t = activeTab(); if (t) t.webview.reload(); }
function goHome()        { const t = activeTab(); if (t) t.webview.loadURL(getHomepage()); }
function openSettings()  { const t = activeTab(); if (t) t.webview.loadURL(INTERNAL_SETTINGS); }

if (window.nooraniAPI && typeof window.nooraniAPI.onShortcut === 'function') {
  window.nooraniAPI.onShortcut((action, ...args) => {
    switch (action) {
      case 'new-tab':       createTab(); focusURLBar(); break;
      case 'close-tab':     closeActiveTab(); break;
      case 'next-tab':      cycleTab(+1); break;
      case 'prev-tab':      cycleTab(-1); break;
      case 'switch-tab':    switchToIndex(args[0]); break;
      case 'back':          backActive(); break;
      case 'forward':       forwardActive(); break;
      case 'reload':        reloadActive(); break;
      case 'focus-url':     focusURLBar(); break;
      case 'home':                 goHome(); break;
      case 'open-settings':        openSettings(); break;
      case 'toggle-bookmark-bar':  toggleBookmarkBarMode(); break;
    }
  });
}

// ============ Bookmark toggle (star) ============

starBtn.addEventListener('click', async () => {
  const tab = activeTab();
  if (!tab || !tab.url) return;
  if (tab.url.startsWith('noorani:') || tab.url.startsWith('about:')) return;

  const has = await window.nooraniAPI.bookmarks.has(tab.url);
  if (has) {
    await window.nooraniAPI.bookmarks.remove(tab.url);
  } else {
    await window.nooraniAPI.bookmarks.add({
      url:     tab.url,
      title:   tab.title || hostLabel(tab.url),
      favicon: tab.favicon
    });
  }
  await syncStar();
});

// ============ Side panel ============

function openPanel(which) {
  if (panelEl.dataset.current === which && !panelEl.hidden) {
    closePanel();
    return;
  }
  panelEl.hidden = false;
  panelEl.dataset.current = which;
  panelTitle.textContent = PANEL_TITLES[which] || '';
  for (const s of panelEl.querySelectorAll('.panel__section')) {
    s.classList.toggle('active', s.dataset.panel === which);
  }
  panelClear.hidden = which !== 'history';
  for (const [name, btn] of [
    ['bookmarks', bookmarksBtn],
    ['history',   historyBtn],
    ['downloads', downloadsBtn]
  ]) {
    btn.classList.toggle('panel-open', name === which);
  }
  if (which === 'bookmarks') renderBookmarksPanel();
  if (which === 'history')   renderHistoryPanel();
  if (which === 'downloads') renderDownloadsPanel();
}

function closePanel() {
  panelEl.hidden = true;
  delete panelEl.dataset.current;
  for (const btn of [bookmarksBtn, historyBtn, downloadsBtn]) {
    btn.classList.remove('panel-open');
  }
}

bookmarksBtn.addEventListener('click', () => openPanel('bookmarks'));
historyBtn.addEventListener  ('click', () => openPanel('history'));
downloadsBtn.addEventListener('click', () => openPanel('downloads'));
panelClose.addEventListener  ('click', closePanel);

panelClear.addEventListener('click', async () => {
  const confirmed = await window.nooraniModal.confirm({
    title:       'Clear History',
    message:     'This will permanently delete your entire browsing history.',
    confirmText: 'Clear History',
    variant:     'danger'
  });
  if (!confirmed) return;
  await window.nooraniAPI.history.clear();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !panelEl.hidden) closePanel();
});

// ============ Bookmarks panel ============

async function renderBookmarksPanel() {
  const bookmarks = await window.nooraniAPI.bookmarks.get();
  bookmarksList.textContent = '';
  if (!bookmarks.length) {
    bookmarksList.appendChild(emptyState(
      'bookmarks',
      'No bookmarks yet. Click the star on any page to save it.'
    ));
    return;
  }
  for (const b of bookmarks) {
    bookmarksList.appendChild(renderEntryRow({
      favicon: b.favicon,
      title:   b.title || hostLabel(b.url),
      url:     b.url,
      onOpen:  (ev) => openFromEntry(b.url, ev),
      actions: [{
        label: '×',
        title: 'Remove bookmark',
        onClick: async () => {
          await window.nooraniAPI.bookmarks.remove(b.url);
        }
      }]
    }));
  }
}

// ============ History panel ============

let _historyFilter = '';

async function renderHistoryPanel() {
  const all = await window.nooraniAPI.history.get();
  const sorted = all.slice().reverse();
  const q = _historyFilter.toLowerCase().trim();
  const filtered = q
    ? sorted.filter(h =>
        (h.title || '').toLowerCase().includes(q) ||
        (h.url   || '').toLowerCase().includes(q))
    : sorted;

  historyList.textContent = '';
  if (!filtered.length) {
    historyList.appendChild(emptyState(
      'history',
      q ? 'No history matches your search.'
        : 'Your browsing history will appear here.'
    ));
    return;
  }

  const now = new Date();
  const today = new Date(now); today.setHours(0,0,0,0);
  const yesterday = new Date(today.getTime() - 86400000);

  const groups = { today: [], yesterday: [], older: [] };
  for (const h of filtered) {
    const t = h.visitedAt || 0;
    if (t >= today.getTime())           groups.today.push(h);
    else if (t >= yesterday.getTime())  groups.yesterday.push(h);
    else                                groups.older.push(h);
  }

  const sections = [
    ['Today',     groups.today],
    ['Yesterday', groups.yesterday],
    ['Older',     groups.older]
  ];
  for (const [label, items] of sections) {
    if (!items.length) continue;
    historyList.appendChild(
      el('div', { className: 'panel__section-header', text: label }));
    for (const h of items) {
      historyList.appendChild(renderEntryRow({
        favicon: h.favicon,
        title:   h.title || hostLabel(h.url),
        url:     h.url,
        onOpen:  (ev) => openFromEntry(h.url, ev)
      }));
    }
  }
}

historySearch.addEventListener('input', () => {
  _historyFilter = historySearch.value;
  renderHistoryPanel();
});

// ============ Downloads panel ============

function renderDownloadsPanel() {
  downloadsListEl.textContent = '';
  if (!downloadsState.length) {
    downloadsListEl.appendChild(emptyState(
      'downloads',
      'No downloads yet.'
    ));
    return;
  }
  for (const d of downloadsState) {
    const pct = Math.round((d.progress || 0) * 100);
    const isActive = (d.state === 'progressing' || d.state === 'started');
    const stateLabel =
      d.state === 'completed'   ? 'Completed' :
      d.state === 'cancelled'   ? 'Cancelled' :
      d.state === 'interrupted' ? 'Failed' :
                                  pct + '%';

    const progress = isActive
      ? el('div', { className: 'progress' },
          el('div', { className: 'progress__bar' }))
      : null;

    const text = el('div', { className: 'entry__text' },
      el('div', { className: 'entry__title', text: d.filename || '(unnamed)' }),
      el('div', { className: 'entry__url',   text: stateLabel }),
      progress
    );
    if (progress) {
      progress.querySelector('.progress__bar').style.width = pct + '%';
    }

    const row = el('div', { className: 'entry download-entry' }, text);

    if (d.state === 'completed') {
      row.appendChild(el('button', {
        className: 'entry__action', title: 'Open file',
        onClick: () => window.nooraniAPI.downloads.openFile(d.id)
      }, 'Open'));
      row.appendChild(el('button', {
        className: 'entry__action', title: 'Show in folder',
        onClick: () => window.nooraniAPI.downloads.openFolder(d.id)
      }, 'Folder'));
    } else if (isActive) {
      row.appendChild(el('button', {
        className: 'entry__action',
        onClick: () => window.nooraniAPI.downloads.cancel(d.id)
      }, 'Cancel'));
    }
    downloadsListEl.appendChild(row);
  }
}

function updateDownloadsBadge() {
  const active = downloadsState.filter(
    d => d.state === 'progressing' || d.state === 'started'
  ).length;
  if (active > 0) {
    dlBadge.hidden = false;
    dlBadge.textContent = String(active);
  } else {
    dlBadge.hidden = true;
  }
}

// ============ Shared entry row ============

function renderEntryRow({ favicon, title, url, onOpen, actions }) {
  const row = el('button', {
    className: 'entry',
    type: 'button',
    onClick: (e) => {
      if (e.target.closest('.entry__remove') ||
          e.target.closest('.entry__action')) return;
      onOpen && onOpen(e);
    }
  });
  const fav = el('img', {
    className: 'entry__favicon',
    src: favicon || FALLBACK_FAVICON,
    alt: ''
  });
  fav.onerror = () => { fav.onerror = null; fav.src = FALLBACK_FAVICON; };

  const text = el('div', { className: 'entry__text' },
    el('div', { className: 'entry__title', text: title }),
    el('div', { className: 'entry__url',   text: url })
  );
  row.append(fav, text);

  if (actions && actions.length) {
    for (const a of actions) {
      row.appendChild(el('button', {
        className: 'entry__remove', title: a.title || '', type: 'button',
        onClick: (e) => { e.stopPropagation(); a.onClick && a.onClick(); }
      }, a.label));
    }
  }
  return row;
}

function openFromEntry(url, event) {
  if (event && (event.ctrlKey || event.metaKey)) {
    createTab(url);
  } else {
    const tab = activeTab();
    if (tab) tab.webview.loadURL(url);
    closePanel();
  }
}

// ============ Bookmark bar ============

const FALLBACK_FAV_URL = FALLBACK_FAVICON;
let bookmarkBarCache     = [];
let bookmarkBarFirst     = true;
let bookmarkBarKnownUrls = new Set();
let bookmarkBarOverflow  = [];   // bookmarks that didn't fit on the bar

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function bookmarkBarModeShouldShow() {
  const mode = (currentSettings.ui && currentSettings.ui.showBookmarkBar) || 'always';
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  // 'new-tab-only' — visible only on noorani://home.
  const tab = activeTab();
  const url = tab && tab.url;
  return !!url && url.startsWith(INTERNAL_HOMEPAGE);
}

function updateBookmarkBarVisibility() {
  if (!bookmarkBarEl) return;
  const show = bookmarkBarModeShouldShow();
  // Element starts with visibility: hidden + .is-hidden so we never
  // flash a 36px strip during bootstrap. Once we've decided, reveal it.
  bookmarkBarEl.style.visibility = '';
  bookmarkBarEl.classList.toggle('is-hidden', !show);
}

function buildBookmarkItemNode(b) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bookmark-item';
  btn.title = b.title || b.url;
  btn._bookmark = b;

  const img = document.createElement('img');
  img.className = 'bookmark-item__fav';
  img.alt = '';
  img.src = b.favicon || FALLBACK_FAV_URL;
  img.onerror = () => { img.onerror = null; img.src = FALLBACK_FAV_URL; };

  const span = document.createElement('span');
  span.className = 'bookmark-item__title';
  span.textContent = truncate(b.title || hostLabel(b.url) || b.url, 20);

  btn.append(img, span);

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      createTab(b.url);
    } else {
      const tab = activeTab();
      if (tab) tab.webview.loadURL(b.url);
    }
  });
  btn.addEventListener('mousedown', (e) => {
    if (e.button === 1) {           // middle click → new tab
      e.preventDefault();
      createTab(b.url);
    }
  });
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showBookmarkContextMenu(b, btn, e.clientX, e.clientY);
  });

  return btn;
}

function renderBookmarkBar() {
  if (!bookmarkItemsEl) return;

  const items = bookmarkBarCache.slice().reverse(); // newest first
  bookmarkItemsEl.textContent = '';
  bookmarkBarOverflow = [];
  bookmarkOverflowBtn.classList.remove('is-visible');

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'bookmark-bar__empty';
    empty.textContent = 'Bookmark a page to add it here';
    bookmarkItemsEl.appendChild(empty);
    bookmarkBarKnownUrls.clear();
    bookmarkBarFirst = false;
    return;
  }

  const nodes = items.map((b) => {
    const node = buildBookmarkItemNode(b);
    // Subtle fade-in only for bookmarks that are genuinely new (not the
    // initial render).
    if (!bookmarkBarFirst && !bookmarkBarKnownUrls.has(b.url)) {
      node.classList.add('is-entering');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => node.classList.remove('is-entering'));
      });
    }
    return node;
  });
  nodes.forEach(n => bookmarkItemsEl.appendChild(n));

  bookmarkBarKnownUrls = new Set(items.map(b => b.url));
  bookmarkBarFirst = false;

  // Measure overflow after layout. Any item whose right edge exceeds the
  // container (minus 36px reserved for the overflow button) is hidden
  // and added to the dropdown list.
  requestAnimationFrame(() => {
    const containerRight = bookmarkItemsEl.getBoundingClientRect().right;
    const threshold = containerRight - 36;
    for (let i = 0; i < nodes.length; i++) {
      const r = nodes[i].getBoundingClientRect();
      if (r.right > threshold) {
        nodes[i].style.display = 'none';
        bookmarkBarOverflow.push(items[i]);
      }
    }
    if (bookmarkBarOverflow.length > 0) {
      bookmarkOverflowBtn.classList.add('is-visible');
    }
  });
}

function showBookmarkContextMenu(bookmark, _node, x, y) {
  window.nooraniContextMenu.show({
    x, y,
    items: [
      { label: 'Open',            action: () => {
        const tab = activeTab();
        if (tab) tab.webview.loadURL(bookmark.url);
      }},
      { label: 'Open in New Tab', action: () => createTab(bookmark.url) },
      { divider: true },
      { label: 'Edit…',           action: () => editBookmark(bookmark) },
      { label: 'Delete',          action: () => deleteBookmark(bookmark.url) }
    ]
  });
}

async function editBookmark(bookmark) {
  const result = await window.nooraniModal.form({
    title:   'Edit Bookmark',
    fields: [
      {
        key:         'title',
        label:       'Title',
        value:       bookmark.title || '',
        placeholder: 'Bookmark title'
      },
      {
        key:         'url',
        label:       'URL',
        value:       bookmark.url || '',
        type:        'url',
        placeholder: 'https://example.com',
        validate:    (v) => /^(https?|noorani):\/\/\S+/i.test(v)
                              ? null
                              : 'Please enter a valid URL'
      }
    ],
    confirmText: 'Save'
  });
  if (!result) return;

  const changes = {};
  const nextTitle = (result.title || '').trim();
  const nextUrl   = (result.url   || '').trim();
  if (nextTitle && nextTitle !== bookmark.title) changes.title  = nextTitle;
  if (nextUrl   && nextUrl   !== bookmark.url)   changes.newUrl = nextUrl;
  if (Object.keys(changes).length === 0) return;
  await window.nooraniAPI.bookmarks.update(bookmark.url, changes);
}

async function deleteBookmark(url) {
  await window.nooraniAPI.bookmarks.remove(url);
}

function showOverflowDropdown() {
  if (bookmarkBarOverflow.length === 0) return;
  const rect = bookmarkOverflowBtn.getBoundingClientRect();
  const items = bookmarkBarOverflow.map((b) => ({
    label: truncate(b.title || hostLabel(b.url) || b.url, 36),
    icon:  `<img src="${b.favicon || FALLBACK_FAV_URL}" alt="" width="16" height="16" style="border-radius:2px;object-fit:contain">`,
    action: () => {
      const tab = activeTab();
      if (tab) tab.webview.loadURL(b.url);
    }
  }));
  window.nooraniContextMenu.show({
    x: rect.right - 220,
    y: rect.bottom + 4,
    items
  });
}

if (bookmarkOverflowBtn) {
  bookmarkOverflowBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showOverflowDropdown();
  });
}

async function toggleBookmarkBarMode() {
  const mode = (currentSettings.ui && currentSettings.ui.showBookmarkBar) || 'always';
  const next = (mode === 'always') ? 'never' : 'always';
  const nextUi = { ...(currentSettings.ui || {}), showBookmarkBar: next };
  await window.nooraniAPI.settings.update('ui', nextUi);
}

// ============ Webview context menu ============

function buildWebviewContextMenu(tab, params) {
  const items = [];
  const wv = tab.webview;
  const ef = params.editFlags || {};
  const selection = (params.selectionText || '').trim();

  // --- Top: navigation (always present) ---
  let canBack = false, canFwd = false;
  try { canBack = wv.canGoBack(); canFwd = wv.canGoForward(); } catch (_) {}
  items.push({ label: 'Back',    disabled: !canBack,
    action: () => { try { wv.goBack();    } catch (_) {} } });
  items.push({ label: 'Forward', disabled: !canFwd,
    action: () => { try { wv.goForward(); } catch (_) {} } });
  items.push({ label: 'Reload',
    action: () => { try { wv.reload(); } catch (_) {} } });
  items.push({ divider: true });

  // --- Context-specific: link ---
  if (params.linkURL) {
    const href = params.linkURL;
    items.push({ label: 'Open Link',            action: () => wv.loadURL(href) });
    items.push({ label: 'Open Link in New Tab', action: () => createTab(href) });
    items.push({ divider: true });
    items.push({ label: 'Copy Link Address',
      action: () => navigator.clipboard.writeText(href).catch(() => {}) });
    items.push({ label: 'Save Link As…',
      action: () => { try { wv.downloadURL(href); } catch (_) {} } });
    items.push({ divider: true });
  }

  // --- Context-specific: image ---
  if ((params.mediaType === 'image' || params.hasImageContents) && params.srcURL) {
    const src = params.srcURL;
    items.push({ label: 'Open Image in New Tab', action: () => createTab(src) });
    items.push({ label: 'Save Image As…',
      action: () => { try { wv.downloadURL(src); } catch (_) {} } });
    items.push({ label: 'Copy Image',
      action: () => { try { wv.copyImageAt(params.x, params.y); } catch (_) {} } });
    items.push({ label: 'Copy Image Address',
      action: () => navigator.clipboard.writeText(src).catch(() => {}) });
    items.push({ divider: true });
  }

  // --- Context-specific: selection search ---
  if (selection) {
    const engineKey  = currentSettings.searchEngine || 'google';
    const engine     = SEARCH_ENGINES[engineKey] || SEARCH_ENGINES.google ||
                       { name: 'Google', search: 'https://www.google.com/search?q=' };
    const engineName = engine.name || 'Google';
    items.push({
      label: `Search "${truncate(selection, 30)}" with ${engineName}`,
      action: () => createTab(engine.search + encodeURIComponent(selection))
    });
    items.push({ divider: true });
  }

  // --- Editing actions ---
  // Visibility rules (per spec):
  //   Cut:    only if the element is editable AND there's a selection
  //   Copy:   only if there's a selection (works on non-editable text too)
  //   Paste:  only if the element is editable
  //   Select All: always shown
  if (params.isEditable && selection) {
    items.push({ label: 'Cut',
      action: () => { try { wv.cut(); } catch (_) {} } });
  }
  if (selection) {
    items.push({ label: 'Copy',
      action: () => { try { wv.copy(); } catch (_) {} } });
  }
  if (params.isEditable) {
    items.push({ label: 'Paste',
      action: () => { try { wv.paste(); } catch (_) {} } });
  }
  items.push({ label: 'Select All',
    action: () => { try { wv.selectAll(); } catch (_) {} } });
  items.push({ divider: true });

  // --- Print ---
  items.push({ label: 'Print…',
    action: () => { try { wv.print(); } catch (_) {} } });
  items.push({ divider: true });

  // --- Developer ---
  items.push({
    label: 'View Page Source',
    action: () => createTab('view-source:' + (params.pageURL || tab.url))
  });
  items.push({
    label: 'Inspect Element',
    action: () => {
      try { wv.inspectElement(params.x | 0, params.y | 0); }
      catch (_) {
        try { wv.openDevTools(); } catch (__) {}
      }
    }
  });

  // Clean up dividers: drop leading/trailing, collapse consecutive.
  while (items.length && items[0].divider)               items.shift();
  while (items.length && items[items.length - 1].divider) items.pop();
  const deduped = [];
  for (const it of items) {
    if (it.divider && deduped.length && deduped[deduped.length - 1].divider) continue;
    deduped.push(it);
  }
  return deduped;
}

// ============ Tab / URL-bar helpers (for context menus) ============

function duplicateTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (tab) createTab(tab.url);
}
function closeOtherTabs(keepId) {
  const others = tabs.filter(t => t.id !== keepId).map(t => t.id);
  for (const id of others) closeTab(id);
}
function closeTabsToRight(fromId) {
  const idx = tabs.findIndex(t => t.id === fromId);
  if (idx < 0) return;
  const toClose = tabs.slice(idx + 1).map(t => t.id);
  for (const id of toClose) closeTab(id);
}
function reloadTabById(id) {
  const tab = tabs.find(t => t.id === id);
  if (tab) tab.webview.reload();
}

function showTabContextMenu(tabId, x, y) {
  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx < 0) return;
  const toRightCount = tabs.length - idx - 1;
  const otherCount   = tabs.length - 1;
  window.nooraniContextMenu.show({
    x, y,
    items: [
      { label: 'Reload Tab',      action: () => reloadTabById(tabId) },
      { label: 'Duplicate Tab',   action: () => duplicateTab(tabId) },
      { divider: true },
      { label: 'Close Tab',       action: () => closeTab(tabId) },
      { label: `Close ${otherCount} Other Tab${otherCount === 1 ? '' : 's'}`,
        disabled: otherCount === 0,
        action: () => closeOtherTabs(tabId) },
      { label: `Close ${toRightCount} Tab${toRightCount === 1 ? '' : 's'} to the Right`,
        disabled: toRightCount === 0,
        action: () => closeTabsToRight(tabId) }
    ]
  });
}

function hasSelection(input) {
  return input.selectionStart != null &&
         input.selectionEnd   != null &&
         input.selectionStart !== input.selectionEnd;
}
function deleteSelection(input) {
  const s = input.selectionStart, e = input.selectionEnd;
  if (s == null || s === e) return;
  input.value = input.value.slice(0, s) + input.value.slice(e);
  input.selectionStart = input.selectionEnd = s;
}

function showUrlBarContextMenu(x, y) {
  const sel = hasSelection(urlInput);
  const hasVal = urlInput.value.length > 0;
  window.nooraniContextMenu.show({
    x, y,
    items: [
      { label: 'Cut',           disabled: !sel,    action: () => {
        urlInput.focus();
        try { document.execCommand('cut'); } catch (_) {}
      }},
      { label: 'Copy',          disabled: !sel,    action: () => {
        const s = urlInput.selectionStart, e = urlInput.selectionEnd;
        const text = urlInput.value.slice(s, e);
        if (text) navigator.clipboard.writeText(text).catch(() => {});
      }},
      { label: 'Paste',         action: async () => {
        try {
          const text = await navigator.clipboard.readText();
          urlInput.focus();
          const s = urlInput.selectionStart || 0;
          const e = urlInput.selectionEnd   || 0;
          urlInput.value = urlInput.value.slice(0, s) + text + urlInput.value.slice(e);
          urlInput.selectionStart = urlInput.selectionEnd = s + text.length;
        } catch (_) {}
      }},
      { label: 'Paste and Go',  action: async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) navigate(text.trim());
        } catch (_) {}
      }},
      { divider: true },
      { label: 'Select All',    disabled: !hasVal, action: () => {
        urlInput.focus(); urlInput.select();
      }},
      { label: 'Delete',        disabled: !sel,    action: () => {
        deleteSelection(urlInput);
      }}
    ]
  });
}

urlInput.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  showUrlBarContextMenu(e.clientX, e.clientY);
});

// Global fallback: kill the built-in browser context menu on the chrome.
// Specific handlers (URL bar, tabs, bookmarks, webview) have already
// fired by the time this listener runs; webview events fire inside the
// guest and are preventDefault()'d there separately.
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Re-measure overflow on resize (debounced via rAF chain).
let _bookmarkResizeScheduled = false;
window.addEventListener('resize', () => {
  if (_bookmarkResizeScheduled) return;
  _bookmarkResizeScheduled = true;
  requestAnimationFrame(() => {
    _bookmarkResizeScheduled = false;
    renderBookmarkBar();
  });
});

// ============ Live data subscriptions ============

const api = window.nooraniAPI;

if (api && api.downloads) {
  api.downloads.onUpdate((list) => {
    downloadsState = list || [];
    updateDownloadsBadge();
    if (panelEl.dataset.current === 'downloads' && !panelEl.hidden) {
      renderDownloadsPanel();
    }
  });
  api.downloads.get().then((list) => {
    downloadsState = list || [];
    updateDownloadsBadge();
  });
}

if (api && api.bookmarks && api.bookmarks.onChange) {
  api.bookmarks.onChange((list) => {
    bookmarkBarCache = Array.isArray(list) ? list : [];
    renderBookmarkBar();
    syncStar();
    if (panelEl.dataset.current === 'bookmarks' && !panelEl.hidden) {
      renderBookmarksPanel();
    }
  });
}

if (api && api.history && api.history.onChange) {
  api.history.onChange(() => {
    if (panelEl.dataset.current === 'history' && !panelEl.hidden) {
      renderHistoryPanel();
    }
  });
}

if (api && api.settings && api.settings.onChange) {
  api.settings.onChange((next) => {
    currentSettings = { ...currentSettings, ...next };
    applyTheme(next._effectiveTheme || next.theme);
    updateBookmarkBarVisibility();
    // Note: engine / homepage updates apply to next actions;
    // we don't retroactively change current tabs' URLs.
  });
}

// ============ Startup ============

async function boot() {
  try {
    const [settings, engines] = await Promise.all([
      api ? api.settings.get()      : null,
      api ? api.search.getEngines() : null
    ]);
    if (engines) SEARCH_ENGINES = engines;
    if (settings) {
      currentSettings = settings;
      applyTheme(settings._effectiveTheme || settings.theme);
    }
  } catch (err) {
    console.error('[noorani] settings bootstrap failed:', err);
  }

  // Bookmarks load independently so any failure here doesn't knock out
  // the rest of the chrome.
  if (api && api.bookmarks) {
    api.bookmarks.get().then((list) => {
      bookmarkBarCache = Array.isArray(list) ? list : [];
      renderBookmarkBar();
    }).catch((err) => {
      console.error('[noorani] bookmarks load failed:', err);
    });
  }
  updateBookmarkBarVisibility();

  // First-run: open welcome instead of the homepage. Subsequent launches
  // take the normal path via getHomepage().
  const needsOnboarding = !!(currentSettings.onboarding &&
                             !currentSettings.onboarding.complete);
  createTab(needsOnboarding ? INTERNAL_WELCOME : undefined);
  focusURLBar();
}

boot();
