// Noorani Browser — renderer.js
// Runs in the host page's renderer process with contextIsolation=true and
// nodeIntegration=false. Only standard DOM APIs plus Electron's <webview>
// element API are available here; no Node access.

const view       = document.getElementById('view');
const urlInput   = document.getElementById('url');
const backBtn    = document.getElementById('back');
const forwardBtn = document.getElementById('forward');
const reloadBtn  = document.getElementById('reload');

const HOMEPAGE = 'https://www.google.com';

// --- URL parsing -----------------------------------------------------------

// Decide whether user input should be treated as a URL or a search query.
// Rules (checked in order):
//   1. If it already has a known protocol, use as-is.
//   2. localhost or localhost:port -> http://...
//   3. Bare IPv4 (optionally with port/path) -> http://...
//   4. No spaces AND the host portion before /?# contains a dot -> https://...
//   5. Otherwise, Google search.
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
  if (target) view.loadURL(target);
}

// --- Nav button state ------------------------------------------------------

function updateNavButtons() {
  // canGoBack / canGoForward throw before the webview's webContents exists,
  // so guard with try/catch for safety on early calls.
  try {
    backBtn.disabled    = !view.canGoBack();
    forwardBtn.disabled = !view.canGoForward();
  } catch {
    backBtn.disabled    = true;
    forwardBtn.disabled = true;
  }
}

// --- Toolbar wiring --------------------------------------------------------

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    navigate(urlInput.value);
    urlInput.blur();
  }
});

backBtn.addEventListener('click', () => {
  if (view.canGoBack()) view.goBack();
});
forwardBtn.addEventListener('click', () => {
  if (view.canGoForward()) view.goForward();
});
reloadBtn.addEventListener('click', () => view.reload());

// --- Webview events --------------------------------------------------------

// Full-page navigations (user clicks a link, submits a form, etc.)
view.addEventListener('did-navigate', (e) => {
  urlInput.value = e.url;
  updateNavButtons();
});

// In-page navigations (hash changes, history.pushState from SPAs)
view.addEventListener('did-navigate-in-page', (e) => {
  urlInput.value = e.url;
  updateNavButtons();
});

view.addEventListener('page-title-updated', (e) => {
  document.title = e.title ? `${e.title} - Noorani Browser` : 'Noorani Browser';
});

view.addEventListener('dom-ready', () => {
  // First moment canGoBack/canGoForward are safe to call.
  updateNavButtons();
  if (!urlInput.value) urlInput.value = view.getURL() || HOMEPAGE;
});

// --- Global keyboard shortcuts --------------------------------------------

document.addEventListener('keydown', (e) => {
  // Ctrl+L -> focus and select URL bar
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    urlInput.focus();
    urlInput.select();
    return;
  }

  // F5 or Ctrl+R -> reload webview
  if (e.key === 'F5' || (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'r')) {
    e.preventDefault();
    view.reload();
    return;
  }

  // Alt+Left -> back
  if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    if (view.canGoBack()) view.goBack();
    return;
  }

  // Alt+Right -> forward
  if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault();
    if (view.canGoForward()) view.goForward();
    return;
  }
});

// --- Initial state ---------------------------------------------------------

urlInput.value = HOMEPAGE;
updateNavButtons();
