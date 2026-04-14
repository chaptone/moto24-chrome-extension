// detect-page.js — injected via chrome.scripting.executeScript
// Return value: "login" | "menu" | "form" | "unknown"

(() => {
  if (document.querySelector('[data-dummy-page="login"]')) return "login";
  if (document.querySelector('[data-dummy-page="menu"]')) return "menu";
  if (document.querySelector('[data-dummy-page="form"]')) return "form";
  return "unknown";
})();
