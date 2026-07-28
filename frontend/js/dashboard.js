/* Dashboard JS */
async function loadDashboard() {
  const user = Auth.getUser();

  // Greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const greetingEl = document.getElementById('greetingText');
  if (greetingEl) greetingEl.textContent = `${greeting}, ${user.full_name.split(' ')[0]}!`;

  // Load balance
  try {
    const balRes = await api.get('/wallet/balance');
    if (balRes && balRes.success) {
      const numEl = document.getElementById('balanceNumber');
      const accEl = document.getElementById('accountNumber');
      if (numEl) numEl.textContent = formatVouch(balRes.balance, false);
      if (accEl) accEl.textContent = `Account: ${balRes.account_number}`;
    }
  } catch (e) {
    console.error('Balance load error:', e);
  }

  // Load transactions
  try {
    const txnRes = await api.get('/wallet/transactions?limit=8');
    const container = document.getElementById('txnContainer');
    if (!container) return;

    if (!txnRes || !txnRes.success || txnRes.transactions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-text">No transactions yet</div>
          <div class="empty-state-sub">Your transaction history will appear here</div>
        </div>`;
      return;
    }

    const currentUser = Auth.getUser();
    container.innerHTML = `<div class="txn-list">${
      txnRes.transactions.map(t => {
        const isCredit = t.direction === 'credit';
        const iconClass = isCredit ? 'credit' : (t.status === 'pending' ? 'pending' : 'debit');
        const icon = getTxnIcon(t.type, t.direction);
        const desc = getTxnDescription(t, currentUser.id);
        return `
          <div class="txn-item">
            <div class="txn-icon ${iconClass}">${icon}</div>
            <div class="txn-info">
              <div class="txn-name">${escapeHtml(desc)}</div>
              <div class="txn-date">${timeAgo(t.created_at)} · <span class="txn-ref">${t.transaction_ref}</span></div>
            </div>
            <div class="txn-amount ${isCredit ? 'credit' : 'debit'}">
              ${isCredit ? '+' : '-'}${formatVouch(t.amount)}
            </div>
          </div>`;
      }).join('')
    }</div>`;
  } catch (e) {
    console.error('Txn load error:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
});
