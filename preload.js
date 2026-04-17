// Noorani Browser — preload.js
//
// Runs in the chrome renderer with Node access, bridges a minimal API onto
// window.nooraniAPI via contextBridge. contextIsolation stays TRUE and
// nodeIntegration stays FALSE; the renderer never sees fs / ipcRenderer.

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function subscribe(channel) {
  return (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, ...args) => {
      try { callback(...args); } catch (_) { /* swallow */ }
    };
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('nooraniAPI', {
  // Menu-accelerator events from main ---------------------------------------
  onShortcut: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, action, ...args) => {
      try { callback(action, ...args); } catch (_) { /* swallow */ }
    };
    ipcRenderer.on('shortcut', handler);
    return () => ipcRenderer.removeListener('shortcut', handler);
  },

  bookmarks: {
    get:    ()      => invoke('bookmarks:get'),
    has:    (url)   => invoke('bookmarks:has', url),
    add:    (entry) => invoke('bookmarks:add', entry),
    remove: (url)   => invoke('bookmarks:remove', url)
  },

  history: {
    get:   ()      => invoke('history:get'),
    add:   (entry) => invoke('history:add', entry),
    clear: ()      => invoke('history:clear')
  },

  downloads: {
    get:        ()   => invoke('downloads:get'),
    openFile:   (id) => invoke('downloads:open-file', id),
    openFolder: (id) => invoke('downloads:open-folder', id),
    cancel:     (id) => invoke('downloads:cancel', id),
    onUpdate:   subscribe('downloads:update')
  },

  home: {
    getTopSites: () => invoke('home:top-sites')
  },

  app: {
    getDataDir: () => invoke('app:data-dir')
  }
});
