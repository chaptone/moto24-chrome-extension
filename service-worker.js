// service-worker.js — Moto24 พรบ Auto-Fill
//
// State machine:
//   idle → navigating → detect_page → {login_required | selecting_menu | filling} → done/error → idle
//
// State lives in chrome.storage.session (ephemeral, cleared on browser close).

const STATE_KEY = "prbState";
const DATA_KEY = "prbData";
const TAB_KEY = "prbTabId";

const STATES = {
  IDLE: "idle",
  NAVIGATING: "navigating",
  LOGIN_REQUIRED: "login_required",
  SELECTING_MENU: "selecting_menu",
  FILLING: "filling",
  DONE: "done",
  ERROR: "error",
};

// ---- State helpers --------------------------------------------------------

async function setState(state, extra = {}) {
  await chrome.storage.session.set({ [STATE_KEY]: { state, ...extra, at: Date.now() } });
  updateBadge(state);
}

async function getState() {
  const obj = await chrome.storage.session.get(STATE_KEY);
  return obj[STATE_KEY] ?? { state: STATES.IDLE };
}

function updateBadge(state) {
  const map = {
    [STATES.IDLE]: { text: "", color: "#666" },
    [STATES.NAVIGATING]: { text: "…", color: "#0066cc" },
    [STATES.LOGIN_REQUIRED]: { text: "!", color: "#eab308" },
    [STATES.SELECTING_MENU]: { text: "…", color: "#0066cc" },
    [STATES.FILLING]: { text: "…", color: "#0066cc" },
    [STATES.DONE]: { text: "✓", color: "#16a34a" },
    [STATES.ERROR]: { text: "×", color: "#dc2626" },
  };
  const cfg = map[state] ?? map[STATES.IDLE];
  chrome.action.setBadgeText({ text: cfg.text });
  chrome.action.setBadgeBackgroundColor({ color: cfg.color });
}

// ---- Entry point: message from moto24 web page ----------------------------

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type !== "FILL_PRB") {
        sendResponse({ success: false, error: "Unknown message type" });
        return;
      }
      if (!message.data?.chassisNumber) {
        sendResponse({ success: false, error: "Missing required field: chassisNumber" });
        return;
      }

      // Store data + kick off navigation
      await chrome.storage.session.set({ [DATA_KEY]: message.data });
      await setState(STATES.NAVIGATING);

      const targetUrl = getTargetUrl(sender.url);
      const tab = await chrome.tabs.create({ url: targetUrl, active: true });
      await chrome.storage.session.set({ [TAB_KEY]: tab.id });

      sendResponse({ success: true, tabId: tab.id });
    } catch (err) {
      await setState(STATES.ERROR, { message: String(err) });
      sendResponse({ success: false, error: String(err) });
    }
  })();
  return true; // async sendResponse
});

// Map moto24 origin → dummy-prb origin on the same host.
function getTargetUrl(senderUrl) {
  try {
    const u = new URL(senderUrl);
    return `${u.origin}/dummy-prb/login`;
  } catch {
    return "https://moto24.roodee.io/dummy-prb/login";
  }
}

// ---- Per-navigation driver ------------------------------------------------

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;

  const { [TAB_KEY]: trackedTabId } = await chrome.storage.session.get(TAB_KEY);
  if (tabId !== trackedTabId) return;

  const current = await getState();
  if (current.state === STATES.DONE || current.state === STATES.IDLE) return;

  await driveNextStep(tabId);
});

// Clear state when the tracked tab closes.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { [TAB_KEY]: trackedTabId } = await chrome.storage.session.get(TAB_KEY);
  if (tabId === trackedTabId) {
    await chrome.storage.session.remove([TAB_KEY, DATA_KEY]);
    await setState(STATES.IDLE);
  }
});

async function driveNextStep(tabId) {
  const [{ result: pageType }] = await chrome.scripting.executeScript({
    target: { tabId },
    files: ["scripts/detect-page.js"],
  });

  switch (pageType) {
    case "login":
      await setState(STATES.LOGIN_REQUIRED);
      break;

    case "menu":
      await setState(STATES.SELECTING_MENU);
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["scripts/click-menu.js"],
      });
      break;

    case "form": {
      await setState(STATES.FILLING);
      const [{ result: fillResult }] = await chrome.scripting.executeScript({
        target: { tabId },
        files: ["scripts/fill-form.js"],
      });
      // fill-form.js returns "filled:N+M" on success, "no-data" | "no-inputs" on failure.
      if (typeof fillResult === "string" && fillResult.startsWith("filled:")) {
        await setState(STATES.DONE, { fillResult });
      } else {
        await setState(STATES.ERROR, {
          message: `กรอกฟอร์มไม่สำเร็จ (${fillResult ?? "unknown"})`,
        });
      }
      break;
    }

    default:
      // Unknown page — leave state as-is; the user can navigate manually.
      break;
  }
}

// On service worker wake-up, reset badge from persisted state.
chrome.runtime.onStartup.addListener(async () => {
  const { state } = await getState();
  updateBadge(state);
});
