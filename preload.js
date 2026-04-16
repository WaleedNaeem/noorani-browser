// Noorani Browser — preload.js
//
// Runs in the renderer process but has access to Node APIs. We use
// contextBridge to expose a small, safe surface onto window.nooraniAPI.
// contextIsolation stays TRUE; nodeIntegration stays FALSE.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nooraniAPI', {
  // Subscribe to menu-accelerator-driven shortcut events from the main process.
  // callback signature: (action: string, ...args: any[]) => void
  // Returns a disposer that unsubscribes the listener.
  onShortcut: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, action, ...args) => {
      try { callback(action, ...args); } catch (_) { /* swallow */ }
    };
    ipcRenderer.on('shortcut', handler);
    return () => ipcRenderer.removeListener('shortcut', handler);
  }
});
