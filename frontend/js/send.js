/* Send Vouch JS */
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

  const form = document.getElementById('sendForm');
  const amountInput = document.getElementById('sendAmount');
  const accountInput = document.getElementById('receiverAccount');
  const confirmBox = document.getElementById('confirmBox');

  // Show confirm preview when amount changes
  amountInput.addEventListener('input', updateConfirm);
  accountInput.addEventListener('input', updateConfirm);

  function updateConfirm() {
    const acc = accountInput.value.trim();
    const amt = parseFloat(amountInput.value);
    if (acc.length === 10 && amt > 0 && confirmBox) {
      confirmBox.classList.remove('hidden');
      document.getElementById('confirmReceiverAcc').textContent = acc;
      document.getElementById('confirmAmount').textContent = formatVouch(amt);
    } else if (confirmBox) {
      confirmBox.classList.add('hidden');
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('sendBtn');

    const receiver_account_number = accountInput.value.trim();
    const amount = parseFloat(amountInput.value);
    const description = document.getElementById('sendDescription').value.trim();

    if (receiver_account_number.length !== 10) {
      showToast('Please enter a valid 10-digit account number.', 'error');
      return;
    }

    if (amount <= 0) {
      showToast('Please enter a valid amount.', 'error');
      return;
    }

    if (amount > currentBalance) {
      showToast('Insufficient Vouch balance.', 'error');
      return;
    }

    setLoading(btn, true);
    try {
      const res = await api.post('/wallet/send', {
        receiver_account_number,
        amount,
        description: description || undefined,
      });

      if (res && res.success) {
        showToast(res.message, 'success');
        currentBalance = res.new_balance;
        const el = document.getElementById('displayBalance');
        if (el) el.textContent = formatVouch(res.new_balance);

        // Reset form
        form.reset();
        if (confirmBox) confirmBox.classList.add('hidden');

        // Show success
        setTimeout(() => {
          window.location.href = '/dashboard.html';
        }, 2000);
      } else {
        showToast(res?.message || 'Transfer failed.', 'error');
      }
    } catch (err) {
      showToast('Connection error. Please try again.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
});
