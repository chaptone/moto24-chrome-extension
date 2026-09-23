// scripts/dlt/relay.js — สะพาน ISOLATED world ของ flow ต่อภาษีออนไลน์
// ขั้นใน MAIN world (steps.js) เรียก chrome.runtime ไม่ได้ ⇒ โพสต์ window.postMessage
// { source: "moto24-dlt", runId, event } แล้วไฟล์นี้ส่งต่อให้ service worker
// service worker ตรวจเองว่า runId + แท็บตรงกับรอบปัจจุบัน (orchestrator.js dltOnRelayEvent)
(() => {
  if (window.__moto24DltRelay) return;
  window.__moto24DltRelay = true;
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== "moto24-dlt" || typeof d.runId !== "string" || !d.event) return;
    try {
      // MV3 คืน Promise เมื่อไม่ส่ง callback — SW ถูกปลุกใหม่ไม่ทันจะ reject ⇒ กันไม่ให้เป็น unhandled rejection
      Promise.resolve(chrome.runtime.sendMessage({ type: "DLT_EVENT", runId: d.runId, event: d.event })).catch(() => {});
    } catch (err) {
      console.warn("[moto24-dlt] relay", err);
    }
  });
})();
