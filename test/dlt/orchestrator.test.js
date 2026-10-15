// โหลด lib.js + orchestrator.js ใน vm พร้อม chrome ปลอม — เรียกฟังก์ชันระดับบนของ SW ตรง ๆ
// ⛔ PUBLIC REPO — ข้อมูลแต่งขึ้นทั้งหมด
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const REGISTER = "https://eservice.dlt.go.th/esvapp/esv/ebk/esv02i001/index.jsf";
const j = (x) => JSON.parse(JSON.stringify(x));

function payload(runId, extra) {
  return { version: 1, runId, display: { customer: "ทดสอบ ตัวอย่าง", plate: "1ทด 1111 จังหวัดสมมุติ" }, vehicleTypeLabel: "รถจักรยานยนต์", provinceLabel: "จังหวัดสมมุติ", plate1: "1ทด", plate2: "1111", ownerNames: [{ value: "ทดสอบ ตัวอย่าง", source: "customer" }], mileage: null, ours: { expiryDate: null, jobType: "tax_only" }, ...extra };
}

function boot() {
  const store = {};
  const calls = { created: [], updated: [], exec: [], alarms: [], cleared: 0 };
  let nextTab = 100;
  const listeners = { updated: [], removed: [], message: [], alarm: [] };
  const chrome = {
    storage: {
      local: {
        async get(key) {
          if (key == null) return j(store);
          return key in store ? { [key]: j(store[key]) } : {};
        },
        async set(obj) { for (const [k, v] of Object.entries(obj)) store[k] = j(v); },
        async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
      },
    },
    tabs: {
      async create(o) { const t = { id: nextTab++, url: o.url }; calls.created.push(t); return t; },
      async update(id, o) { calls.updated.push({ id, url: o.url }); return { id, url: o.url }; },
      onUpdated: { addListener: (f) => listeners.updated.push(f) },
      onRemoved: { addListener: (f) => listeners.removed.push(f) },
    },
    scripting: { async executeScript(o) { calls.exec.push(o); return [{ result: "started" }]; } },
    alarms: {
      async create(name, o) { calls.alarms.push([name, o]); },
      async clear() { calls.cleared += 1; return true; },
      onAlarm: { addListener: (f) => listeners.alarm.push(f) },
    },
    runtime: { onMessage: { addListener: (f) => listeners.message.push(f) } },
  };
  const sandbox = { chrome, console, URL, setTimeout, clearTimeout };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "scripts/dlt/lib.js"), "utf8"), sandbox, { filename: "lib.js" });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "scripts/dlt/orchestrator.js"), "utf8"), sandbox, { filename: "orchestrator.js" });
  return { sw: sandbox, store, calls, listeners };
}

async function start(sw, runId) {
  return j(await sw.handleDltExternalMessage({ type: "FILL_DLT_TAX", data: payload(runId) }));
}

test("ลงทะเบียน listener ครบตอนโหลด (SW ต้องลงที่ระดับบนสุด)", () => {
  const { listeners } = boot();
  assert.equal(listeners.updated.length, 1);
  assert.equal(listeners.removed.length, 1);
  assert.equal(listeners.message.length, 1);
  assert.equal(listeners.alarm.length, 1);
});

test("FILL_DLT_TAX: เปิดแท็บเปล่า → บันทึกรอบ → พาไปหน้าลงทะเบียน · ตั้ง alarm", async () => {
  const { sw, store, calls } = boot();
  assert.deepEqual(await start(sw, "r1"), { accepted: true });
  assert.equal(calls.created[0].url, "about:blank");
  assert.deepEqual(calls.updated.at(-1), { id: 100, url: REGISTER });
  assert.equal(store.dltCurrentRunId, "r1");
  assert.equal(store["dltRun:r1"].phase, "starting");
  assert.equal(store["dltRun:r1"].tabId, 100);
  assert.equal(calls.alarms[0][0], "moto24-dlt-sweep");
});

