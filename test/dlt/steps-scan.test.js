// 🔒 ผูก invariant "บอทกรอก คนกดยืนยัน" (spec §6.7 ระดับ ③) — steps.js ต้องไม่ยิงคลิก/event เอง
// ทุกคลิกผ่าน L.safeClick และทุกการตั้งค่าผ่าน L.setInputValue ซึ่งมีรายการปุ่มห้ามกด
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const L = require("../../scripts/dlt/lib.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "dlt", "steps.js"), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("steps.js ไม่ยิงคลิก/event/submit เอง", () => {
  for (const re of [/\.click\s*\(/, /dispatchEvent\s*\(/, /\.trigger\s*\(/, /\.submit\s*\(/, /requestSubmit\s*\(/, /PrimeFaces\.ab\s*\(/, /\.jq\s*\(/]) {
    assert.equal(re.test(CODE), false, "เจอ " + re);
  }
});

test("steps.js ไม่อ้าง element ต้องห้ามด้วย id (byId / #selector)", () => {
  for (const id of L.FORBIDDEN_TARGETS) {
    assert.equal(new RegExp("byId\\(\\s*[\"']" + id + "[\"']").test(CODE), false, id);
    assert.equal(new RegExp("[\"'][^\"']*#" + id + "(?![\\w-])").test(CODE), false, id);
  }
  assert.equal(/byId\(\s*["']editPage2_/.test(CODE), false);
  assert.equal(/#editPage2_/.test(CODE), false);
});

function bodyOf(name) {
  const start = SRC.indexOf("function " + name + "(");
  assert.ok(start >= 0, "ไม่พบ " + name);
  const end = SRC.indexOf("\n  }\n", start);
  return SRC.slice(start, end);
}

test("ทุกขั้นที่ SW เรียก จบด้วยแบนเนอร์ใน finally", () => {
  for (const name of ["onLoginPage", "runRegister", "onAgreementPage", "runTaxForm"]) {
    const body = bodyOf(name);
    assert.match(body, /finally\s*\{[\s\S]*renderBanner\(view\)/, name);
  }
});

test("fix round 1 — ลงทะเบียนซ้ำ: อ่าน dialog ที่ขึ้นต้น alertExist ด้วย ผ่าน L.pickMessageDialogId เท่านั้น ไม่คลิกมัน", () => {
  assert.match(CODE, /querySelectorAll\(\s*['"]\[id\^="alertExist"\]['"]\s*\)/, "ต้องกวาดหา element ที่ id ขึ้นต้น alertExist");
  assert.match(CODE, /L\.pickMessageDialogId\s*\(/, "การเลือกว่าจะอ่าน dialog ไหนต้องผ่าน helper บริสุทธิ์ใน lib.js");
  // ต้องไม่มี safeClick หรือคลิกใด ๆ ผูกกับ id ที่ขึ้นต้น alertExist (อ่านอย่างเดียว)
  assert.equal(/alertExist[^\n]*safeClick|safeClick[^\n]*alertExist/.test(CODE), false);
});

test("review fix — dialog ว่าง (L.isBlankDialogText) ต้องถูกเช็กในทุก reader path ก่อนตัดสินว่าเป็นคำตอบ", () => {
  const readerFns = ["clickSaveAndRead", "waitForOfficerRegistration", "submitRow"];
  for (const name of readerFns) {
    assert.match(bodyOf(name), /L\.isBlankDialogText\s*\(/, name);
  }
  // จบด้วย bot_error พร้อมข้อความชัดเจน ไม่ใช่ dlt_blocked เมื่อกรมตอบด้วย dialog ว่างล้วน
  assert.match(CODE, /"dialog ของกรมว่าง"/);
});

test("review fix — paginator: ไม่ auto-page แค่เตือนในโน้ต เมื่อยังไม่พบรถ", () => {
  assert.match(CODE, /L\.hasMorePages\s*\(\s*readPaginatorInfo\s*\(\s*\)\s*\)/);
  assert.match(CODE, /vehicle_table_may_have_more_pages/);
  // ปุ่ม/ลิงก์ paginator ถูกอ่านอย่างเดียว ไม่มี click ผูกกับมัน
  assert.equal(/ui-paginator[^\n]*click|click[^\n]*ui-paginator/.test(CODE), false);
});

test("review fix — stopped()/StoppedError: ทุก wait loop เช็กก่อนเดินต่อ · showFinal ตั้งค่า stop", () => {
  assert.match(CODE, /function showFinal\(ctx\) \{\s*window\.__moto24DltStopped = true;/);
  assert.match(CODE, /function ensureNotStopped\(\)/);
  const loopyFns = ["waitAjaxIdle", "clickSaveAndRead", "waitForHumanCombos", "waitForOfficerRegistration", "submitRow", "onLoginPage", "runTaxForm"];
  for (const name of loopyFns) {
    assert.match(bodyOf(name), /ensureNotStopped\s*\(\)/, name);
  }
});

test("review fix — withActiveGuard กันสองขั้นรันพร้อมกันในหน้าเดียว", () => {
  assert.match(CODE, /window\.__moto24DltActiveStep/);
  assert.match(CODE, /function withActiveGuard\(/);
});

test("review fix — showFinal หยุดขั้นที่ค้างอยู่จริง (ตั้ง window.__moto24DltStopped)", () => {
  const posted = [];
  const window = { __moto24Dlt: L, postMessage: (m) => posted.push(m), location: { origin: "https://eservice.dlt.go.th" } };
  const sandbox = { window, document: {}, console, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "steps.js" });
  assert.notEqual(window.__moto24DltStopped, true);
  window.__moto24DltSteps.showFinal({
    runId: "r1",
    payload: { display: { plate: "1กก 1111", customer: "ลูกค้าทดสอบ" } },
    result: { outcome: "superseded" },
  });
  assert.equal(window.__moto24DltStopped, true);
});

test("review fix — สองขั้นรันพร้อมกันในหน้าเดียว: ขั้นที่สองถูกละพร้อม note", async () => {
  const posted = [];
  const window = { __moto24Dlt: L, postMessage: (m) => posted.push(m), location: { origin: "https://eservice.dlt.go.th" } };
  const sandbox = { window, document: {}, console, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "steps.js" });
  const ctx = { runId: "r1", payload: { display: { plate: "1กก 1111", customer: "ลูกค้าทดสอบ" } } };
  const p1 = window.__moto24DltSteps.onAgreementPage(ctx);
  const p2 = window.__moto24DltSteps.onAgreementPage(ctx);
  await Promise.all([p1, p2]);
  const notes = posted.filter((m) => m.event && m.event.type === "note");
  assert.ok(notes.some((m) => m.event.event === "duplicate_step_ignored:onAgreementPage"));
  assert.equal(window.__moto24DltActiveStep, null);
});

test("โหลดไฟล์แล้วประกาศขั้นครบ และไม่ทำอะไรตอนโหลด", () => {
  const posted = [];
  const window = { __moto24Dlt: L, postMessage: (m) => posted.push(m), location: { origin: "https://eservice.dlt.go.th" } };
  const sandbox = { window, document: {}, console, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "steps.js" });
  const steps = window.__moto24DltSteps;
  for (const name of ["onLoginPage", "runRegister", "onAgreementPage", "runTaxForm", "showFinal"]) {
    assert.equal(typeof steps[name], "function", name);
  }
  assert.equal(posted.length, 0);
  // inject ซ้ำบนหน้าเดิมต้องไม่ประกาศทับ
  const first = window.__moto24DltSteps;
  vm.runInContext(SRC, sandbox, { filename: "steps.js" });
  assert.equal(window.__moto24DltSteps, first);
});

test("รอเจ้าหน้าที่ลงทะเบียน: เคยถูกปฏิเสธชื่อแล้ว dialog ว่างต้องไม่กลบ name_rejected", () => {
  const start = SRC.indexOf("async function waitForOfficerRegistration");
  assert.ok(start >= 0);
  const body = SRC.slice(start, SRC.indexOf("\n  }\n", start));
  assert.match(body, /if \(sawBlankDialog && !rejected\)/);
  // เช็กธงหยุดหลัง sleep ด้วย — กันรอบที่ถูกปิดระหว่างรอ แล้ววาดแบนเนอร์ทับ
  assert.match(body, /await sleep\(600\);\s*\n\s*ensureNotStopped\(\);/);
});

test("กรอก plate2 แล้วต้องรอ AJAX ค้นรถ (onblur ของกรม) ก่อนกดบันทึก", () => {
  const start = SRC.indexOf("async function fillVehicleForm");
  const body = SRC.slice(start, SRC.indexOf("\n  }\n", start));
  assert.match(body, /fillText\(fields, "plate2", "add_plate2", p\.plate2\);\s*\n\s*await waitAjaxIdle\(\);/);
});
