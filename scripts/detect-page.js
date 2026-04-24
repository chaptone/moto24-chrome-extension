// detect-page.js — injected via chrome.scripting.executeScript
// Return value: "login" | "form" | "unknown"
//
// Called once after the tab finishes loading. The service worker uses the
// return value to decide whether to abort (login) or inject runPRBFlow (form).

(() => {
  const url = window.location.href;
  const path = window.location.pathname;

  // RVP real site
  if (url.startsWith("https://epolicy4.rvp.co.th/")) {
    if (path.startsWith("/Login")) return "login";
    if (path.startsWith("/Policy/New")) return "form";
    return "unknown";
  }

  // Dummy site (moto24.roodee.io or localhost)
  if (path.startsWith("/dummy-prb/login")) return "login";
  if (path.startsWith("/dummy-prb/form")) return "form";
  if (document.querySelector('[data-dummy-page="login"]')) return "login";
  if (document.querySelector('[data-dummy-page="form"]')) return "form";

  return "unknown";
})();