test("FILL_DLT_TAX ปฏิเสธ payload ผิดสัญญา (3 ชื่อ) โดยไม่เปิดแท็บ · runId ซ้ำก็ปฏิเสธ", async () => {
  const { sw, calls } = boot();
  const three = payload("r1", { ownerNames: ["ก", "ข", "ค"].map((v) => ({ value: v, source: "customer" })) });
  const res = j(await sw.handleDltExternalMessage({ type: "FILL_DLT_TAX", data: three }));
  assert.equal(res.success, false);
  assert.equal(calls.created.length, 0);
  await start(sw, "r2");
  assert.equal(j(await sw.handleDltExternalMessage({ type: "FILL_DLT_TAX", data: payload("r2") })).success, false);
});

test("GET_DLT_TAX_RESULT: unknown / running / final", async () => {
  const { sw } = boot();
  assert.deepEqual(j(await sw.handleDltExternalMessage({ type: "GET_DLT_TAX_RESULT", runId: "nope" })), { state: "unknown" });
  await start(sw, "r1");
  assert.deepEqual(j(await sw.handleDltExternalMessage({ type: "GET_DLT_TAX_RESULT", runId: "r1" })), { state: "running", phase: "starting" });
  await sw.dltOnRelayEvent({ type: "DLT_EVENT", runId: "r1", event: { type: "final", outcome: "prb_not_found" } }, { tab: { id: 100 } });
  const fin = j(await sw.handleDltExternalMessage({ type: "GET_DLT_TAX_RESULT", runId: "r1" }));
  assert.equal(fin.state, "final");
  assert.equal(fin.result.outcome, "prb_not_found");
});

test("หน้าหลักหลังล็อกอิน ⇒ พาไปหน้าลงทะเบียน · หน้าลงทะเบียน ⇒ inject relay + lib/steps แล้วเรียก runRegister", async () => {
  const { sw, store, calls } = boot();
  await start(sw, "r1");
  await sw.dltOnTabComplete(100, "https://eservice.dlt.go.th/esvapp/index.jsf");
  assert.equal(store["dltRun:r1"].phase, "navigating");
  assert.deepEqual(calls.updated.at(-1), { id: 100, url: REGISTER });
  await sw.dltOnTabComplete(100, REGISTER);
  assert.equal(store["dltRun:r1"].phase, "registering");
  const [relay, page, fn] = calls.exec.slice(-3);
  assert.deepEqual(j(relay.files), ["scripts/dlt/relay.js"]);
  assert.equal(relay.world, undefined);
  assert.deepEqual(j(page.files), ["scripts/dlt/lib.js", "scripts/dlt/steps.js"]);
  assert.equal(page.world, "MAIN");
  assert.equal(fn.world, "MAIN");
  assert.equal(fn.args[0], "runRegister");
  assert.equal(fn.args[1].runId, "r1");
  assert.equal(fn.args[1].payload.plate1, "1ทด");
});

test("หน้าล็อกอินของ eservice ⇒ onLoginPage · โดเมนอื่น ⇒ รอเฉย ๆ ไม่ inject", async () => {
  const { sw, store, calls } = boot();
  await start(sw, "r1");
  await sw.dltOnTabComplete(100, "https://connect.egov.go.th/login");
  assert.equal(store["dltRun:r1"].phase, "waiting_login");
  assert.equal(calls.exec.length, 0);
  await sw.dltOnTabComplete(100, "https://eservice.dlt.go.th/esvapp/login.jsf");
  assert.equal(calls.exec.at(-1).args[0], "onLoginPage");
});

test("หน้าอื่นบน eservice ⇒ unexpected_page · แท็บอื่นไม่สน", async () => {
  const { sw, store } = boot();
  await start(sw, "r1");
  await sw.dltOnTabComplete(999, "https://eservice.dlt.go.th/esvapp/esv/ebk/esv02q001/index.jsf");
  assert.equal(store["dltRun:r1"].result, null);
  await sw.dltOnTabComplete(100, "https://eservice.dlt.go.th/esvapp/esv/ebk/esv02q001/index.jsf");
  assert.equal(store["dltRun:r1"].result.outcome, "unexpected_page");
});

