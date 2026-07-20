
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