// Noorani Browser — contextmenu.js
//
// A reusable right-click menu that matches the app's design. Single
// public API:
//
//   nooraniContextMenu.show({
//     x: number,       // viewport-relative
//     y: number,       // viewport-relative
//     items: [ { label, action, divider?, disabled?, icon? } ]
//   });
//   nooraniContextMenu.hide();
//
// Lives in the chrome renderer only (index.html). Webview context-menu
// events are intercepted there; the menu is positioned over the webview.

(function () {
  if (window.nooraniContextMenu) return;

  const STYLE_ID = '__noorani_ctxmenu_style';
  const CSS = `
    :root {
      --ncm-bg:       #ffffff;
      --ncm-text:     #2a2a2a;
      --ncm-muted:    #6b6b6b;
      --ncm-border:   #e8e2d5;
      --ncm-hover:    #f0ece5;
    }
    :root[data-theme="dark"] {
      --ncm-bg:       #252525;
      --ncm-text:     #e8e8e8;
      --ncm-muted:    #9a9a9a;
      --ncm-border:   #3a3a3a;
      --ncm-hover:    #2d2d2d;
    }

    .noorani-ctxmenu {
      position: fixed;
      z-index: 100000;
      min-width: 220px;
      max-width: 320px;
      background: var(--ncm-bg);
      color: var(--ncm-text);
      border: 1px solid var(--ncm-border);
      border-radius: 8px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
      padding: 4px;
      font-family: var(--font-sans, 'Inter', -apple-system,
                   BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: 14px;
      opacity: 0;
      transform: translateY(-2px);
      transition: opacity 100ms ease-out, transform 100ms ease-out;
      user-select: none;
    }
    .noorani-ctxmenu.is-open {
      opacity: 1;
      transform: translateY(0);
    }
    .noorani-ctxmenu__item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      height: 32px;
      padding: 0 12px;
      background: transparent;
      border: none;
      border-radius: 4px;
      text-align: left;
      color: inherit;
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .noorani-ctxmenu__item:hover:not(.is-disabled) {
      background: var(--ncm-hover);
    }
    .noorani-ctxmenu__item.is-disabled {
      opacity: 0.4;
      cursor: default;
    }
    .noorani-ctxmenu__label {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .noorani-ctxmenu__icon {
      flex: 0 0 16px;
      width: 16px; height: 16px;
      color: var(--ncm-muted);
      display: inline-flex;
      align-items: center; justify-content: center;
    }
    .noorani-ctxmenu__icon svg {
      width: 16px; height: 16px;
      display: block;
    }
    .noorani-ctxmenu__divider {
      height: 1px;
      background: var(--ncm-border);
      margin: 4px 8px;
    }
  `;

  let currentMenu = null;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function hide() {
    if (!currentMenu) return;
    const m = currentMenu;
    currentMenu = null;
    if (m._dismissers) {
      document.removeEventListener('mousedown',   m._dismissers.onDown, true);
      document.removeEventListener('contextmenu', m._dismissers.onDown, true);
      document.removeEventListener('keydown',     m._dismissers.onKey,  true);
      window.removeEventListener('blur',          m._dismissers.onBlur);
      window.removeEventListener('resize',        m._dismissers.onBlur);
    }
    m.classList.remove('is-open');
    setTimeout(() => { if (m.parentNode) m.parentNode.removeChild(m); }, 120);
  }

  function show(opts) {
    opts = opts || {};
    const items = Array.isArray(opts.items) ? opts.items : [];
    if (items.length === 0) return;

    hide();
    injectStyle();

    const menu = document.createElement('div');
    menu.className = 'noorani-ctxmenu';
    menu.setAttribute('role', 'menu');

    for (const item of items) {
      if (item && item.divider) {
        const d = document.createElement('div');
        d.className = 'noorani-ctxmenu__divider';
        menu.appendChild(d);
        continue;
      }
      if (!item || typeof item.label !== 'string') continue;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'noorani-ctxmenu__item';
      btn.setAttribute('role', 'menuitem');

      if (item.icon) {
        const iconWrap = document.createElement('span');
        iconWrap.className = 'noorani-ctxmenu__icon';
        iconWrap.innerHTML = item.icon;
        btn.appendChild(iconWrap);
      }

      const label = document.createElement('span');
      label.className = 'noorani-ctxmenu__label';
      label.textContent = item.label;
      btn.appendChild(label);

      if (item.disabled) {
        btn.classList.add('is-disabled');
        btn.disabled = true;
      } else {
        btn.addEventListener('click', () => {
          hide();
          try { item.action && item.action(); } catch (err) {
            console.error('[noorani] context menu action failed:', err);
          }
        });
      }
      menu.appendChild(btn);
    }

    document.body.appendChild(menu);
    currentMenu = menu;

    // Position after layout so we can measure and flip against edges.
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      const W = window.innerWidth;
      const H = window.innerHeight;
      let left = opts.x || 0;
      let top  = opts.y || 0;
      if (left + rect.width  > W - 4) left = Math.max(4, left - rect.width);
      if (top  + rect.height > H - 4) top  = Math.max(4, top  - rect.height);
      if (left + rect.width  > W - 4) left = W - rect.width  - 4;
      if (top  + rect.height > H - 4) top  = H - rect.height - 4;
      menu.style.left = Math.max(4, left) + 'px';
      menu.style.top  = Math.max(4, top)  + 'px';
      menu.classList.add('is-open');
    });

    // Dismiss handlers — attach after the triggering event has finished.
    const onDown = (e) => {
      if (!menu.contains(e.target)) hide();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); hide(); }
    };
    const onBlur = () => hide();
    setTimeout(() => {
      document.addEventListener('mousedown',   onDown, true);
      document.addEventListener('contextmenu', onDown, true);
      document.addEventListener('keydown',     onKey,  true);
      window.addEventListener('blur',          onBlur);
      window.addEventListener('resize',        onBlur);
    }, 0);
    menu._dismissers = { onDown, onKey, onBlur };
  }

  window.nooraniContextMenu = { show, hide };
})();