test("เหตุการณ์จากแท็บ/runId ที่ไม่ตรงถูกทิ้ง", async () => {
  const { sw, store } = boot();
  await start(sw, "r1");
  assert.deepEqual(j(await sw.dltOnRelayEvent({ type: "DLT_EVENT", runId: "r1", event: { type: "phase", phase: "x" } }, { tab: { id: 555 } })), { ok: false });
  assert.deepEqual(j(await sw.dltOnRelayEvent({ type: "DLT_EVENT", runId: "zz", event: { type: "phase", phase: "x" } }, { tab: { id: 100 } })), { ok: false });
  assert.equal(store["dltRun:r1"].phase, "starting");
});

test("สั่งงานใหม่ระหว่างรอบเก่าค้าง ⇒ รอบเก่า superseded และเหตุการณ์จากแท็บเก่าถูกทิ้ง", async () => {
  const { sw, store } = boot();
  await start(sw, "r1");
  await start(sw, "r2");
  assert.equal(store["dltRun:r1"].result.outcome, "superseded");
  assert.equal(store.dltCurrentRunId, "r2");
  assert.deepEqual(j(await sw.dltOnRelayEvent({ type: "DLT_EVENT", runId: "r1", event: { type: "final", outcome: "ready_to_submit" } }, { tab: { id: 100 } })), { ok: false });
});

test("ปิดแท็บกลางทาง ⇒ aborted", async () => {
  const { sw, store } = boot();
  await start(sw, "r1");
  await sw.dltOnTabRemoved(100);
  assert.equal(store["dltRun:r1"].result.outcome, "aborted");
});

test("sweep: เงียบเกิน 30 นาที ⇒ timeout · จบแล้วเกิน 24 ชม. ⇒ ลบ + เคลียร์ alarm", async () => {
  const { sw, store, calls } = boot();
  await start(sw, "r1");
  store["dltRun:r1"].updatedAt = new Date(Date.now() - 31 * 60000).toISOString();
  await sw.dltSweep(Date.now());
  assert.equal(store["dltRun:r1"].result.outcome, "timeout");
  store["dltRun:r1"].updatedAt = new Date(Date.now() - 25 * 3600000).toISOString();
  await sw.dltSweep(Date.now());
  assert.equal(store["dltRun:r1"], undefined);
  assert.equal(store.dltCurrentRunId, undefined);
  assert.ok(calls.cleared >= 1);
});

// ── Task 9: กติกาเหล็ก §6.3 ระดับ orchestrator (Ruling R8) ─────────────────────────────

const DELIVERY = { kind: "branch", recipientName: "ผู้รับสมมุติ", addressLine: "1/1", subDistrict: "ตำบลสมมุติ", district: "อำเภอสมมุติ", province: "จังหวัดสมมุติ", postalCode: "10000", phone: null, email: null };

async function startV2(sw, runId) {
  return j(await sw.handleDltExternalMessage({ type: "FILL_DLT_TAX", data: payload(runId, { version: 2, delivery: DELIVERY }) }));
}

/** หน้ายื่นภาษีพบ พ.ร.บ. แล้วกำลังรอคนกดไปหน้าที่อยู่ (สเปก 2026-10-15 §7 ข้อ 1–2) */
async function waitingAddress(sw, runId, tabId) {
  for (const event of [{ type: "ready_reached" }, { type: "phase", phase: "waiting_address" }]) {
    await sw.dltOnRelayEvent({ type: "DLT_EVENT", runId, event }, { tab: { id: tabId } });
  }
}

test("🔒 §6.3 dltOnTabRemoved: ปิดแท็บระหว่างรอหน้าที่อยู่ ⇒ ready_to_submit + not_reached/aborted", async () => {
  const { sw, store } = boot();
  await startV2(sw, "r1");
  await waitingAddress(sw, "r1", 100);
  await sw.dltOnTabRemoved(100);
  assert.equal(store["dltRun:r1"].result.outcome, "ready_to_submit");
  assert.deepEqual([store["dltRun:r1"].result.address.status, store["dltRun:r1"].result.address.reason], ["not_reached", "aborted"]);
});

