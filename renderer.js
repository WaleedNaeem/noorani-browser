// Noorani Browser — renderer.js (Phase 4: bookmarks/history/downloads/home)
//
// Runs with contextIsolation=true, nodeIntegration=false.
// All disk-touching operations go through window.nooraniAPI (see preload.js).

// ------- DOM refs: toolbar / tabs --------
const tabsEl        = document.getElementById('tabs');
const newTabBtn     = document.getElementById('new-tab');
const contentEl     = document.getElementById('content');
const urlInput      = document.getElementById('url');
const backBtn       = document.getElementById('back');
const forwardBtn    = document.getElementById('forward');
const reloadBtn     = document.getElementById('reload');
const homeBtn       = document.getElementById('home-btn');
const starBtn       = document.getElementById('star-btn');
const bookmarksBtn  = document.getElementById('bookmarks-btn');
const historyBtn    = document.getElementById('history-btn');
const downloadsBtn  = document.getElementById('downloads-btn');
const dlBadge       = document.getElementById('dl-badge');

// ------- DOM refs: panel --------
const panelEl       = document.getElementById('panel');
const panelTitle    = document.getElementById('panel-title');
const panelClose    = document.getElementById('panel-close');
const panelClear    = document.getElementById('panel-clear');
const bookmarksList = document.getElementById('bookmarks-list');
const historyList   = document.getElementById('history-list');
const downloadsListEl = document.getElementById('downloads-list');
const historySearch = document.getElementById('history-search');

// ------- Constants --------
const HOMEPAGE = 'noorani://home';

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

// ------- State --------
const tabs = [];
let currentTabId = null;
let nextIdCounter = 1;
const newId = () => 'tab-' + (nextIdCounter++);
let downloadsState = [];

function activeTab() {
  return tabs.find(t => t.id === currentTabId) || null;
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
  return 'https://www.google.com/search?q=' + encodeURIComponent(input);
}

function navigate(raw) {
  const target = parseInput(raw);
  const tab = activeTab();
  if (target && tab) tab.webview.loadURL(target);
}

// Show internal URLs as blank in the URL bar (cleaner UX).
function urlBarValueFor(url) {
  if (!url || url.startsWith('noorani:')) return '';
  return url;
}

// ============ Escape helper for innerHTML-free row rendering ============

function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className')      n.className = v;
      else if (k === 'text')       n.textContent = v;
      else if (k === 'onClick')    n.addEventListener('click', v);
      else if (v === false || v == null) continue;
      else if (v === true)         n.setAttribute(k, '');
      else                         n.setAttribute(k, v);
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

// ============ Tab creation ============

function createTab(url = HOMEPAGE) {
  const id = newId();

  const webview = document.createElement('webview');
  webview.setAttribute('src', url);
  webview.setAttribute('allowpopups', '');
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
    url,
    favicon: null,
    isLoading: true,
    _loggedUrl: null   // last URL we've committed to history
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
  tab.closeEl.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(tab.id);
  });

  const wv = tab.webview;

  wv.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    tab._loggedUrl = null;      // reset so the new URL can be logged once
    tab.title = null;           // will be refilled by page-title-updated
    tab.titleEl.textContent = hostLabel(e.url) || 'Loading…';
    if (tab.id === currentTabId) {
      urlInput.value = urlBarValueFor(e.url);
      updateNavButtons();
      syncStar();
    }
  });

  wv.addEventListener('did-navigate-in-page', (e) => {
    if (e.isMainFrame === false) return;
    tab.url = e.url;
    if (tab.id === currentTabId) {
      urlInput.value = urlBarValueFor(e.url);
      updateNavButtons();
      syncStar();
    }
  });

  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || null;
    tab.titleEl.textContent = tab.title || hostLabel(tab.url) || 'Untitled';
    tab.tabEl.title = tab.title || '';
    if (tab.id === currentTabId) syncWindowTitle();

    // Primary history commit — we have a title now.
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
  });

  wv.addEventListener('did-stop-loading', () => {
    tab.isLoading = false;
    tab.tabEl.classList.remove('loading');
    if (tab.id === currentTabId) updateNavButtons();
    // Backup history commit — for pages that never fired page-title-updated
    // (e.g., raw PDFs, file downloads that land as navigations).
    maybeLogHistory(tab);
  });

  wv.addEventListener('dom-ready', () => {
    if (tab.id === currentTabId) updateNavButtons();
  });

  wv.addEventListener('new-window', (e) => {
    try { e.preventDefault(); } catch (_) {}
    if (e.url) createTab(e.url);
  });
}

// Log each URL to history at most once per navigation.
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

  for (const t of tabs) {
    const isActive = (t.id === id);
    t.webview.classList.toggle('hidden', !isActive);
    t.tabEl.classList.toggle('active', isActive);
  }
  currentTabId = id;

  urlInput.value = urlBarValueFor(tab.url);
  syncWindowTitle();
  updateNavButtons();
  syncStar();
  tab.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];
  tab.webview.remove();
  tab.tabEl.remove();
  tabs.splice(idx, 1);

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
  if (!tab) {
    backBtn.disabled = true; forwardBtn.disabled = true;
    return;
  }
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
  // Internal pages: show just the app name, not "New Tab - Noorani Browser"
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
  focusURLBar();
});
homeBtn.addEventListener('click', () => goHome());

// ============ Shortcut action helpers ============

