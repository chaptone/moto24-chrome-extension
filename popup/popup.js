// popup.js — renders state from chrome.storage.session.

const CONFIG = {
  idle: { cls: "idle", label: "พร้อมใช้งาน", msg: "รอรับคำสั่งจากหน้า moto24" },
  navigating: { cls: "working", label: "กำลังเปิดเว็บ…", msg: "โหลดเว็บ พรบ" },
  login_required: { cls: "wait", label: "กรุณา login", msg: "กรุณาเข้าสู่ระบบที่เว็บ พรบ ก่อน" },
  selecting_menu: { cls: "working", label: "กำลังเลือกเมนู…", msg: "คลิก ต่อ / ซื้อ พรบ" },
  filling: { cls: "working", label: "กำลังกรอกข้อมูล…", msg: "กรอก form ตามข้อมูลสัญญา" },
  done: { cls: "done", label: "กรอกเสร็จ", msg: "กรุณาตรวจสอบข้อมูลแล้วกด submit" },
  error: { cls: "error", label: "เกิดข้อผิดพลาด", msg: "ลองรีเฟรช หรือกรอกเอง" },
};

const el = document.getElementById("state");

function render(obj) {
  const cur = obj?.prbState ?? { state: "idle" };
  const cfg = CONFIG[cur.state] ?? CONFIG.idle;
  el.className = `state ${cfg.cls}`;
  const msg = cur.state === "error" && cur.message ? cur.message : cfg.msg;
  el.innerHTML = `<div class="label">${cfg.label}</div><div class="msg">${msg}</div>`;
}

chrome.storage.session.get().then(render);
chrome.storage.session.onChanged.addListener(() => {
  chrome.storage.session.get().then(render);
});