test("🔒 §6.3 supersede ใน handleDltExternalMessage: สั่งรอบใหม่ระหว่างรอ ⇒ รอบเก่า ready_to_submit + superseded", async () => {
  const { sw, store } = boot();
  await startV2(sw, "r1");
  await waitingAddress(sw, "r1", 100);
  await startV2(sw, "r2");
  assert.equal(store["dltRun:r1"].result.outcome, "ready_to_submit");
  assert.equal(store["dltRun:r1"].result.address.reason, "superseded");
  assert.equal(store.dltCurrentRunId, "r2");
  // moto24 ดึงผลรอบเก่าได้ทันทีหลังสั่งรอบใหม่ (Ruling R1)
  const old = j(await sw.handleDltExternalMessage({ type: "GET_DLT_TAX_RESULT", runId: "r1" }));
  assert.equal(old.state, "final");
  assert.equal(old.result.outcome, "ready_to_submit");
});

test("🔒 §6.3 dltSweep: เงียบเกิน 30 นาทีระหว่างรอ (หน้าตาย) ⇒ ready_to_submit + timeout", async () => {
  const { sw, store } = boot();
  await startV2(sw, "r1");
  await waitingAddress(sw, "r1", 100);
  store["dltRun:r1"].updatedAt = new Date(Date.now() - 31 * 60000).toISOString();
  await sw.dltSweep(Date.now());
  assert.equal(store["dltRun:r1"].result.outcome, "ready_to_submit");
  assert.equal(store["dltRun:r1"].result.address.reason, "timeout");
});

test("🔒 §6.3 unexpected_page: ออกจากหน้ายื่นภาษีระหว่างรอ ⇒ ready_to_submit + page_changed", async () => {
  const { sw, store } = boot();
  await startV2(sw, "r1");
  await waitingAddress(sw, "r1", 100);
  await sw.dltOnTabComplete(100, "https://eservice.dlt.go.th/esvapp/esv/ebk/esv02q001/index.jsf");
  assert.equal(store["dltRun:r1"].result.outcome, "ready_to_submit");
  assert.equal(store["dltRun:r1"].result.address.reason, "page_changed");
});

test("รอบ v2 ที่ยังไม่ถึงหน้ายื่นภาษี ปิดแท็บ ⇒ aborted ตามเดิม (address not_ready)", async () => {
  const { sw, store } = boot();
  await startV2(sw, "r1");
  await sw.dltOnTabRemoved(100);
  assert.equal(store["dltRun:r1"].result.outcome, "aborted");
  assert.equal(store["dltRun:r1"].result.address.reason, "not_ready");
});

// I4 (controller): ready_reached หล่นระหว่าง relay ก็ต้องยังบังคับกติกาเหล็ก
test("🔒 I4: ไม่มี ready_reached แต่มี phase waiting_address แล้วปิดแท็บ ⇒ ready_to_submit + not_reached/aborted", async () => {
  const { sw, store } = boot();
  await startV2(sw, "r1");
  await sw.dltOnRelayEvent({ type: "DLT_EVENT", runId: "r1", event: { type: "phase", phase: "waiting_address" } }, { tab: { id: 100 } });
  await sw.dltOnTabRemoved(100);
  assert.equal(store["dltRun:r1"].result.outcome, "ready_to_submit");
  assert.deepEqual([store["dltRun:r1"].result.address.status, store["dltRun:r1"].result.address.reason], ["not_reached", "aborted"]);
});

test("🔒 I4: final ready_to_submit จากหน้าโดยไม่มี ready_reached/address ⇒ address not_reached/no_report (ผ่าน R7)", async () => {
  const { sw, store } = boot();
  await startV2(sw, "r1");
  await sw.dltOnRelayEvent({ type: "DLT_EVENT", runId: "r1", event: { type: "final", outcome: "ready_to_submit" } }, { tab: { id: 100 } });
  const r = store["dltRun:r1"].result;
  assert.equal(r.resultVersion, 2);
  assert.equal(r.outcome, "ready_to_submit");
  assert.deepEqual([r.address.status, r.address.reason], ["not_reached", "no_report"]);
});

// Fix round 1 (I-1): หลัง prb_ok รอบค้างได้ 20 นาที — โหลดหน้าเก่าเต็มหน้าต้องไม่สั่งบอทกรอก/กดซ้ำ
const STEP_NAMES = ["onLoginPage", "runRegister", "onAgreementPage", "runTaxForm"];
function dispatchedSteps(calls) {
  return calls.exec.filter((o) => Array.isArray(o.args) && STEP_NAMES.includes(o.args[0])).map((o) => o.args[0]);
}

