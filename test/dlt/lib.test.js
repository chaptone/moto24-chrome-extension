// ⛔ PUBLIC REPO — ข้อมูลในเทสต์นี้แต่งขึ้นทั้งหมด (ทะเบียน/ชื่อ/จังหวัดสมมุติ)
const test = require("node:test");
const assert = require("node:assert/strict");

const L = require("../../scripts/dlt/lib.js");

function el(id, parent = null) {
  const node = { id, parentElement: parent, clicks: 0, events: [], value: "" };
  node.click = () => { node.clicks += 1; };
  node.dispatchEvent = (ev) => { node.events.push(ev.type); return true; };
  return node;
}

test("safeClick ปฏิเสธทุก id ใน FORBIDDEN_TARGETS รวมถึงลูกของมัน", () => {
  for (const id of L.FORBIDDEN_TARGETS) {
    const target = el(id);
    assert.throws(() => L.safeClick(target), /ห้ามกด/, id);
    assert.throws(() => L.safeClick(el("inner-span", target)), /ห้ามกด/, id + " (child)");
    assert.equal(target.clicks, 0);
  }
});

test("safeClick ปฏิเสธทุกอย่างใต้ editPage2_ (หน้าที่อยู่/ชำระเงิน)", () => {
  assert.throws(() => L.safeClick(el("x", el("editPage2_anything"))), /ห้ามกด/);
});

test("ชุดปุ่มที่สเปกห้าม อยู่ในรายการครบ", () => {
  for (const id of ["info_submitBtn", "info_checkEmailAgreementBtn", "editPage1_edit2Btn", "editPage1_alertFoundOicBtn", "editPage1_policyFlag"]) {
    assert.ok(L.FORBIDDEN_TARGETS.includes(id), id);
  }
});

test("safeClick กดปุ่มปกติได้ · โหมด jquery ใช้ jQuery ของหน้า", () => {
  const ok = el("add_searchBtn");
  L.safeClick(ok);
  assert.equal(ok.clicks, 1);
  const calls = [];
  globalThis.jQuery = (node) => ({ trigger: (ev) => calls.push([node.id, ev]) });
  try {
    L.safeClick(el("li-item"), { jquery: true });
  } finally {
    delete globalThis.jQuery;
  }
  assert.deepEqual(calls, [["li-item", "click"]]);
  assert.throws(() => L.safeClick(el("li-item"), { jquery: true }), /jQuery/);
});

test("setInputValue ตั้งค่า + ยิง input/change/blur · ปฏิเสธช่องต้องห้าม", () => {
  const input = el("add_plate1");
  assert.equal(L.setInputValue(input, "1ทด"), "1ทด");
  // blur ต้องมี: add_plate2 ของกรมค้นรถใน onblur (PrimeFaces.ab e:'blur') — ไม่ blur = กรมตอบ "ไม่พบข้อมูลรถ" ทุกคัน (QA 2026-09-23)
  assert.deepEqual(input.events, ["input", "change", "blur"]);
  // นามสกุลไม่อยู่ใน allowlist (สเปก 2026-10-15 §7 — บอทไม่แตะ) · ชื่ออยู่ใน allowlist แล้ว
  assert.throws(() => L.setInputValue(el("editPage2_sendLname"), "x"), /ห้ามแตะ/);
  assert.equal(L.setInputValue(el("editPage2_sendFname"), "x"), "x");
});

test("classifyDltMessage — 4 ประเภท", () => {
  assert.equal(L.classifyDltMessage("ลงทะเบียนรถเรียบร้อยแล้ว"), "registered");
  assert.equal(L.classifyDltMessage("ข้อมูลผู้ครอบครองหรือผู้ถือกรรมสิทธิ์ไม่ถูกต้อง"), "owner_mismatch");
  assert.equal(L.classifyDltMessage("ประเภทรถ : ต้องไม่เป็นค่าว่าง"), "field_empty");
  assert.equal(L.classifyDltMessage("ชำระภาษีล่วงหน้าได้ไม่เกิน 3 เดือน วันที่สิ้นอายุภาษี 01 ม.ค. 2599"), "unknown");
  assert.equal(L.classifyDltMessage(""), "unknown");
  assert.equal(L.classifyDltMessage(null), "unknown");
});

