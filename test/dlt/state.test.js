// ⛔ PUBLIC REPO — ข้อมูลแต่งขึ้นทั้งหมด
const test = require("node:test");
const assert = require("node:assert/strict");

const L = require("../../scripts/dlt/lib.js");

const T0 = "2026-01-01T00:00:00.000Z";
const PAYLOAD = { version: 1, runId: "r1", display: { customer: "ทดสอบ ตัวอย่าง", plate: "1ทด 1111 จังหวัดสมมุติ" }, vehicleTypeLabel: "รถจักรยานยนต์", provinceLabel: "จังหวัดสมมุติ", plate1: "1ทด", plate2: "1111", ownerNames: [{ value: "ทดสอบ ตัวอย่าง", source: "customer" }], mileage: null, ours: { expiryDate: null, jobType: "tax_only" } };

test("classifyDltUrl", () => {
  const E = "https://eservice.dlt.go.th";
  assert.equal(L.classifyDltUrl("about:blank"), "ignore");
  assert.equal(L.classifyDltUrl("chrome-error://chromewebdata/"), "ignore");
  assert.equal(L.classifyDltUrl("https://connect.egov.go.th/some/login"), "external_login");
  assert.equal(L.classifyDltUrl(E + "/esvapp/login.jsf"), "login");
  assert.equal(L.classifyDltUrl(E + "/esvapp/index.jsf"), "index");
  assert.equal(L.classifyDltUrl(E + "/esvapp/esv/ebk/esv02i001/index.jsf"), "register");
  assert.equal(L.classifyDltUrl(E + "/esvapp/esv/ebk/taxAgreement/index.jsf"), "agreement");
  assert.equal(L.classifyDltUrl(E + "/esvapp/esv/ebk/esv02i002/index.jsf"), "tax_form");
  assert.equal(L.classifyDltUrl(E + "/esvapp/esv/ebk/esv02q001/index.jsf"), "unexpected");
});

test("validatePayload — 🔒 ชื่อ 1–2 · version 1 · ทะเบียนครบ", () => {
  assert.equal(L.validatePayload(PAYLOAD), null);
  assert.match(L.validatePayload({ ...PAYLOAD, ownerNames: [1, 2, 3].map((i) => ({ value: "ก" + i, source: "customer" })) }), /1–2/);
  assert.match(L.validatePayload({ ...PAYLOAD, ownerNames: [] }), /1–2/);
  assert.match(L.validatePayload({ ...PAYLOAD, version: 2 }), /version/);
  assert.match(L.validatePayload({ ...PAYLOAD, plate2: "12345" }), /ทะเบียน/);
  assert.match(L.validatePayload({ ...PAYLOAD, runId: "" }), /runId/);
  assert.match(L.validatePayload(null), /ว่าง/);
});

test("newRun + applyDltEvent — ไทม์ไลน์ · registration ค่าแรกชนะ · heartbeat ไม่ลงไทม์ไลน์", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: PAYLOAD, nowIso: T0 });
  assert.equal(run.phase, "starting");
  run = L.applyDltEvent(run, { type: "phase", phase: "registering" }, "t1");
  run = L.applyDltEvent(run, { type: "registration", value: "already_listed", ownerName: "ทดสอบ ตัวอย่าง" }, "t2");
  run = L.applyDltEvent(run, { type: "registration", value: "registered" }, "t3");
  const before = run.timeline.length;
  run = L.applyDltEvent(run, { type: "heartbeat" }, "t4");
  assert.equal(run.phase, "registering");
  assert.equal(run.registration, "already_listed");
  assert.equal(run.dltSays.listedOwnerName, "ทดสอบ ตัวอย่าง");
  assert.equal(run.timeline.length, before);
  assert.equal(run.updatedAt, "t4");
});

