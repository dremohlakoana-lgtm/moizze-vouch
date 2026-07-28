/* ═══════════════════════════════════════════════
   Moizze App — Shared Utilities & API Layer
═══════════════════════════════════════════════ */

const API_BASE = '/api';

/* ─── Auth Helpers ──────────────────────────── */
const Auth = {
  getToken() { return localStorage.getItem('moizze_token'); },
  getUser() {
    try { return JSON.parse(localStorage.getItem('moizze_user') || 'null'); } catch { return null; }
  },
  setSession(token, user) {
    localStorage.setItem('moizze_token', token);
    localStorage.setItem('moizze_user', JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem('moizze_token');
    localStorage.removeItem('moizze_user');
  },
  isLoggedIn() { return !!this.getToken(); },
  isAdmin() { const u = this.getUser(); return u && u.role === 'admin'; },
  requireAuth() {
    if (!this.isLoggedIn()) {
      window.location.href = '/index.html';
      return false;
    }
    return true;
  },
  requireAdmin() {
    if (!this.isLoggedIn()) { window.location.href = '/index.html'; return false; }
    if (!this.isAdmin()) { window.location.href = '/dashboard.html'; return false; }
    return true;
  },
  logout() {
    this.clear();
    window.location.href = '/index.html';
  }
};

/* ─── API Helper ────────────────────────────── */
async function apiCall(method, endpoint, data = null, isPublic = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (!isPublic) {
    const token = Auth.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const options = { method, headers };
  if (data && method !== 'GET') options.body = JSON.stringify(data);

  const response = await fetch(`${API_BASE}${endpoint}`, options);
  const json = await response.json();

  if (response.status === 401) {
    Auth.clear();
    window.location.href = '/index.html';
    return null;
  }

  return json;
}

const api = {
  get: (ep) => apiCall('GET', ep),
  post: (ep, data, pub) => apiCall('POST', ep, data, pub),
  put: (ep, data) => apiCall('PUT', ep, data),
  delete: (ep) => apiCall('DELETE', ep),
};

/* ─── Toast Notifications ───────────────────── */
let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function showToast(message, type = 'info', duration = 4000) {
  const container = getToastContainer();
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span style="font-size:18px">${icons[type] || 'ℹ️'}</span>
    <span style="flex:1">${escapeHtml(message)}</span>
    <span onclick="this.parentElement.remove()" style="cursor:pointer;color:var(--text-dim);font-size:18px;padding-left:8px">×</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ─── Format Helpers ────────────────────────── */
function formatVouch(amount, showSymbol = true) {
  const num = parseFloat(amount || 0);
  const formatted = num.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return showSymbol ? `V ${formatted}` : formatted;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return formatDate(dateStr);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function getTxnIcon(type, direction) {
  const icons = {
    transfer: direction === 'credit' ? '↙' : '↗',
    deposit: '⬇',
    withdrawal: '⬆',
    admin_credit: '🎁',
    admin_debit: '✂',
    refund: '↩',
  };
  return icons[type] || '◈';
}

function getTxnDescription(txn, currentUserId) {
  if (txn.type === 'transfer') {
    if (txn.direction === 'credit' || txn.receiver_id == currentUserId) {
      return `From ${txn.sender_name || 'Unknown'}`;
    }
    return `To ${txn.receiver_name || 'Unknown'}`;
  }
  return txn.description || txn.type.replace('_', ' ');
}

/* ─── Button Loading ─────────────────────────── */
function setLoading(btn, loading) {
  if (loading) {
    btn.disabled = true;
    btn.classList.add('btn-loading');
    btn._originalText = btn.innerHTML;
    btn.innerHTML = '';
  } else {
    btn.disabled = false;
    btn.classList.remove('btn-loading');
    if (btn._originalText) btn.innerHTML = btn._originalText;
  }
}

/* ─── Sidebar & Mobile Nav ───────────────────── */
function initSidebar() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      if (overlay) overlay.classList.toggle('open');
    });
  }

  if (overlay) {
    overlay.addEventListener('click', () => {
      if (sidebar) sidebar.classList.remove('open');
      overlay.classList.remove('open');
    });
  }

  // Set active nav item
  const currentPath = window.location.pathname.split('/').pop() || 'dashboard.html';
  document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(item => {
    const href = item.getAttribute('href') || '';
    if (href === currentPath || href.endsWith(currentPath)) {
      item.classList.add('active');
    }
  });
}

/* ─── User Header Info ───────────────────────── */
function initUserHeader() {
  const user = Auth.getUser();
  if (!user) return;

  const nameEl = document.getElementById('headerUserName');
  const avatarEl = document.getElementById('headerAvatar');
  const roleEl = document.getElementById('headerRole');

  if (nameEl) nameEl.textContent = user.full_name;
  if (avatarEl) avatarEl.textContent = getInitials(user.full_name);
  if (roleEl) roleEl.textContent = user.role === 'admin' ? '👑 Admin' : '👤 User';
}

/* ─── Load Notifications Count ───────────────── */
async function loadNotifCount() {
  try {
    const res = await api.get('/wallet/notifications');
    if (res && res.success) {
      const badge = document.getElementById('notifBadge');
      if (badge) {
        if (res.unread_count > 0) {
          badge.textContent = res.unread_count > 9 ? '9+' : res.unread_count;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }
    }
  } catch (e) {}
}

/* ─── DOM Ready ──────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Check auth on protected pages
  const publicPages = ['index.html', ''];
  const currentPage = window.location.pathname.split('/').pop();
  const isAdminPage = window.location.pathname.includes('/admin/');

  if (!publicPages.includes(currentPage)) {
    if (!Auth.requireAuth()) return;
  }

  if (isAdminPage) {
    if (!Auth.requireAdmin()) return;
  }

  initSidebar();
  initUserHeader();
  loadNotifCount();

  // Logout button
  document.querySelectorAll('[data-action="logout"]').forEach(btn => {
    btn.addEventListener('click', () => Auth.logout());
  });

  // Notification bell
  const notifBell = document.getElementById('notifBell');
  if (notifBell) {
    notifBell.addEventListener('click', () => {
      window.location.href = '/transactions.html';
    });
  }
});
