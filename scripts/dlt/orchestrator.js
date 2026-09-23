// scripts/dlt/orchestrator.js — ตัวคุมงาน flow ต่อภาษีออนไลน์ (service worker)
//
// "หน้าเป็นคนรายงาน service worker เป็นคนจด" (spec §6.2):
//   • สถานะรอบอยู่ใน chrome.storage.local คีย์ dltRun:<runId> — เขียนทุกเหตุการณ์ทันที
//     ⇒ SW ถูกปิดแล้วเปิดใหม่ทำต่อได้ และ timeline คือ audit
//   • tabs.onUpdated(complete) ⇒ จำแนกหน้าจาก URL แล้ว inject ขั้นของหน้านั้น
//     (ทุกอย่างภายใน esv02i001 เป็น AJAX — ขั้นในหน้ารอผลเอง ไม่ได้พึ่ง onUpdated · spike S3)
//   • ขั้นในหน้ารายงานผ่าน relay.js → chrome.runtime.onMessage (DLT_EVENT)
//   • ครั้งละ 1 รอบต่อเบราว์เซอร์ · ปิดแท็บ ⇒ aborted · เงียบ 30 นาที ⇒ timeout · เก็บผล 24 ชม. แล้วลบ
// ⛔ ไม่แตะสาย FILL_PRB — service-worker.js ส่งต่อมาเฉพาะ FILL_DLT_TAX / GET_DLT_TAX_RESULT
// ⚠️ ฟังก์ชันระดับบนสุดขึ้นต้น dlt ทั้งหมด (อยู่ scope เดียวกับ service-worker.js — กันชื่อชน)

/* global chrome, self */
const DLT = self.__moto24Dlt;
const DLT_RUN_PREFIX = "dltRun:";
const DLT_CURRENT_KEY = "dltCurrentRunId";
const DLT_ALARM = "moto24-dlt-sweep";
const DLT_IDLE_MS = 30 * 60 * 1000;
const DLT_KEEP_MS = 24 * 60 * 60 * 1000;
const DLT_MAX_VISITS = 6;
const DLT_PAGE_FILES = ["scripts/dlt/lib.js", "scripts/dlt/steps.js"];

let dltLock = Promise.resolve();
/** read-modify-write ของ storage ต้องเรียงกัน — เหตุการณ์จากหน้ามาถี่และพร้อมกันได้
 *  ⛔ ห้ามเรียก dltRecord ข้างใน callback ของ dltWithLock (deadlock) */
function dltWithLock(fn) {
  const next = dltLock.then(fn, fn);
  dltLock = next.then(() => undefined, () => undefined);
  return next;
}

function dltNowIso() {
  return new Date().toISOString();
}

async function dltLoadRun(runId) {
  const key = DLT_RUN_PREFIX + runId;
  const obj = await chrome.storage.local.get(key);
  return obj[key] || null;
}

async function dltSaveRun(run) {
  await chrome.storage.local.set({ [DLT_RUN_PREFIX + run.runId]: run });
}

async function dltCurrentRun() {
  const obj = await chrome.storage.local.get(DLT_CURRENT_KEY);
  const id = obj[DLT_CURRENT_KEY];
  return id ? dltLoadRun(id) : null;
}

function dltRecord(runId, event) {
  return dltWithLock(async () => {
    const run = await dltLoadRun(runId);
    if (!run) return null;
    const next = DLT.applyDltEvent(run, event, dltNowIso());
    if (next !== run) await dltSaveRun(next);
    return next;
  });
}

async function handleDltExternalMessage(message) {
  if (message.type === "GET_DLT_TAX_RESULT") {
    const run = typeof message.runId === "string" ? await dltLoadRun(message.runId) : null;
    if (!run) return { state: "unknown" };
    if (run.result) return { state: "final", result: run.result };
    return { state: "running", phase: run.phase };
  }

  const payload = message.data;
  const invalid = DLT.validatePayload(payload);
  if (invalid) return { success: false, error: invalid };
  if (await dltLoadRun(payload.runId)) return { success: false, error: "runId นี้ถูกใช้ไปแล้ว" };

  const prev = await dltCurrentRun();
  if (prev && !prev.result) {
    const ended = await dltRecord(prev.runId, { type: "final", outcome: "superseded" });
    if (ended && typeof ended.tabId === "number") dltRunInPage(ended.tabId, ended.runId, "showFinal").catch(() => {});
  }

  // เปิดแท็บเปล่าก่อน → บันทึกรอบ → ค่อยพาไปหน้ากรม ⇒ onUpdated ครั้งแรกไม่หลุดเพราะรอบยังไม่ถูกเขียน
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  if (typeof tab.id !== "number") return { success: false, error: "ไม่สามารถเปิดแท็บใหม่" };
  await dltSaveRun(DLT.newRun({ runId: payload.runId, tabId: tab.id, payload, nowIso: dltNowIso() }));
  await chrome.storage.local.set({ [DLT_CURRENT_KEY]: payload.runId });
  await chrome.alarms.create(DLT_ALARM, { periodInMinutes: 1 });
  // ไม่มี session ⇒ กรมพาไปหน้าล็อกอินเอง
  await chrome.tabs.update(tab.id, { url: DLT.URLS.register });
  return { accepted: true };
}

