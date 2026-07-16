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
