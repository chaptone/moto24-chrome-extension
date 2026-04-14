// click-menu.js — clicks "ต่อ พรบ" on the dummy menu page.
// POC: always clicks renew. Future: read expiry logic from payload.

(() => {
  const btn =
    document.querySelector('[data-action="renew"]') ||
    document.querySelector('[data-action="buy"]');
  if (btn) {
    btn.click();
    return "clicked";
  }
  return "no-button";
})();
