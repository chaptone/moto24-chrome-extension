// ⛔ PUBLIC REPO — ข้อมูลแต่งขึ้นทั้งหมด
const test = require("node:test");
const assert = require("node:assert/strict");

const L = require("../../scripts/dlt/lib.js");

const T0 = "2026-01-01T00:00:00.000Z";
const PAYLOAD = { version: 1, runId: "r1", display: { customer: "ทดสอบ ตัวอย่าง", plate: "1ทด 1111 จังหวัดสมมุติ" }, vehicleTypeLabel: "รถจักรยานยนต์", provinceLabel: "จังหวัดสมมุติ", plate1: "1ทด", plate2: "1111", ownerNames: [{ value: "ทดสอบ ตัวอย่าง", source: "customer" }], mileage: null, ours: { expiryDate: null, jobType: "tax_only" } };
const DELIVERY = { kind: "branch", recipientName: "ผู้รับสมมุติ", addressLine: "1/1 หมู่ 1", subDistrict: "ตำบลสมมุติ", district: "อำเภอสมมุติ", province: "จังหวัดสมมุติ", postalCode: "10000", phone: null, email: null };
const V2 = { ...PAYLOAD, version: 2, delivery: DELIVERY };

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
  assert.match(L.validatePayload({ ...PAYLOAD, version: 3 }), /version/);
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

test("validatePayload v2 — delivery (สเปก 2026-10-15 §6.1) · v1 ยังรับ (Ruling R6)", () => {
  assert.equal(L.validatePayload(V2), null);
  assert.equal(L.validatePayload({ ...V2, delivery: { ...DELIVERY, kind: "home" } }), null);
  assert.equal(L.validatePayload({ ...V2, delivery: { kind: "none", reason: "no_branch_address" } }), null);
  assert.equal(L.validatePayload({ ...V2, delivery: { kind: "none", reason: "no_home_address" } }), null);
  assert.match(L.validatePayload({ ...V2, delivery: undefined }), /delivery/);
  assert.match(L.validatePayload({ ...V2, delivery: { ...DELIVERY, addressLine: " " } }), /addressLine/);
  assert.match(L.validatePayload({ ...V2, delivery: { ...DELIVERY, phone: 1 } }), /phone/);
  assert.match(L.validatePayload({ ...V2, delivery: { kind: "none", reason: "x" } }), /reason/);
  assert.match(L.validatePayload({ ...V2, delivery: { ...DELIVERY, kind: "x" } }), /kind/);
  assert.equal(L.validatePayload(PAYLOAD), null);
});

// ── Task 9: result v2 (address) + กติกาเหล็ก §6.3 ──────────────────────────────────────

test("v2 ที่ไม่เคยถึงหน้ายื่นภาษี ⇒ resultVersion 2 · outcome ตามจริง · address not_reached/not_ready", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
  assert.equal(run.reachedReady, false);
  assert.equal(run.address, null);
  run = L.applyDltEvent(run, { type: "final", outcome: "prb_not_found" }, "t1");
  assert.equal(run.result.resultVersion, 2);
  assert.equal(run.result.outcome, "prb_not_found");
  assert.deepEqual(run.result.address, { status: "not_reached", reason: "not_ready", filled: [], skipped: [], dltZip: null, notes: [] });
});

test("🔒 §6.3 reducer: ถึงหน้ายื่นภาษีแล้วจบด้วย aborted/superseded/timeout/unexpected_page ⇒ ready_to_submit + เหตุใน address.reason", () => {
  for (const [requested, reason] of [["aborted", "aborted"], ["superseded", "superseded"], ["timeout", "timeout"], ["unexpected_page", "page_changed"]]) {
    let run = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
    run = L.applyDltEvent(run, { type: "ready_reached" }, "t1");
    run = L.applyDltEvent(run, { type: "final", outcome: requested }, "t2");
    assert.equal(run.result.outcome, "ready_to_submit", requested);
    assert.deepEqual(run.result.address, { status: "not_reached", reason, filled: [], skipped: [], dltZip: null, notes: [] }, requested);
    assert.equal(run.timeline.at(-1).event, "final:" + requested); // ไทม์ไลน์ยังบอกว่าจบเพราะอะไรจริง
  }
});

test("🔒 §6.3: bot_error หลังถึงหน้ายื่นภาษี ⇒ ready_to_submit · ข้อความไปอยู่ address.notes ไม่ใช่ result.error", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "ready_reached" }, "t1");
  run = L.applyDltEvent(run, { type: "final", outcome: "bot_error", error: "service worker: พัง" }, "t2");
  assert.equal(run.result.outcome, "ready_to_submit");
  assert.equal("error" in run.result, false);
  assert.equal(run.result.address.reason, "bot_error");
  assert.deepEqual(run.result.address.notes, ["bot_error: service worker: พัง"]);
});