async function dltRunInPage(tabId, runId, stepName) {
  const run = await dltLoadRun(runId);
  if (!run) return;
  const context = { runId: run.runId, payload: run.payload, visits: run.visits, result: run.result };
  await chrome.scripting.executeScript({ target: { tabId }, files: ["scripts/dlt/relay.js"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: DLT_PAGE_FILES, world: "MAIN" });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    // ถูก serialize ไปรันในหน้า ⇒ ห้ามอ้างอะไรนอกตัวมันนอกจาก args และ window
    // ไม่ return promise ของขั้น — ขั้นอาจรอคนเป็นนาที และรายงานผ่าน relay อยู่แล้ว
    func: (name, ctx) => {
      const steps = window.__moto24DltSteps;
      if (!steps || typeof steps[name] !== "function") return "missing";
      steps[name](ctx);
      return "started";
    },
    args: [stepName, context],
  });
}

async function dltFinishAndShow(runId, tabId, outcome) {
  const ended = await dltRecord(runId, { type: "final", outcome });
  if (ended) await dltRunInPage(tabId, runId, "showFinal").catch(() => {});
}

async function dltOnTabComplete(tabId, url) {
  const run = await dltCurrentRun();
  if (!run || run.result || run.tabId !== tabId) return;
  const kind = DLT.classifyDltUrl(url);
  if (kind === "ignore") return;

  const visited = await dltRecord(run.runId, { type: "visit", kind });
  if (!visited || visited.result) return;

  const phase = DLT.PHASE_BY_KIND[kind];
  if (!phase) {
    let path = "?";
    try {
      path = new URL(url).pathname;
    } catch (e) {
      path = "?";
    }
    await dltRecord(run.runId, { type: "note", event: "unexpected_page:" + path });
    await dltFinishAndShow(run.runId, tabId, "unexpected_page");
    return;
  }
  if (phase !== "waiting_login" && (visited.visits[kind] || 0) > DLT_MAX_VISITS) {
    await dltRecord(run.runId, { type: "note", event: "too_many_visits:" + kind });
    await dltFinishAndShow(run.runId, tabId, "unexpected_page");
    return;
  }

  await dltRecord(run.runId, { type: "phase", phase });
  if (kind === "index") {
    await chrome.tabs.update(tabId, { url: DLT.URLS.register });
    return;
  }
  const step = DLT.STEP_BY_KIND[kind];
  if (step) await dltRunInPage(tabId, run.runId, step);
}

async function dltFailCurrent(tabId, err) {
  const run = await dltCurrentRun();
  if (run && !run.result && run.tabId === tabId) {
    await dltRecord(run.runId, {
      type: "final",
      outcome: "bot_error",
      error: "service worker: " + String(err && err.message ? err.message : err),
    });
  }
}

async function dltOnRelayEvent(message, sender) {
  const run = await dltCurrentRun();
  const tabId = sender && sender.tab ? sender.tab.id : undefined;
  if (!run || run.result || run.runId !== message.runId || run.tabId !== tabId) return { ok: false };
  const event = DLT.sanitizeEvent(message.event);
  if (!event) return { ok: false };
  await dltRecord(run.runId, event);
  return { ok: true };
}

async function dltOnTabRemoved(tabId) {
  const run = await dltCurrentRun();
  if (run && !run.result && run.tabId === tabId) await dltRecord(run.runId, { type: "final", outcome: "aborted" });
}

async function dltSweep(nowMs) {
  const all = await chrome.storage.local.get(null);
  const expired = [];
  let remaining = 0;
  for (const [key, run] of Object.entries(all)) {
    if (!key.startsWith(DLT_RUN_PREFIX) || !run) continue;
    if (DLT.isIdle(run, nowMs, DLT_IDLE_MS)) {
      const ended = await dltRecord(run.runId, { type: "final", outcome: "timeout" });
      if (ended && typeof ended.tabId === "number") dltRunInPage(ended.tabId, ended.runId, "showFinal").catch(() => {});
      remaining += 1;
    } else if (DLT.isExpired(run, nowMs, DLT_KEEP_MS)) {
      expired.push(key);
    } else {
      remaining += 1;
    }
  }
  if (expired.length) {
    await chrome.storage.local.remove(expired);
    const current = all[DLT_CURRENT_KEY];
    if (current && expired.includes(DLT_RUN_PREFIX + current)) await chrome.storage.local.remove(DLT_CURRENT_KEY);
  }
  if (remaining === 0) await chrome.alarms.clear(DLT_ALARM);
}

// ── listeners — ต้องลงทะเบียนที่ระดับบนสุด (MV3 SW ตื่นใหม่แล้วต้องเห็นทันที) ──

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  dltOnTabComplete(tabId, (tab && tab.url) || "").catch((err) => dltFailCurrent(tabId, err).catch(() => {}));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  dltOnTabRemoved(tabId).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "DLT_EVENT") return false;
  dltOnRelayEvent(message, sender).then(sendResponse, () => sendResponse({ ok: false }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DLT_ALARM) dltSweep(Date.now()).catch(() => {});
});
