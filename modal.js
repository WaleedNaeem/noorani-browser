// Noorani Browser — modal.js
//
// A theme-aware, self-contained confirm-modal module.
// Exposes window.nooraniModal.confirm(opts) -> Promise<boolean>.
//
// Works in any document (file:// chrome, noorani:// internal pages) as long
// as it has access to the DOM. Injects its own <style> on first use, so no
// external CSS is required.
//
// Usage:
//   const ok = await nooraniModal.confirm({
//     title: 'Clear Browsing Data',
//     message: 'This will permanently delete:',
//     details: ['Browsing history', 'Bookmarks'],
//     confirmText: 'Clear Data',
//     variant: 'danger'
//   });
//   if (ok) { ... }

(function () {
  if (window.nooraniModal) return;

  const STYLE_ID = '__noorani_modal_style';
  // Self-contained palette keyed off :root[data-theme] so this works in every
  // Noorani page regardless of which CSS-variable names that page uses.
  const CSS = `
    :root {
      --nm-bg:       #ffffff;
      --nm-text:     #2a2a2a;
      --nm-muted:    #6b6b6b;
      --nm-border:   #e8e2d5;
      --nm-hover:    rgba(0,0,0,0.05);
      --nm-accent:   #c9a961;
      --nm-danger:   #c0392b;
      --nm-danger-h: #a93226;
    }
    :root[data-theme="dark"] {
      --nm-bg:       #252525;
      --nm-text:     #e8e8e8;
      --nm-muted:    #9a9a9a;
      --nm-border:   #3a3a3a;
      --nm-hover:    rgba(255,255,255,0.06);
      --nm-accent:   #d4af37;
      --nm-danger:   #e74c3c;
      --nm-danger-h: #c0392b;
    }

    .noorani-modal__backdrop {
      position: fixed; inset: 0;
      z-index: 99999;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 150ms ease-out;
      font-family: var(--font-sans, 'Inter', -apple-system, BlinkMacSystemFont,
                   "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
    }
    .noorani-modal__backdrop.is-open { opacity: 1; }

    .noorani-modal__card {
      background: var(--nm-bg);
      color: var(--nm-text);
      border: 1px solid var(--nm-border);
      border-radius: 12px;
      width: 100%;
      max-width: 440px;
      margin: 16px;
      padding: 24px 26px 20px;
      box-shadow: 0 20px 48px rgba(0,0,0,0.25);
      transform: translateY(8px) scale(0.98);
      transition: transform 150ms ease-out;
    }
    .noorani-modal__backdrop.is-open .noorani-modal__card {
      transform: translateY(0) scale(1);
    }

    .noorani-modal__title {
      font-family: var(--font-serif, 'DM Serif Display', Georgia, serif);
      font-size: 20px;
      font-weight: 400;
      margin: 0 0 10px 0;
      color: var(--nm-text);
    }
    .noorani-modal__message {
      font-size: 15px;
      line-height: 1.5;
      color: var(--nm-muted);
      margin: 0 0 12px 0;
    }
    .noorani-modal__details {
      margin: 0 0 18px 0;
      padding-left: 22px;
      color: var(--nm-muted);
      font-size: 14px;
      line-height: 1.7;
    }
    .noorani-modal__details li { margin: 0; }

    .noorani-modal__actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 6px;
    }
    .noorani-modal__btn {
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      padding: 9px 18px;
      border-radius: 6px;
      cursor: pointer;
      border: 1px solid transparent;
      outline: none;
      transition: background-color 120ms ease, border-color 120ms ease,
                  box-shadow 120ms ease, filter 120ms ease;
    }
    .noorani-modal__btn:focus-visible {
      box-shadow: 0 0 0 2px var(--nm-accent);
    }
    .noorani-modal__btn--cancel {
      background: transparent;
      color: var(--nm-text);
      border-color: var(--nm-border);
    }
    .noorani-modal__btn--cancel:hover { background: var(--nm-hover); }
    .noorani-modal__btn--confirm {
      background: var(--nm-accent);
      color: #ffffff;
      border-color: var(--nm-accent);
    }
    .noorani-modal__btn--confirm:hover { filter: brightness(0.95); }
    .noorani-modal__btn--danger {
      background: var(--nm-danger);
      color: #ffffff;
      border-color: var(--nm-danger);
    }
    .noorani-modal__btn--danger:hover {
      background: var(--nm-danger-h);
      border-color: var(--nm-danger-h);
    }
    .noorani-modal__btn--danger:focus-visible {
      box-shadow: 0 0 0 2px var(--nm-danger);
    }
  `;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function confirmDialog(opts) {
    opts = opts || {};
    const title       = opts.title       || 'Confirm';
    const message     = opts.message     || '';
    const confirmText = opts.confirmText || 'Confirm';
    const cancelText  = opts.cancelText  || 'Cancel';
    const variant     = opts.variant === 'danger' ? 'danger' : 'default';
    const details     = Array.isArray(opts.details) ? opts.details : null;

    injectStyle();

    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'noorani-modal__backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');

      const card = document.createElement('div');
      card.className = 'noorani-modal__card';

      const h = document.createElement('h2');
      h.className = 'noorani-modal__title';
      h.textContent = title;
      card.appendChild(h);

      if (message) {
        const m = document.createElement('p');
        m.className = 'noorani-modal__message';
        m.textContent = message;
        card.appendChild(m);
      }

      if (details && details.length) {
        const ul = document.createElement('ul');
        ul.className = 'noorani-modal__details';
        for (const d of details) {
          const li = document.createElement('li');
          li.textContent = d;
          ul.appendChild(li);
        }
        card.appendChild(ul);
      }

      const actions = document.createElement('div');
      actions.className = 'noorani-modal__actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'noorani-modal__btn noorani-modal__btn--cancel';
      cancelBtn.textContent = cancelText;

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'noorani-modal__btn ' +
        (variant === 'danger'
          ? 'noorani-modal__btn--danger'
          : 'noorani-modal__btn--confirm');
      confirmBtn.textContent = confirmText;

      actions.append(cancelBtn, confirmBtn);
      card.appendChild(actions);
      backdrop.appendChild(card);

      const prevFocus = document.activeElement;
      let resolved = false;

      function cleanup() {
        document.removeEventListener('keydown', onKey, true);
        backdrop.classList.remove('is-open');
        setTimeout(() => {
          if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
          if (prevFocus && typeof prevFocus.focus === 'function') {
            try { prevFocus.focus(); } catch (_) {}
          }
        }, 150);
      }
      function finish(value) {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(value);
      }

      cancelBtn.addEventListener('click', () => finish(false));
      confirmBtn.addEventListener('click', () => finish(true));

      backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) finish(false);
      });

      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        } else if (e.key === 'Enter') {
          if (document.activeElement !== cancelBtn) {
            e.preventDefault();
            e.stopPropagation();
            finish(true);
          }
        } else if (e.key === 'Tab') {
          // Focus trap — cycle between cancel and confirm only.
          e.preventDefault();
          if (document.activeElement === cancelBtn) confirmBtn.focus();
          else cancelBtn.focus();
        }
      }
      document.addEventListener('keydown', onKey, true);

      document.body.appendChild(backdrop);
      // Force reflow, then animate in.
      // eslint-disable-next-line no-unused-expressions
      backdrop.offsetHeight;
      backdrop.classList.add('is-open');

      // Cancel gets focus first — safer default for destructive actions.
      setTimeout(() => cancelBtn.focus(), 0);
    });
  }

  window.nooraniModal = { confirm: confirmDialog };
})();