test("address จากหน้า (ตัดตาม LIMITS) แล้ว final ready_to_submit ใช้ address นั้น · SW ปิดก่อน final ก็ไม่ทับ", () => {
  const addr = { status: "partial", reason: null, filled: ["recipientName"], skipped: [{ field: "addressLine", reason: "too_long", value: "x".repeat(5000) }], dltZip: "10000", notes: [] };
  let run = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "ready_reached" }, "t1");
  run = L.applyDltEvent(run, { type: "address", address: addr }, "t2");
  assert.equal(run.address.skipped[0].value.length, 2000);
  const viaPage = L.applyDltEvent(run, { type: "final", outcome: "ready_to_submit" }, "t3");
  assert.equal(viaPage.result.address.status, "partial");
  const viaSw = L.applyDltEvent(run, { type: "final", outcome: "aborted" }, "t3");
  assert.equal(viaSw.result.outcome, "ready_to_submit");
  assert.equal(viaSw.result.address.status, "partial");
});

test("address ที่ status ไม่รู้จักถูกทิ้ง", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "address", address: { status: "paid" } }, "t1");
  assert.equal(run.address, null);
});

test("payload v1 (R6): ready_reached/address ถูกละ · result v1 ไม่มี address — พฤติกรรมเดิม", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: PAYLOAD, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "ready_reached" }, "t1");
  run = L.applyDltEvent(run, { type: "address", address: L.emptyAddress("filled", null) }, "t2");
  run = L.applyDltEvent(run, { type: "phase", phase: "waiting_address" }, "t3");
  run = L.applyDltEvent(run, { type: "final", outcome: "aborted" }, "t4");
  assert.equal(run.result.resultVersion, 1);
  assert.equal(run.result.outcome, "aborted");
  assert.equal("address" in run.result, false);
});

test("sanitizeEvent ยอม ready_reached / address", () => {
  assert.deepEqual(L.sanitizeEvent({ type: "ready_reached" }), { type: "ready_reached" });
  assert.equal(L.sanitizeEvent({ type: "address", address: {} }).type, "address");
});

// I4 (controller): ห้ามพึ่ง ready_reached ตัวเดียว — relay ยิงแล้วลืมอาจหล่น
test("🔒 I4: phase waiting_address/filling_address · event address · final ready_to_submit ⇒ นับว่าผ่าน prb_ok แล้ว", () => {
  for (const ev of [{ type: "phase", phase: "waiting_address" }, { type: "phase", phase: "filling_address" }, { type: "address", address: { status: "paid" } }]) {
    let run = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
    run = L.applyDltEvent(run, ev, "t1");
    assert.equal(run.reachedReady, true, JSON.stringify(ev));
    run = L.applyDltEvent(run, { type: "final", outcome: "aborted" }, "t2");
    assert.equal(run.result.outcome, "ready_to_submit", JSON.stringify(ev));
    assert.equal(run.result.address.reason, "aborted", JSON.stringify(ev));
  }
  let run = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "phase", phase: "filling_form" }, "t1");
  assert.equal(run.reachedReady, false);
  run = L.applyDltEvent(run, { type: "final", outcome: "ready_to_submit" }, "t2");
  assert.equal(run.result.outcome, "ready_to_submit");
  assert.deepEqual(run.result.address, { status: "not_reached", reason: "no_report", filled: [], skipped: [], dltZip: null, notes: [] });
});

test("🔒 R7: address not_reached/not_ready ⇔ outcome ≠ ready_to_submit — ทุกเส้นทางของ reducer", () => {
  const pre = [[], [{ type: "ready_reached" }], [{ type: "phase", phase: "waiting_address" }], [{ type: "ready_reached" }, { type: "address", address: { status: "not_reached", reason: "not_ready", filled: [], skipped: [], dltZip: null, notes: [] } }], [{ type: "address", address: { status: "filled", reason: null, filled: ["recipientName"], skipped: [], dltZip: "10000", notes: [] } }]];
  for (const evs of pre) {
    for (const outcome of L.OUTCOMES) {
      let run = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
      for (const ev of evs) run = L.applyDltEvent(run, ev, "t1");
      run = L.applyDltEvent(run, { type: "final", outcome, error: "e" }, "t2");
      const a = run.result.address;
      const neverReady = a.status === "not_reached" && a.reason === L.ADDRESS_NOT_READY;
      assert.equal(neverReady, run.result.outcome !== "ready_to_submit", JSON.stringify({ evs, outcome }));
      assert.ok(L.ADDRESS_STATUSES.includes(a.status));
      assert.equal(run.result.resultVersion, 2);
    }
  }
});

// final review m-6: address กับ final เคยเป็นสองข้อความแยกผ่าน relay — address หล่น/มาหลัง final ⇒ รายงานหาย
const FILLED = { status: "filled", reason: null, filled: ["recipientName", "addressLine"], skipped: [], dltZip: "10000", notes: [] };

