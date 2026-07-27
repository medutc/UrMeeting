// common.js — shared helpers for all dashboard pages
async function apiGet(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function apiPut(url, body) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function apiDelete(url) {
  const res = await fetch(url, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function requireAuth(expectedRole) {
  try {
    const { user } = await apiGet('/api/me');
    if (expectedRole && user.role !== expectedRole) {
      redirectByRole(user.role);
      return null;
    }
    return user;
  } catch (e) {
    window.location.href = '/index.html';
    return null;
  }
}

function redirectByRole(role) {
  if (role === 'superadmin') window.location.href = '/superadmin.html';
  else if (role === 'dept_admin') window.location.href = '/deptadmin.html';
  else window.location.href = '/employee.html';
}

async function logout() {
  await apiPost('/api/logout');
  window.location.href = '/index.html';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}

// ============================================================
// Light / Dark theme toggle (shared across every page)
// Persisted in localStorage, applied instantly on load (see the
// tiny inline snippet in each <head>) so there is no flash of
// the wrong theme.
// Icons expected at: images/theme-light.png (sun, shown in dark mode
// to switch back to light) and images/theme-dark.png (moon, shown in
// light mode to switch to dark) — both provided as white icons.
// ============================================================
function getStoredTheme() {
  return localStorage.getItem('urmeeting-theme') === 'dark' ? 'dark' : 'light';
}

function applyStoredTheme() {
  document.documentElement.setAttribute('data-theme', getStoredTheme());
}

function setTheme(theme) {
  localStorage.setItem('urmeeting-theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeToggleIcons();
}

function toggleTheme() {
  setTheme(getStoredTheme() === 'dark' ? 'light' : 'dark');
}

function updateThemeToggleIcons() {
  const theme = getStoredTheme();
  document.querySelectorAll('.theme-toggle-icon').forEach(img => {
    // In light mode show the moon (switch-to-dark) icon; in dark mode show the sun (switch-to-light) icon.
    img.src = theme === 'dark' ? 'images/theme-light.png' : 'images/theme-dark.png';
  });
}

// Injects the toggle button into any element matching the given selector
// (usually a topbar's button/actions row) if it isn't already present.
function initThemeToggle(containerSelector) {
  const container = document.querySelector(containerSelector);
  if (!container || document.getElementById('themeToggleBtn')) return;
  const btn = document.createElement('button');
  btn.className = 'btn btn-secondary theme-toggle-btn';
  btn.id = 'themeToggleBtn';
  btn.type = 'button';
  btn.title = 'Switch between light and dark mode';
  btn.innerHTML = '<img src="images/theme-dark.png" alt="Toggle theme" class="theme-toggle-icon">';
  btn.addEventListener('click', toggleTheme);
  container.prepend(btn);
  updateThemeToggleIcons();
}

// ============================================================
// Unread-messages notification badge on the "💬 Messages" nav
// button, shared by employee.html / deptadmin.html / superadmin.html.
// Wraps the existing <a href="/messages.html"> link with a small
// red counter that reflects the total unread count across every
// conversation, and updates live via socket.io when a new direct
// message arrives while the user is on a dashboard page.
// ============================================================
function initMessagesBadge(currentUser) {
  const link = document.querySelector('a[href="/messages.html"]');
  if (!link || !currentUser) return;

  link.classList.add('messages-link');
  let badge = link.querySelector('.messages-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'messages-badge';
    badge.id = 'messagesBadge';
    badge.style.display = 'none';
    link.appendChild(badge);
  }

  function setCount(count) {
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }

  async function refreshUnreadCount() {
    try {
      const { conversations } = await apiGet('/api/messages/conversations');
      const total = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
      setCount(total);
    } catch (e) {
      // Ignore transient errors (e.g. session hiccup); badge just stays as-is.
    }
  }

  refreshUnreadCount();

  if (typeof io === 'function') {
    const socket = io();
    socket.on('connect', () => socket.emit('register', { userId: currentUser.id }));
    // A new message arrived for us while we're on a dashboard page (not the
    // messages page itself) — refresh the total unread count.
    socket.on('direct-message', refreshUnreadCount);
    socket.on('message-deleted', refreshUnreadCount);
  }
}

// ============================================================
// confirmAction(options) — a stylish replacement for window.confirm()
// that matches the UrMeeting design system (glass card, gradient
// icon, smooth animations, light/dark theme aware).
// Returns a Promise<boolean>:
//   true  → user clicked the confirm button
//   false → user clicked Cancel, pressed Escape, or dismissed the
//           backdrop by clicking outside the modal.
//
// options = {
//   title:       string  (e.g. "Delete this account?")
//   message:     string  (optional explanatory text)
//   confirmText: string  (e.g. "Delete account", defaults to "Confirm")
//   cancelText:  string  (defaults to "Cancel")
//   icon:        'trash' | 'warning'  (defaults to 'trash')
//   target: {
//     label: string,                  (e.g. "Account to delete")
//     rows:  [{ label, value }, ...]  (key/value preview block)
//   }
// }
// ============================================================
function confirmAction(options) {
  return new Promise((resolve) => {
    const opts = options || {};
    const title       = opts.title       || 'Are you sure?';
    const message     = opts.message     || '';
    const confirmText = opts.confirmText || 'Confirm';
    const cancelText  = opts.cancelText  || 'Cancel';
    const iconKind    = opts.icon === 'warning' ? 'warning' : 'trash';
    const target      = opts.target || null;

    // Remove any leftover confirm from a previous call.
    const existing = document.getElementById('confirmRoot');
    if (existing) existing.remove();

    const svgTrash = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';
    const svgWarning = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    const iconSvg = iconKind === 'warning' ? svgWarning : svgTrash;

    const hasTarget = target && (target.label || (target.rows && target.rows.length));
    const targetHtml = hasTarget
      ? '<div class="confirm-target">'
        + (target.label ? '<div class="confirm-target-label">' + escapeHtml(target.label) + '</div>' : '')
        + (target.rows || []).map(function (r) {
            return '<div class="confirm-target-row"><span class="k">' + escapeHtml(r.label) + '</span><span class="v">' + escapeHtml(String(r.value == null ? '—' : r.value)) + '</span></div>';
          }).join('')
        + '</div>'
      : '';

    const root = document.createElement('div');
    root.id = 'confirmRoot';
    root.className = 'confirm-overlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML =
      '<div class="confirm-modal" role="document">'
      +   '<div class="confirm-icon-wrap"><div class="confirm-icon">' + iconSvg + '</div></div>'
      +   '<h3 class="confirm-title">' + escapeHtml(title) + '</h3>'
      +   (message ? '<p class="confirm-message">' + escapeHtml(message) + '</p>' : '')
      +   targetHtml
      +   '<div class="confirm-actions">'
      +     '<button type="button" class="btn btn-secondary" data-confirm-cancel>' + escapeHtml(cancelText) + '</button>'
      +     '<button type="button" class="btn btn-danger"    data-confirm-ok>'    + escapeHtml(confirmText) + '</button>'
      +   '</div>'
      + '</div>';

    document.body.appendChild(root);

    const okBtn     = root.querySelector('[data-confirm-ok]');
    const cancelBtn = root.querySelector('[data-confirm-cancel]');

    function close(value) {
      document.removeEventListener('keydown', escHandler);
      root.classList.add('is-leaving');
      setTimeout(function () { root.remove(); resolve(value); }, 180);
    }

    okBtn.addEventListener('click',     function () { close(true);  });
    cancelBtn.addEventListener('click', function () { close(false); });

    // Click outside the modal (on the dimmed backdrop) cancels.
    root.addEventListener('click', function (e) { if (e.target === root) close(false); });

    // Escape key cancels.
    function escHandler(e) { if (e.key === 'Escape') close(false); }
    document.addEventListener('keydown', escHandler);

    // Focus the Cancel button by default — prevents the destructive
    // action from firing with a stray Enter / Space press.
    setTimeout(function () { cancelBtn.focus(); }, 0);
  });
}