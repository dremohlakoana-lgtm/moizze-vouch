/* Deposit / Buy Vouch JS */
document.addEventListener('DOMContentLoaded', async () => {
  const amountInput = document.getElementById('depositAmount');
  const vouchPreview = document.getElementById('vouchPreview');

  // Quick select buttons
  document.querySelectorAll('.quick-amt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const amount = btn.dataset.amount;
      if (amountInput) {
        amountInput.value = amount;
        amountInput.dispatchEvent(new Event('input'));
      }
    });
  });

  // Live preview
  if (amountInput) {
    amountInput.addEventListener('input', () => {
      const amt = parseFloat(amountInput.value) || 0;
      if (vouchPreview) {
        vouchPreview.textContent = `V ${amt.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
    });
  }

  // Check if returning from Paystack
  const urlParams = new URLSearchParams(window.location.search);
  const isVerify = urlParams.get('verify');
  const reference = urlParams.get('reference') || urlParams.get('trxref');

  if (isVerify && reference) {
    const verifyAlert = document.getElementById('verifyAlert');
    if (verifyAlert) verifyAlert.classList.remove('hidden');

    try {
      const res = await api.get(`/payment/verify/${reference}`);
      if (verifyAlert) verifyAlert.classList.add('hidden');

      if (res && res.success) {
        showToast(`🎉 ${res.message}`, 'success', 6000);
        // Clean URL
        window.history.replaceState({}, '', '/deposit.html');
      } else {
        showToast(res?.message || 'Payment verification failed.', 'error');
        window.history.replaceState({}, '', '/deposit.html');
      }
    } catch (err) {
      if (verifyAlert) verifyAlert.classList.add('hidden');
      showToast('Verification error. Please contact support.', 'error');
    }
  }

  // Deposit form submit
  const form = document.getElementById('depositForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('depositBtn');
      const amount = parseFloat(amountInput.value);

      if (!amount || amount < 100) {
        showToast('Minimum deposit is ₦100.', 'error');
        return;
      }

      setLoading(btn, true);
      try {
        const res = await api.post('/payment/initiate', { amount });

        if (res && res.success && res.payment_url) {
          showToast('Redirecting to Paystack...', 'info');
          setTimeout(() => {
            window.location.href = res.payment_url;
          }, 800);
        } else {
          showToast(res?.message || 'Failed to initialize payment.', 'error');
          setLoading(btn, false);
        }
      } catch (err) {
        showToast('Connection error. Please try again.', 'error');
        setLoading(btn, false);
      }
    });
  }
});
