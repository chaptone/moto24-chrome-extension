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
      const { [DATA_KEY]: data } = await chrome.storage.session.get(DATA_KEY);
      if (!data) {
        await setState(STATES.ERROR, { message: "ไม่พบข้อมูลสัญญาใน session" });
        break;
      }
      // Pass data as an arg to the injected function. This avoids having the
      // content script reach into chrome.storage from the page context, which
      // was returning undefined in testing.
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: fillFormInPage,
        args: [data],
      });
      const fillResult = injection?.result;
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

// ---- Injected into the page via chrome.scripting.executeScript({ func }) --
//
// Runs in the page's isolated world. Self-contained — no references to outer
// scope (Chrome serializes the function body). Receives form data as an arg
// so it doesn't need chrome.storage access from the content-script context.
async function fillFormInPage(data) {
  // Wait up to 2s for the first input to appear (handles late mount after
  // Next.js client-side navigation).
  let ready = false;
  for (let i = 0; i < 20; i++) {
    if (document.querySelector('input[name="chassisNumber"]')) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) return "no-inputs";

  const mapping = {
    chassisNumber: data.chassisNumber,
    engineNumber: data.engineNumber,
    productMakeDesc: data.productMakeDesc,
    productModelDesc: data.productModelDesc,
    customerName: data.customerName,
  };

  function setInputValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillAll() {
    let filled = 0;
    for (const [name, value] of Object.entries(mapping)) {
      const input = document.querySelector(`input[name="${name}"]`);
      if (input && value != null && input.value !== String(value)) {
        setInputValue(input, String(value));
        filled++;
      }
    }
    return filled;
  }

  const firstPass = fillAll();
  // Re-apply after 400ms in case React hydration wipes uncontrolled input
  // values. fillAll skips inputs whose value already matches, so this is a
  // no-op if nothing changed.
  await new Promise((r) => setTimeout(r, 400));
  const secondPass = fillAll();

  return `filled:${firstPass}+${secondPass}`;
}
