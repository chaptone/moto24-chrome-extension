// detect-page.js — injected via chrome.scripting.executeScript
// Return value: "login" | "form" | "unknown"
//
// Called once after the tab finishes loading. The service worker uses the
// return value to decide whether to abort (login) or inject runPRBFlow (form).

(() => {
  const url = window.location.href;
  const path = window.location.pathname;

  if (!url.startsWith("https://epolicy4.rvp.co.th/")) return "unknown";
  if (path.startsWith("/Login")) return "login";
  if (path.startsWith("/Policy/New")) return "form";
  return "unknown";
})();