test("m-6: final ที่พก address มาเอง (event address หล่น) ⇒ result.address = ตัวที่มากับ final", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "ready_reached" }, "t1");
  run = L.applyDltEvent(run, { type: "final", outcome: "ready_to_submit", address: FILLED }, "t2");
  assert.equal(run.result.outcome, "ready_to_submit");
  assert.deepEqual(run.result.address, FILLED);
});

test("m-6: final พก address แม้ ready_reached หล่นด้วย ⇒ ถือว่าผ่าน prb_ok (I4) · กติกาเหล็ก §6.3 ยังบังคับ", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "final", outcome: "bot_error", error: "e", address: FILLED }, "t1");
  assert.equal(run.result.outcome, "ready_to_submit");
  assert.equal(run.result.address.status, "filled");
  assert.ok(run.result.address.notes.includes("bot_error: e"));
  assert.equal("error" in run.result, false);
});

test("m-6: address แยกมาก่อน final ที่ไม่พก address ⇒ ใช้ตัวที่มาแยก (ทางเดิมยังรับ)", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "ready_reached" }, "t1");
  run = L.applyDltEvent(run, { type: "address", address: FILLED }, "t2");
  run = L.applyDltEvent(run, { type: "final", outcome: "ready_to_submit" }, "t3");
  assert.deepEqual(run.result.address, FILLED);
});

test("m-6: address ที่มากับ final ใช้ไม่ได้ ⇒ ใช้ตัวที่มาแยก · ไม่มีเลย ⇒ no_report (R7 ไม่หลุด)", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "address", address: FILLED }, "t1");
  const kept = L.applyDltEvent(run, { type: "final", outcome: "ready_to_submit", address: { status: "paid" } }, "t2");
  assert.deepEqual(kept.result.address, FILLED);
  let bare = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
  bare = L.applyDltEvent(bare, { type: "final", outcome: "ready_to_submit", address: { status: "paid" } }, "t1");
  assert.deepEqual([bare.result.address.status, bare.result.address.reason], ["not_reached", "no_report"]);
  // หน้ารายงาน not_ready มากับ final ทั้งที่ถึงหน้ายื่นภาษีแล้ว ⇒ R7 แปลงเหตุ
  let lie = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
  lie = L.applyDltEvent(lie, { type: "final", outcome: "ready_to_submit", address: L.emptyAddress("not_reached", L.ADDRESS_NOT_READY) }, "t1");
  assert.equal(lie.result.outcome, "ready_to_submit");
  assert.notEqual(lie.result.address.reason, L.ADDRESS_NOT_READY);
});

test("m-6: event address ที่มาหลัง final ถูกทิ้ง (รอบปิดตาย) — ผลยังเป็นตัวที่มากับ final", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "final", outcome: "ready_to_submit", address: FILLED }, "t1");
  const after = L.applyDltEvent(run, { type: "address", address: L.emptyAddress("partial", "bot_error") }, "t2");
  assert.equal(after, run);
  assert.equal(after.result.address.status, "filled");
});

test("m-6: payload v1 (R6) — address ที่มากับ final ถูกละ · result v1 ไม่มี address", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: PAYLOAD, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "final", outcome: "aborted", address: FILLED }, "t1");
  assert.equal(run.result.resultVersion, 1);
  assert.equal(run.result.outcome, "aborted");
  assert.equal("address" in run.result, false);
});

test("m-2: dlt_says/fields ที่อ่านซ้ำได้ค่าว่าง ไม่ล้างยอดเงิน/policyFlag ที่อ่านไว้", () => {
  let run = L.newRun({ runId: "r1", tabId: 7, payload: V2, nowIso: T0 });
  run = L.applyDltEvent(run, { type: "dlt_says", amounts: [{ label: "ค่าภาษี", raw: "100.00" }] }, "t1");
  run = L.applyDltEvent(run, { type: "fields", values: { policyFlag: "1" } }, "t2");
  run = L.applyDltEvent(run, { type: "dlt_says", amounts: [] }, "t3");
  run = L.applyDltEvent(run, { type: "fields", values: { policyFlag: "" } }, "t4");
  assert.deepEqual(run.dltSays.amounts, [{ label: "ค่าภาษี", raw: "100.00" }]);
  assert.equal(run.fields.values.policyFlag, "1");
  // ยังเขียนครั้งแรกได้ และค่าใหม่ที่ไม่ว่างยังทับได้
  let fresh = L.newRun({ runId: "r2", tabId: 7, payload: V2, nowIso: T0 });
  fresh = L.applyDltEvent(fresh, { type: "fields", values: { policyFlag: "" } }, "t1");
  assert.equal(fresh.fields.values.policyFlag, "");
  fresh = L.applyDltEvent(fresh, { type: "dlt_says", amounts: [{ label: "ก", raw: "1" }] }, "t2");
  fresh = L.applyDltEvent(fresh, { type: "dlt_says", amounts: [{ label: "ข", raw: "2" }] }, "t3");
  assert.deepEqual(fresh.dltSays.amounts, [{ label: "ข", raw: "2" }]);
});
