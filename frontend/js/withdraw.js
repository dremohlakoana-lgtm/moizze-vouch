/* Withdraw Vouch JS */
let currentBalance = 0;

async function loadBalance() {
  const res = await api.get('/wallet/balance');
  if (res && res.success) {
    currentBalance = res.balance;
    const el = document.getElementById('displayBalance');
    if (el) el.textContent = formatVouch(res.balance);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadBalance();

  const form = document.getElementById('withdrawForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('withdrawBtn');
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const bank_name = document.getElementById('bankName').value.trim();
    const account_number = document.getElementById('bankAccount').value.trim();
    const account_name = document.getElementById('accountName').value.trim();

    if (!amount || amount < 1) {
      showToast('Minimum withdrawal is V 1.00', 'error');
      return;
    }
    if (amount > currentBalance) {
      showToast('Insufficient Vouch balance.', 'error');
      return;
    }
    if (!bank_name || !account_number || !account_name) {
      showToast('Please fill in all bank details.', 'error');
      return;
    }

    setLoading(btn, true);
    try {
      const res = await api.post('/wallet/withdraw', { amount, bank_name, account_number, account_name });

      if (res && res.success) {
        showToast(res.message, 'success');
        currentBalance = res.new_balance;
        const el = document.getElementById('displayBalance');
        if (el) el.textContent = formatVouch(res.new_balance);
        form.reset();
        setTimeout(() => window.location.href = '/transactions.html', 2000);
      } else {
        showToast(res?.message || 'Withdrawal failed.', 'error');
      }
    } catch (err) {
      showToast('Connection error. Please try again.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
});
