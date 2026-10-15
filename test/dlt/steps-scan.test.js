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
  const loopyFns = ["waitAjaxIdle", "clickSaveAndRead", "waitForHumanCombos", "waitForOfficerRegistration", "submitRow", "onLoginPage", "runTaxForm", "waitForAddressPage", "fillAddressPage"];
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

test("steps.js อ้าง editPage2_ ได้เฉพาะ id ใน allowlist (สเปก 2026-10-15 §7)", () => {
  const ids = [...CODE.matchAll(/["'#](?:widget_)?(editPage2_[\w:-]+)/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, "ต้องมีการอ้างช่องหน้าที่อยู่");
  for (const id of ids) assert.equal(L.isAllowedEditPage2Id(id), true, id);
});

test("prb_ok + payload v2 ⇒ โพสต์ ready_reached ก่อนรอหน้าที่อยู่ · v1 ⇒ จบแบบเดิม (R6)", () => {
  const stage = bodyOf("runAddressStage");
  assert.ok(stage.indexOf('type: "ready_reached"') >= 0, "ต้องโพสต์ ready_reached");
  assert.ok(stage.indexOf('type: "ready_reached"') < stage.indexOf("waitForAddressPage("), "ready_reached ต้องมาก่อนรอ");
  assert.match(bodyOf("runTaxForm"), /ctx\.payload\.version !== 2/);
  assert.match(bodyOf("runTaxForm"), /runAddressStage\(ctx, view\)/);
});

test("รอหน้าที่อยู่ไม่เกิน 20 นาที · poll 500 ms · heartbeat", () => {
  assert.match(CODE, /ADDRESS_WAIT_MS = 20 \* 60 \* 1000/);
  const wait = bodyOf("waitForAddressPage");
  assert.match(wait, /await sleep\(500\)/);
  assert.match(wait, /type: "heartbeat"/);
  assert.match(wait, /type: "phase", phase: "waiting_address"/);
});

test("กรอกที่อยู่ผ่านตัวตัดสินใจใน lib.js เท่านั้น (ไม่เขียนทับของคน · radio ของคน · cascade · รหัสไปรษณีย์ · dialog)", () => {
  assert.match(bodyOf("fillAddressText"), /L\.textFillDecision\(/);
  assert.match(bodyOf("fillAddressPage"), /L\.addressRadioDecision\(/);
  assert.match(bodyOf("stopIfAddressDialog"), /L\.addressDialogStop\(visibleDialogIds\("editPage2_"\)/);
  // เช็ก dialog ก่อนแตะ radio และก่อนทุกขั้นของการกรอก
  const page = bodyOf("fillAddressPage");
  assert.ok(page.indexOf("stopIfAddressDialog(a, keysFrom(0))") < page.indexOf("addressRadioState()"));
  assert.match(page, /if \(stopIfAddressDialog\(a, keysFrom\(i\)\)\) break;\s*\n\s*if \(await stages\[i\]\[1\]\(\)\) break;/);
  assert.match(bodyOf("fillAddressCascade"), /L\.cascadeFillDecision\(/);
  assert.match(bodyOf("fillAddressCascade"), /L\.cascadeResultDecision\(/);
  assert.match(bodyOf("fillAddressZip"), /L\.zipFillDecision\(/);
  // รหัสไปรษณีย์ของกรมต้องไม่ผ่าน textFillDecision ตรง ๆ (กรมเติมแล้วจะกลายเป็น officer_filled)
  assert.equal(/L\.textFillDecision\(/.test(bodyOf("fillAddressZip")), false);
});

test("radio ที่อยู่: กดได้เฉพาะตัวเลือกค่า 5 (L.ADDRESS_OTHER_VALUE) — ไม่กด radio ตัวอื่นของกลุ่ม", () => {
  const state = bodyOf("addressRadioState");
  assert.match(state, /i\.value === L\.ADDRESS_OTHER_VALUE/);
  const page = bodyOf("fillAddressPage");
  const clicks = [...page.matchAll(/click\(([^,)]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(clicks, ["box"], "fillAddressPage คลิกได้แค่กล่องของ radio อื่นๆ");
  assert.match(page, /radio\.other\.closest\(/);
  assert.match(page, /radio\.other\.value !== L\.ADDRESS_OTHER_VALUE/);
});

test("delivery.kind none ⇒ ไม่แตะหน้าที่อยู่ · ready_to_submit + skipped พร้อม reason จาก payload", () => {
  const stage = bodyOf("runAddressStage");
  const none = stage.slice(stage.indexOf('d.kind === "none"'), stage.indexOf("waitForAddressPage("));
  assert.match(none, /L\.emptyAddress\("skipped", d\.reason\)/);
  assert.match(none, /finish\(ctx, view, "ready_to_submit", undefined, skipped\)/); // m-6: address พกไปกับ final
});

test("Fix round 1 (M-1) — dialog ระหว่างทอดจังหวัด→อำเภอ→ตำบล และหลังช่องสุดท้าย ถูกรายงาน (R9)", () => {
  const cascade = bodyOf("fillAddressCascade");
  const loopStart = cascade.indexOf("for (let i = 0; i < cascade.length; i++)");
  assert.ok(loopStart >= 0);
  assert.ok(cascade.indexOf("stopIfAddressDialog(a, cascade.slice(i)", loopStart) > loopStart, "ต้องเช็ก dialog ก่อนทุกช่องในทอด");
  assert.ok(cascade.indexOf("stopIfAddressDialog(") < cascade.indexOf("selectAutocomplete("), "เช็กก่อนเลือก");
  const page = bodyOf("fillAddressPage");
  assert.match(page, /if \(await stages\[i\]\[1\]\(\)\) break;/);
  assert.match(page, /fillAddressCascade\(a, plan\.cascade, keysFrom\(3\)\)/);
  const tail = page.slice(page.lastIndexOf("await waitAjaxIdle();"));
  assert.match(tail, /stopIfAddressDialog\(a, \[\]\)/, "เช็ก dialog อีกครั้งหลัง waitAjaxIdle ตัวท้าย");
  assert.match(page, /L\.addressStatusOf\(a\.skipped, a\.notes\)/);
});

test("Fix round 1 (M-4) — showAddressOutcome: ผลไม่ใช่ filled ⇒ tone warn", () => {
  assert.match(bodyOf("showAddressOutcome"), /if \(a\.status !== "filled"\) view\.tone = "warn";/);
});

test("final review I-1 — ทอดเลือกไม่ติด ⇒ คืนช่องให้ว่าง (L.cascadeResultDecision.clear) · รหัสไปรษณีย์ดู L.cascadeIncomplete", () => {
  assert.match(bodyOf("fillAddressCascade"), /if \(r\.clear\) clearCombo\(ADDR_WIDGET\[c\.key\]\)/);
  assert.match(bodyOf("fillAddressZip"), /L\.zipFillDecision\(.*L\.cascadeIncomplete\(a\.skipped\)\)/);
  assert.match(bodyOf("clearCombo"), /w\.input\.val\(""\)[\s\S]*w\.hinput\.val\(""\)/);
});

test("final review m-6 — ทุก finish(ready_to_submit) ของขั้นที่อยู่พก address ไปกับ final", () => {
  const stage = bodyOf("runAddressStage");
  assert.equal((stage.match(/finish\(ctx, view, "ready_to_submit", undefined, \w+\)/g) || []).length, 3);
  assert.equal(/finish\(ctx, view, "ready_to_submit"\)/.test(stage), false);
  assert.match(bodyOf("finish"), /ev\.address = address/);
});

test("final review m-1 — รอหน้าที่อยู่หมดเวลา และ showFinal ที่ address ไม่ใช่ filled ⇒ tone warn", () => {
  const stage = bodyOf("runAddressStage");
  const late = stage.slice(stage.indexOf("if (!arrived)"), stage.indexOf('phase: "filling_address"'));
  assert.match(late, /view\.tone = "warn"/);
  assert.match(bodyOf("showFinal"), /addr\.status !== "filled"\) view\.tone = "warn"/);
});

test("final review m-3 — รอ AJAX ว่างก่อนอ่าน radio ที่อยู่", () => {
  const page = bodyOf("fillAddressPage");
  assert.ok(page.indexOf("await waitAjaxIdle()") >= 0 && page.indexOf("await waitAjaxIdle()") < page.indexOf("addressRadioState()"));
});

test("QA 2026-10-16 — delivery.kind none (ไม่มีที่อยู่ใน payload) ⇒ tone warn ไม่ใช่สีเขียว", () => {
  const stage = bodyOf("runAddressStage");
  const none = stage.slice(stage.indexOf('if (d.kind === "none")'), stage.indexOf('view.title = "รอเจ้าหน้าที่ไปหน้าที่อยู่"'));
  const fin = none.indexOf('finish(ctx, view, "ready_to_submit"');
  const warn = none.indexOf('view.tone = "warn"');
  assert.ok(fin >= 0 && warn > fin, "ตั้ง tone warn หลัง finish (finish ตั้ง ok ตาม OUTCOME_TONE)");
});