test("Review Focus 2: ข้อความยกเลิกลงทะเบียนต้องไม่ถูกอ่านเป็น registered", () => {
  assert.equal(L.classifyDltMessage("แก้ไขข้อมูลเรียบร้อย\nยกเลิกการลงทะเบียนรถเรียบร้อยแล้ว"), "unknown");
});

test("Review Focus 1: ข้อความลงทะเบียนซ้ำ (ยังไม่เคยเห็นของจริง) ⇒ unknown ไม่ใช่ registered", () => {
  assert.equal(L.classifyDltMessage("รถคันนี้ได้ลงทะเบียนไว้แล้ว"), "unknown");
});

test("emptyFieldsFromMessage — แบบ server (มีเว้นวรรค) และแบบ client (ไม่มี)", () => {
  assert.deepEqual(L.emptyFieldsFromMessage("ประเภทรถ : ต้องไม่เป็นค่าว่าง\nจังหวัด/สาขา : ต้องไม่เป็นค่าว่าง"), ["vehicleType", "province"]);
  assert.deepEqual(L.emptyFieldsFromMessage("ประเภทรถ: ต้องไม่เป็นค่าว่าง"), ["vehicleType"]);
  assert.deepEqual(L.emptyFieldsFromMessage("อะไรสักอย่าง : ต้องไม่เป็นค่าว่าง"), ["unknown:อะไรสักอย่าง"]);
});

test("parseThaiDate — พ.ศ. ย่อ → ISO ค.ศ.", () => {
  assert.deepEqual(L.parseThaiDate("08 ก.ย. 2570"), { raw: "08 ก.ย. 2570", iso: "2027-09-08" });
  assert.deepEqual(L.parseThaiDate("วันที่สิ้นอายุภาษี 1 มี.ค. 2569 ครับ"), { raw: "1 มี.ค. 2569", iso: "2026-03-01" });
  assert.deepEqual(L.parseThaiDate("28 ส.ค. 2569").iso, "2026-08-28");
  assert.deepEqual(L.parseThaiDate("31 ก.พ. 2570"), { raw: "31 ก.พ. 2570", iso: null });
  assert.equal(L.parseThaiDate("ไม่มีวันที่"), null);
});

test("Review Focus 5: findListedRow — เว้นวรรค/ขีดต่างกันจับคู่ได้ · คนละจังหวัดไม่จับ", () => {
  const table = {
    headers: ["เลือก", "ลำดับ", "ประเภทรถ", "ชื่อจังหวัด/สาขา", "เลขทะเบียน", "ชื่อเจ้าของรถ", "ยื่นชำระภาษี"],
    rows: [
      ["", "1", "รถจักรยานยนต์", "จังหวัดอื่น", "1ทด 1111", "คนอื่น", ""],
      ["", "2", "รถจักรยานยนต์", "จังหวัดสมมุติ", "1ทด-1111", "ทดสอบ ตัวอย่าง", ""],
    ],
  };
  assert.deepEqual(L.findListedRow(table, { plate1: "1ทด", plate2: "1111", province: "จังหวัดสมมุติ" }), { index: 1, ownerName: "ทดสอบ ตัวอย่าง" });
  assert.equal(L.findListedRow(table, { plate1: "1ทด", plate2: "1111", province: "จังหวัดที่สาม" }), null);
  assert.equal(L.findListedRow(table, { plate1: "1ทด", plate2: "1111", province: null }), null);
  assert.equal(L.findListedRow({ headers: ["x"], rows: [["1ทด 1111"]] }, { plate1: "1ทด", plate2: "1111", province: "จังหวัดสมมุติ" }), null);
});

