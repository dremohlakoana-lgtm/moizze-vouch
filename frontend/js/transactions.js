/* Transactions JS */
let currentPage = 1;
let totalPages = 1;

async function loadTransactions(page = 1) {
  const container = document.getElementById('txnContainer');
  const paginationEl = document.getElementById('pagination');
  if (!container) return;

  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  try {
    const res = await api.get(`/wallet/transactions?page=${page}&limit=20`);

    if (!res || !res.success) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><div class="empty-state-text">Failed to load transactions</div></div>';
      return;
    }

    if (res.transactions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-text">No transactions yet</div>
          <div class="empty-state-sub">Start by buying or receiving Vouch</div>
        </div>`;
      if (paginationEl) paginationEl.classList.add('hidden');
      return;
    }

    const currentUser = Auth.getUser();
    totalPages = res.pagination.pages;
    currentPage = page;

    container.innerHTML = `<div class="txn-list">${
      res.transactions.map(t => {
        const isCredit = t.direction === 'credit';
        const iconClass = isCredit ? 'credit' : (t.status === 'pending' ? 'pending' : 'debit');
        const icon = getTxnIcon(t.type, t.direction);
        const desc = getTxnDescription(t, currentUser.id);
        const statusBadge = t.status !== 'completed'
          ? `<span class="badge badge-${t.status === 'pending' ? 'warning' : 'danger'}" style="font-size:11px;padding:2px 8px">${t.status}</span>`
          : '';
        return `
          <div class="txn-item">
            <div class="txn-icon ${iconClass}">${icon}</div>
            <div class="txn-info">
              <div class="txn-name" style="display:flex;align-items:center;gap:8px">
                ${escapeHtml(desc)} ${statusBadge}
              </div>
              <div class="txn-date">${formatDateTime(t.created_at)}</div>
              <div class="txn-ref">${t.transaction_ref}</div>
            </div>
            <div class="txn-amount ${isCredit ? 'credit' : 'debit'}">
              ${isCredit ? '+' : '-'}${formatVouch(t.amount)}
            </div>
          </div>`;
      }).join('')
    }</div>`;

    // Pagination
    if (paginationEl) {
      if (totalPages > 1) {
        paginationEl.classList.remove('hidden');
        let html = '';
        if (currentPage > 1) {
          html += `<div class="page-btn" onclick="loadTransactions(${currentPage - 1})">‹</div>`;
        }
        for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
          html += `<div class="page-btn ${i === currentPage ? 'active' : ''}" onclick="loadTransactions(${i})">${i}</div>`;
        }
        if (currentPage < totalPages) {
          html += `<div class="page-btn" onclick="loadTransactions(${currentPage + 1})">›</div>`;
        }
        paginationEl.innerHTML = html;
      } else {
        paginationEl.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error('Txn error:', err);
    container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Failed to load transactions</div></div>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadTransactions(1);
});
