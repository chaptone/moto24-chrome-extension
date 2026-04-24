// popup.js — renders PRB autofill state from chrome.storage.session.

const STATE_CONFIG = {
  idle: { cls: "idle", label: "พร้อมใช้งาน", msg: "รอรับคำสั่งจากหน้า moto24" },
  working: { cls: "working", label: "กำลังกรอกข้อมูล…", msg: "กำลังเปิดแท็บและกรอก form" },
  wait_login: { cls: "wait_login", label: "กรุณา login", msg: "กรุณา login เข้า RVP ก่อน" },
  done: { cls: "done", label: "กรอกเสร็จ", msg: "กรุณาตรวจสอบข้อมูลแล้วกด submit" },
  error: { cls: "error", label: "เกิดข้อผิดพลาด", msg: "ลองรีเฟรช หรือกรอกเอง" },
};

const stateEl = document.getElementById("state");
const filledSection = document.getElementById("filled-section");
const filledList = document.getElementById("filled-list");
const skippedSection = document.getElementById("skipped-section");
const skippedList = document.getElementById("skipped-list");

function render(obj) {
  const cur = obj?.prbState ?? { state: "idle" };
  const cfg = STATE_CONFIG[cur.state] ?? STATE_CONFIG.idle;

  stateEl.className = `state ${cfg.cls}`;
  stateEl.innerHTML = '<div class="label"></div><div class="msg"></div>';
  stateEl.querySelector(".label").textContent = cfg.label;
  stateEl.querySelector(".msg").textContent =
    cur.state === "error" && cur.error ? cur.error : cfg.msg;

  renderList(filledSection, filledList, "filled", cur.filled);
  renderList(skippedSection, skippedList, "skipped", cur.skipped);
}

function renderList(section, ul, cls, items) {
  if (!items || items.length === 0) {
    section.hidden = true;
    ul.innerHTML = "";
    return;
  }
  section.hidden = false;
  ul.innerHTML = items.map((item) => renderItem(cls, item)).join("");
}

function renderItem(cls, item) {
  // "filled" items are bare field-name strings; "skipped" items are objects.
  if (cls === "filled") {
    const label = FIELD_LABELS[item] ?? item;
    return `<li class="filled">${escapeHtml(label)}</li>`;
  }
  const label = FIELD_LABELS[item.field] ?? item.field;
  const reason = item.reason ?? "";
  const valueHint = item.value ? ` <span class="skipped-value">(BC: ${escapeHtml(item.value)})</span>` : "";
  return `<li class="skipped">${escapeHtml(label)} — ${escapeHtml(reason)}${valueHint}</li>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

chrome.storage.session.get().then(render);
chrome.storage.session.onChanged.addListener(() => {
  chrome.storage.session.get().then(render);
});