for (const [kind, url] of [
  ["register", REGISTER],
  ["agreement", "https://eservice.dlt.go.th/esvapp/esv/ebk/taxAgreement/index.jsf"],
  ["login", "https://eservice.dlt.go.th/esvapp/login.jsf"],
]) {
  test("🔒 I-1: รอบ v2 ผ่าน prb_ok แล้ว แท็บโหลดหน้า " + kind + " ⇒ ไม่ dispatch ขั้นใหม่ · ready_to_submit + page_changed", async () => {
    const { sw, store, calls } = boot();
    await startV2(sw, "r1");
    await waitingAddress(sw, "r1", 100);
    const before = dispatchedSteps(calls).length;
    await sw.dltOnTabComplete(100, url);
    assert.equal(dispatchedSteps(calls).length, before, "ห้ามสั่งขั้นใหม่");
    const r = store["dltRun:r1"].result;
    assert.ok(r, "รอบต้องถูกปิด");
    assert.equal(r.outcome, "ready_to_submit");
    assert.equal(r.address.reason, "page_changed");
  });
}

test("I-1: kind ที่ใช้ในเทสต์ข้างบนจำแนกได้ตรง (กันเทสต์ผ่านเพราะ URL ผิด)", () => {
  const L = require("../../scripts/dlt/lib.js");
  assert.equal(L.classifyDltUrl(REGISTER), "register");
  assert.equal(L.classifyDltUrl("https://eservice.dlt.go.th/esvapp/esv/ebk/taxAgreement/index.jsf"), "agreement");
  assert.equal(L.classifyDltUrl("https://eservice.dlt.go.th/esvapp/login.jsf"), "login");
  assert.equal(L.classifyDltUrl("https://eservice.dlt.go.th/esvapp/esv/ebk/esv02i002/index.jsf"), "tax_form");
});

test("I-1: รอบ v2 ผ่าน prb_ok แล้ว หน้ายื่นภาษีโหลดใหม่ ⇒ ทำงานเหมือนเดิม (dispatch runTaxForm · ยังไม่ปิดรอบ)", async () => {
  const { sw, store, calls } = boot();
  await startV2(sw, "r1");
  await waitingAddress(sw, "r1", 100);
  await sw.dltOnTabComplete(100, "https://eservice.dlt.go.th/esvapp/esv/ebk/esv02i002/index.jsf");
  assert.equal(store["dltRun:r1"].result, null);
  assert.deepEqual(dispatchedSteps(calls).slice(-1), ["runTaxForm"]);
});

test("I-1: รอบ v2 ที่ยังไม่ผ่าน prb_ok โหลดหน้าลงทะเบียน ⇒ runRegister ตามเดิม", async () => {
  const { sw, store, calls } = boot();
  await startV2(sw, "r1");
  await sw.dltOnTabComplete(100, REGISTER);
  assert.equal(store["dltRun:r1"].result, null);
  assert.deepEqual(dispatchedSteps(calls).slice(-1), ["runRegister"]);
});

test("final review m-8: รอบ v2 ผ่าน prb_ok แล้วไปหน้าที่ไม่รู้จัก ⇒ note มี pathname (เหมือน unexpected_page:<path>)", async () => {
  const { sw, store } = boot();
  await startV2(sw, "r1");
  await waitingAddress(sw, "r1", 100);
  await sw.dltOnTabComplete(100, "https://eservice.dlt.go.th/esvapp/esv/ebk/esv02q001/index.jsf?x=1");
  const events = store["dltRun:r1"].timeline.map((t) => t.event);
  assert.ok(events.includes("note:left_tax_form:unexpected:/esvapp/esv/ebk/esv02q001/index.jsf"), JSON.stringify(events));
  assert.equal(store["dltRun:r1"].result.outcome, "ready_to_submit");
  // kind ที่รู้จัก ⇒ note เดิม (ชนิดหน้า)
  const b = boot();
  await startV2(b.sw, "r2");
  await waitingAddress(b.sw, "r2", 100);
  await b.sw.dltOnTabComplete(100, REGISTER);
  assert.ok(b.store["dltRun:r2"].timeline.some((t) => t.event === "note:left_tax_form:register"));
});