function focusURLBar() {
  urlInput.focus();
  urlInput.select();
}

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
function switchToIndex(n) {
  const t = tabs[n - 1];
  if (t) switchToTab(t.id);
}
function backActive()    { const t = activeTab(); if (t && t.webview.canGoBack())    t.webview.goBack(); }
function forwardActive() { const t = activeTab(); if (t && t.webview.canGoForward()) t.webview.goForward(); }
function reloadActive()  { const t = activeTab(); if (t) t.webview.reload(); }
function goHome()        { const t = activeTab(); if (t) t.webview.loadURL(HOMEPAGE); }

if (window.nooraniAPI && typeof window.nooraniAPI.onShortcut === 'function') {
  window.nooraniAPI.onShortcut((action, ...args) => {
    switch (action) {
      case 'new-tab':    createTab(); focusURLBar(); break;
      case 'close-tab':  closeActiveTab(); break;
      case 'next-tab':   cycleTab(+1); break;
      case 'prev-tab':   cycleTab(-1); break;
      case 'switch-tab': switchToIndex(args[0]); break;
      case 'back':       backActive(); break;
      case 'forward':    forwardActive(); break;
      case 'reload':     reloadActive(); break;
      case 'focus-url':  focusURLBar(); break;
      case 'home':       goHome(); break;
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
  if (panelEl.dataset.current === 'bookmarks' && !panelEl.hidden) {
    renderBookmarksPanel();
  }
});

// ============ Side panel (bookmarks / history / downloads) ============

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
  if (!confirm('Clear all browsing history? This cannot be undone.')) return;
  await window.nooraniAPI.history.clear();
  renderHistoryPanel();
});

// Esc closes the panel
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !panelEl.hidden) closePanel();
});

// ============ Bookmarks panel ============

async function renderBookmarksPanel() {
  const bookmarks = await window.nooraniAPI.bookmarks.get();
  bookmarksList.textContent = '';
  if (!bookmarks.length) {
    bookmarksList.appendChild(
      el('div', { className: 'panel__empty' },
        'No bookmarks yet. Click the star to save one.'));
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
          renderBookmarksPanel();
          syncStar();
        }
      }]
    }));
  }
}

// ============ History panel ============

let _historyFilter = '';

async function renderHistoryPanel() {
  const all = await window.nooraniAPI.history.get();
  // Newest first — history.json appends in chronological order.
  const sorted = all.slice().reverse();
  const q = _historyFilter.toLowerCase().trim();
  const filtered = q
    ? sorted.filter(h =>
        (h.title || '').toLowerCase().includes(q) ||
        (h.url   || '').toLowerCase().includes(q))
    : sorted;

  historyList.textContent = '';

  if (!filtered.length) {
    historyList.appendChild(
      el('div', { className: 'panel__empty' },
        q ? 'No history matches your search.' : 'No browsing history yet.'));
    return;
  }

  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0,0,0,0);
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);

  const groups = { today: [], yesterday: [], older: [] };
  for (const h of filtered) {
    const t = h.visitedAt || 0;
    if (t >= startOfToday.getTime())     groups.today.push(h);
    else if (t >= startOfYesterday.getTime()) groups.yesterday.push(h);
    else                                  groups.older.push(h);
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
    downloadsListEl.appendChild(
      el('div', { className: 'panel__empty' },
        'No downloads this session.'));
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

    const text = el('div', { className: 'entry__text' },
      el('div', { className: 'entry__title', text: d.filename || '(unnamed)' }),
      el('div', { className: 'entry__url',   text: stateLabel }),
      isActive
        ? el('div', { className: 'progress' },
            el('div', { className: 'progress__bar', style: `width: ${pct}%` }))
        : null
    );
    // "style" via attribute didn't apply via our el helper — apply directly:
    const bar = text.querySelector('.progress__bar');
    if (bar) bar.style.width = pct + '%';

    const row = el('div', { className: 'entry download-entry' }, text);

    if (d.state === 'completed') {
      row.appendChild(el('button', {
        className: 'entry__action',
        title: 'Open file',
        onClick: () => window.nooraniAPI.downloads.openFile(d.id)
      }, 'Open'));
      row.appendChild(el('button', {
        className: 'entry__action',
        title: 'Show in folder',
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

if (window.nooraniAPI && window.nooraniAPI.downloads) {
  window.nooraniAPI.downloads.onUpdate((list) => {
    downloadsState = list;
    updateDownloadsBadge();
    if (panelEl.dataset.current === 'downloads' && !panelEl.hidden) {
      renderDownloadsPanel();
    }
  });
  // Pull initial state (empty until a download starts this session)
  window.nooraniAPI.downloads.get().then((list) => {
    downloadsState = list || [];
    updateDownloadsBadge();
  });
}

// ============ Shared entry-row renderer ============

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
        className: 'entry__remove',
        title: a.title || '',
        type: 'button',
        onClick: (e) => {
          e.stopPropagation();
          a.onClick && a.onClick();
        }
      }, a.label));
    }
  }
  return row;
}

// Open a URL (from bookmark/history/shortcut).
// Ctrl/Meta+click → open in a new tab. Otherwise → active tab.
function openFromEntry(url, event) {
  if (event && (event.ctrlKey || event.metaKey)) {
    createTab(url);
  } else {
    const tab = activeTab();
    if (tab) tab.webview.loadURL(url);
    closePanel();
  }
}

// ============ Startup ============

createTab(HOMEPAGE);
focusURLBar();