test("fix round 1 — pickMessageDialogId: cdgsmessagedlg มาก่อนเสมอ · ไม่งั้นหา alertExist… (ลงทะเบียนซ้ำ, Gotcha 5) · ไม่มีทั้งคู่ ⇒ null", () => {
  assert.equal(L.pickMessageDialogId(["cdgsmessagedlg"]), "cdgsmessagedlg");
  assert.equal(L.pickMessageDialogId(["alertExistTr123"]), "alertExistTr123");
  assert.equal(L.pickMessageDialogId(["cdgsmessagedlg", "alertExistTr123"]), "cdgsmessagedlg");
  assert.equal(L.pickMessageDialogId([]), null);
  assert.equal(L.pickMessageDialogId(undefined), null);
  assert.equal(L.pickMessageDialogId(["someOtherDialog"]), null);
});

test("classifyTaxFormDialogs — ตาม id ของ dialog + radio (ไม่ใช่ 'มี dialog ไหม')", () => {
  const ok = { selected: "6", enabled: { 1: false, 5: false, 4: false, 6: true } };
  const none = { selected: null, enabled: { 1: false, 5: true, 4: true, 6: false } };
  assert.equal(L.classifyTaxFormDialogs(["editPage1_alertFoundOicDialog"], ok), "prb_ok");
  assert.equal(L.classifyTaxFormDialogs(["editPage1_alertFoundNotOicDialog"], none), "prb_not_found");
  assert.equal(L.classifyTaxFormDialogs([], none), "prb_not_found");
  assert.equal(L.classifyTaxFormDialogs(["editPage1_failChkAdvanceQtbDialog"], ok), "dlt_blocked");
  assert.equal(L.classifyTaxFormDialogs(["editPage1_alertFoundOicDialog", "editPage1_exitDialog"], ok), "dlt_blocked");
  assert.equal(L.classifyTaxFormDialogs(["editPage1_alertFoundOicDialog"], { selected: "1", enabled: { 1: true, 6: true } }), "dlt_blocked");
  assert.equal(L.classifyTaxFormDialogs([], ok), "prb_ok");
  assert.equal(L.classifyTaxFormDialogs([], { selected: null, enabled: { 1: true, 6: true } }), "unknown");
});

test("pickDetailValues — หัวข้อ→ค่า · 'ครั้งต่อไป' ไม่ปนกับตัวแรก", () => {
  const cells = ["เลขทะเบียน", "1ทด 1111", "วันสิ้นอายุภาษี :", "01 ม.ค. 2599", "วันสิ้นอายุภาษีครั้งต่อไป", "01 ม.ค. 2600"];
  assert.deepEqual(L.pickDetailValues(cells), { taxExpiry: "01 ม.ค. 2599", nextTaxExpiry: "01 ม.ค. 2600" });
  assert.deepEqual(L.pickDetailValues([]), {});
});

test("findSiteVersion", () => {
  assert.equal(L.findSiteVersion("… สงวนลิขสิทธิ์ เวอร์ชั่น 2.1.0002"), "2.1.0002");
  assert.equal(L.findSiteVersion("footer 3.0.0010 end"), "3.0.0010");
  assert.equal(L.findSiteVersion("ไม่มี"), null);
});

test("isBlankDialogText — dialog มองเห็นแต่เนื้อความว่าง ⇒ true · มีข้อความ/ไม่มี dialog ⇒ false", () => {
  assert.equal(L.isBlankDialogText(""), true);
  assert.equal(L.isBlankDialogText("   "), true);
  assert.equal(L.isBlankDialogText("ลงทะเบียนรถเรียบร้อยแล้ว"), false);
  assert.equal(L.isBlankDialogText(null), false);
  assert.equal(L.isBlankDialogText(undefined), false);
});

test("hasMorePages — จากจำนวนลิงก์หน้า + สถานะปุ่มถัดไป", () => {
  assert.equal(L.hasMorePages(null), false);
  assert.equal(L.hasMorePages({ pageLinkCount: 1, nextDisabled: true }), false);
  assert.equal(L.hasMorePages({ pageLinkCount: 2, nextDisabled: true }), true);
  assert.equal(L.hasMorePages({ pageLinkCount: 1, nextDisabled: false }), true);
  assert.equal(L.hasMorePages({ pageLinkCount: 0, nextDisabled: null }), false);
});