test("fields: ที่กรอกทีหลังลบรายการข้าม และกลับกัน · values รวมกัน", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: PAYLOAD, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "fields", skipped: [{ field: "province", reason: "option_missing", value: "จังหวัดสมมุติ" }] }, "t1");
  run = L.applyDltEvent(run, { type: "fields", filled: ["province"], values: { province: "จังหวัดสมมุติ" } }, "t2");
  assert.deepEqual(run.fields.filled, ["province"]);
  assert.deepEqual(run.fields.skipped, []);
  run = L.applyDltEvent(run, { type: "fields", skipped: [{ field: "province", reason: "dlt_says_empty", value: null }] }, "t3");
  assert.deepEqual(run.fields.filled, []);
  assert.equal(run.fields.skipped[0].reason, "dlt_says_empty");
  assert.equal(run.fields.values.province, "จังหวัดสมมุติ");
});

test("final สร้าง result ตามสัญญา แล้วรอบปิดตาย (เหตุการณ์หลังจากนั้นถูกทิ้ง)", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: PAYLOAD, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "name_attempt", name: "ทดสอบ ตัวอย่าง", source: "customer", accepted: true }, "t1");
  run = L.applyDltEvent(run, { type: "dlt_message", page: "esv02i001", kind: "registered", text: "ลงทะเบียนรถเรียบร้อยแล้ว" }, "t2");
  run = L.applyDltEvent(run, { type: "final", outcome: "ready_to_submit" }, "t3");
  const r = run.result;
  assert.equal(r.resultVersion, 1);
  assert.equal(r.outcome, "ready_to_submit");
  assert.equal(r.registration, "not_registered");
  assert.deepEqual(r.nameAttempts, [{ name: "ทดสอบ ตัวอย่าง", source: "customer", accepted: true }]);
  assert.equal(r.dltMessages[0].at, "t2");
  assert.equal(r.timeline.at(-1).event, "final:ready_to_submit");
  assert.equal("error" in r, false);
  const after = L.applyDltEvent(run, { type: "phase", phase: "x" }, "t4");
  assert.equal(after, run);
});

test("ตัดตาม LIMITS: ข้อความ 2,000 · dltMessages 50 · timeline 200 · nameAttempts 20", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: PAYLOAD, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "dlt_message", page: "p", kind: "k", text: "ก".repeat(5000) }, "t");
  assert.equal(run.dltMessages[0].text.length, 2000);
  for (let i = 0; i < 60; i++) run = L.applyDltEvent(run, { type: "dlt_message", page: "p", kind: "k", text: "x" }, "t");
  for (let i = 0; i < 25; i++) run = L.applyDltEvent(run, { type: "name_attempt", name: "n", source: "officer", accepted: false }, "t");
  for (let i = 0; i < 250; i++) run = L.applyDltEvent(run, { type: "note", event: "n" + i }, "t");
  assert.equal(run.dltMessages.length, 50);
  assert.equal(run.nameAttempts.length, 20);
  assert.equal(run.timeline.length, 200);
  run = L.applyDltEvent(run, { type: "final", outcome: "bot_error", error: "e".repeat(3000) }, "t");
  assert.equal(run.result.error.length, 2000);
});

test("sanitizeEvent — visit มาจากหน้าไม่ได้ · type/outcome ที่ไม่รู้จักถูกทิ้ง", () => {
  assert.equal(L.sanitizeEvent({ type: "visit", kind: "register" }), null);
  assert.equal(L.sanitizeEvent({ type: "hack" }), null);
  assert.equal(L.sanitizeEvent({ type: "final", outcome: "paid" }), null);
  assert.equal(L.sanitizeEvent(null), null);
  assert.deepEqual(L.sanitizeEvent({ type: "final", outcome: "timeout" }), { type: "final", outcome: "timeout" });
});

test("isIdle / isExpired", () => {
  const run = L.newRun({ runId: "r1", tabId: 7, payload: PAYLOAD, nowIso: T0 });
  const t0 = Date.parse(T0);
  assert.equal(L.isIdle(run, t0 + 29 * 60000, 30 * 60000), false);
  assert.equal(L.isIdle(run, t0 + 31 * 60000, 30 * 60000), true);
  const done = L.applyDltEvent(run, { type: "final", outcome: "aborted" }, T0);
  assert.equal(L.isIdle(done, t0 + 31 * 60000, 30 * 60000), false);
  assert.equal(L.isExpired(done, t0 + 25 * 3600000, 24 * 3600000), true);
  assert.equal(L.isExpired(run, t0 + 25 * 3600000, 24 * 3600000), false);
});
