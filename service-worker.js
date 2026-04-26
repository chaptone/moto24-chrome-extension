// service-worker.js — Moto24 พรบ Auto-Fill
//
// Flow (linear, no chrome.tabs.onUpdated driving):
//   onMessageExternal(FILL_PRB) →
//   open tab → wait for 'complete' → detect-page classify →
//     if "form":  inject run-prb-flow → return its PRBResult
//     if "login": return abort error "login required"
//     else:       return abort error "URL unexpected"
//
// Popup state persists via chrome.storage.session (schema unchanged).

importScripts("scripts/run-prb-flow.js");

const STATE_KEY = "prbState";

// ---- Popup state helpers --------------------------------------------------

const STATES = {
  IDLE: "idle",
  WORKING: "working",
  DONE: "done",
  ERROR: "error",
  WAIT_LOGIN: "wait_login",
};

async function setState(state, extra = {}) {
  await chrome.storage.session.set({ [STATE_KEY]: { state, ...extra, at: Date.now() } });
  updateBadge(state);
}

function updateBadge(state) {
  const map = {
    [STATES.IDLE]: { text: "", color: "#666" },
    [STATES.WORKING]: { text: "…", color: "#0066cc" },
    [STATES.WAIT_LOGIN]: { text: "!", color: "#eab308" },
    [STATES.DONE]: { text: "✓", color: "#16a34a" },
    [STATES.ERROR]: { text: "×", color: "#dc2626" },
  };
  const cfg = map[state] ?? map[STATES.IDLE];
  chrome.action.setBadgeText({ text: cfg.text });
  chrome.action.setBadgeBackgroundColor({ color: cfg.color });
}

// ---- Entry point: FILL_PRB / GET_EXTENSION_VERSION from moto24 ------------

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === "GET_EXTENSION_VERSION") {
        const version = chrome.runtime.getManifest().version;
        sendResponse({ success: true, version });
        return;
      }
      if (message?.type !== "FILL_PRB") {
        sendResponse({ success: false, error: "Unknown message type" });
        return;
      }
      const payload = message.data;
      if (!payload?.chassisNumber) {
        sendResponse({ success: false, error: "Missing required field: chassisNumber" });
        return;
      }

      await setState(STATES.WORKING);

      const targetUrl = getTargetUrl();
      const tab = await chrome.tabs.create({ url: targetUrl, active: true });
      const tabId = tab.id;
      if (typeof tabId !== "number") {
        await setState(STATES.ERROR, { error: "ไม่สามารถเปิดแท็บใหม่" });
        sendResponse({ success: false, error: "ไม่สามารถเปิดแท็บใหม่" });
        return;
      }

      // Wait for the tab to finish loading.
      await waitForTabComplete(tabId, 15000);

      // Detect what page landed.
      const [detectResult] = await chrome.scripting.executeScript({
        target: { tabId },
        files: ["scripts/detect-page.js"],
      });
      const pageType = detectResult?.result;

      if (pageType === "login") {
        await setState(STATES.WAIT_LOGIN, { error: "กรุณา login เข้า RVP ก่อน" });
        sendResponse({ success: false, error: "กรุณา login เข้า RVP ก่อน แล้วคลิกอีกครั้ง" });
        return;
      }
      if (pageType !== "form") {
        const err = "URL ไม่ถูกต้อง — RVP อาจเปลี่ยนหน้า";
        await setState(STATES.ERROR, { error: err });
        sendResponse({ success: false, error: err });
        return;
      }

      // Inject run-prb-flow and await its result.
      let injectionResult;
      try {
        const [injection] = await chrome.scripting.executeScript({
          target: { tabId },
          // eslint-disable-next-line no-undef
          func: runPRBFlow,
          args: [payload],
          // MAIN world so runPRBFlow sees the page's window.jQuery; otherwise
          // Select2's change handler falls through to the native-event path.
          world: "MAIN",
        });
        injectionResult = injection?.result;
      } catch (err) {
        const msg = "ไม่สามารถ inject สคริปต์";
        await setState(STATES.ERROR, { error: msg, detail: String(err) });
        sendResponse({ success: false, error: msg });
        return;
      }

      if (!injectionResult) {
        const msg = "ไม่ได้รับผลลัพธ์จากสคริปต์";
        await setState(STATES.ERROR, { error: msg });
        sendResponse({ success: false, error: msg });
        return;
      }

      if (injectionResult.success) {
        await setState(STATES.DONE, {
          filled: injectionResult.filled,
          skipped: injectionResult.skipped,
        });
      } else {
        await setState(STATES.ERROR, { error: injectionResult.error });
      }
      sendResponse(injectionResult);
    } catch (err) {
      const msg = String(err);
      await setState(STATES.ERROR, { error: msg });
      sendResponse({ success: false, error: msg });
    }
  })();
  return true; // async sendResponse
});

// ---- Helpers --------------------------------------------------------------

function getTargetUrl() {
  return "https://epolicy4.rvp.co.th/Policy/New";
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("tab load timeout"));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ---- Startup --------------------------------------------------------------

chrome.runtime.onStartup.addListener(async () => {
  const obj = await chrome.storage.session.get(STATE_KEY);
  updateBadge(obj[STATE_KEY]?.state ?? STATES.IDLE);
});
