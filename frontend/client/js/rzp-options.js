'use strict';
// Builds the options object for Razorpay Checkout. Kept in its own file so it can be tested in Node.
// method 'upi'  -> UPI block on top (Google Pay, PhonePe, Paytm, BHIM and any other UPI app / QR / UPI ID), other methods still available below
// method 'all'  -> Razorpay default screen (UPI, cards, net banking, wallets)
(function (root) {
  const UPI_TITLE = 'Pay via UPI (Google Pay, PhonePe, Paytm, BHIM)';
  function build(info, user, o) {
    o = o || {}; user = user || {};
    const opt = {
      key: info.keyId, amount: info.amount, currency: info.currency, name: info.name, description: info.description, order_id: info.orderId,
      prefill: { name: user.name || '', email: user.email || '', contact: user.phone || '' },
      theme: { color: '#4f46e5' },
      handler: (resp) => o.onSuccess && o.onSuccess(resp),
      modal: { ondismiss: () => o.onDismiss && o.onDismiss(), confirm_close: true },
    };
    if ((o.method || 'upi') === 'upi') {
      opt.config = { display: {
        blocks: { upi: { name: UPI_TITLE, instruments: [{ method: 'upi' }] } },   // one UPI block: all UPI apps on mobile, QR / UPI ID on desktop
        sequence: ['block.upi'],
        preferences: { show_default_blocks: true },                                // cards / net banking / wallets stay available below
      } };
    }
    return opt;
  }
  const api = { build, UPI_TITLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RzpOptions = api;
})(typeof window !== 'undefined' ? window : globalThis);