test("LIMITS เท่ากับ DLT_RESULT_LIMITS ของ moto24 (KEEP-IN-SYNC)", () => {
  assert.deepEqual({ ...L.LIMITS }, { text: 2000, short: 200, dltMessages: 50, timeline: 200, nameAttempts: 20, fieldList: 50 });
});

test("allowlist editPage2_ (สเปก 2026-10-15 §7): ช่องที่อยู่ที่อนุญาตแตะได้ แม้อยู่ใต้ grid ที่ไม่อยู่ใน allowlist", () => {
  const grid = el("editPage2_editActAdd3Grid");
  for (const id of [
    "editPage2_sendFname",
    "editPage2_addrNo",
    "editPage2_sendZipCode",
    "editPage2_sendPhoneNo",
    "editPage2_sendEmail",
    "editPage2_sendLocCodeProvince_sendLocCodeProvince_input",
    "editPage2_sendLocCodeAmphur_sendLocCodeAmphur_input",
    "editPage2_sendLocCode_sendLocCode_input",
    "editPage2_sendAddType_3",
  ]) {
    assert.equal(L.isForbiddenTarget(el(id, grid)), false, id);
  }
  // กล่อง radio ไม่มี id — บรรพบุรุษใกล้สุดที่ขึ้นต้น editPage2_ คือตาราง radio
  assert.equal(L.isForbiddenTarget(el("", el("", el("editPage2_sendAddType", grid)))), false);
  // รายการ autocomplete ใน panel ของช่องที่อนุญาต
  assert.equal(L.isForbiddenTarget(el("", el("editPage2_sendLocCodeProvince_sendLocCodeProvince_panel"))), false);
});

test("allowlist editPage2_: ที่เหลือยังห้าม — ปุ่ม · dialog · นามสกุล/ถนน · id ที่คล้ายแต่ไม่ใช่", () => {
  for (const id of [
    "editPage2_payBtn",
    "editPage2_backBtn",
    "editPage2_sendLname",
    "editPage2_sendStreet",
    "editPage2_sendLocCodeX",
    "editPage2_sendFnameX",
    "editPage2_anything",
  ]) {
    assert.equal(L.isForbiddenTarget(el(id)), true, id);
  }
  // ช่องที่อนุญาตแต่อยู่ใน dialog ⇒ ห้าม (dialog ของ editPage2 เป็นของคนทั้งหมด)
  assert.equal(L.isForbiddenTarget(el("editPage2_sendEmail", el("editPage2_checkEmailDialog"))), true);
  for (const id of [
    "editPage2_payBtn",
    "editPage2_backBtn",
    "editPage2_confirmReqEmailBtn",
    "editPage2_confirmCheckEmailBtn",
    "editPage2_declineCheckEmailBtn",
    "editPage2_consent",
    "editPage2_confirmRecallBtn",
    "editPage2_confirmDeclineBtn",
    "editPage2_backToAlertRecallBtn",
  ]) {
    assert.ok(L.FORBIDDEN_TARGETS.includes(id), id);
    assert.throws(() => L.safeClick(el("inner", el(id))), /ห้ามกด/, id);
  }
});

test("isAllowedEditPage2Id — ฐาน หรือ ฐาน + _ / :", () => {
  assert.equal(L.isAllowedEditPage2Id("editPage2_sendAddType"), true);
  assert.equal(L.isAllowedEditPage2Id("editPage2_sendAddType:3"), true);
  assert.equal(L.isAllowedEditPage2Id("editPage2_sendLocCode_sendLocCode_panel"), true);
  assert.equal(L.isAllowedEditPage2Id("editPage2_sendLocCodeProvince"), true);
  assert.equal(L.isAllowedEditPage2Id("editPage2_sendLocCodeZ"), false);
  assert.equal(L.isAllowedEditPage2Id("editPage2_payBtn"), false);
});
