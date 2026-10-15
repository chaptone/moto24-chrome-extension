// ตัวช่วยกรอกหน้าที่อยู่จัดส่ง (สเปก 2026-10-15 §7) — บริสุทธิ์ · ⛔ PUBLIC REPO ข้อมูลแต่งขึ้นทั้งหมด
const test = require("node:test");
const assert = require("node:assert/strict");

const L = require("../../scripts/dlt/lib.js");

const D = { kind: "branch", recipientName: "ผู้รับสมมุติ", addressLine: "1/1 หมู่ 1", subDistrict: "ตำบลสมมุติ", district: "อำเภอสมมุติ", province: "จังหวัดสมมุติ", postalCode: "10000", phone: "080-000-0000", email: null };

test("KEEP-IN-SYNC: ADDRESS_MAXLEN = DLT_ADDRESS_MAXLEN ของ moto24 · NOT_READY ตรงกัน", () => {
  assert.deepEqual({ ...L.ADDRESS_MAXLEN }, { recipientName: 60, addressLine: 20 });
  assert.equal(L.ADDRESS_NOT_READY, "not_ready");
});

test("dltPhoneDigits — เวกเตอร์ชุดเดียวกับ moto24 dlt-tax-types.test.ts", () => {
  const vectors = [["081-234-5678", "0812345678"], ["081 234 5678", "0812345678"], ["021234567", "021234567"], ["+66812345678", null], ["08123", null], ["", null], [null, null]];
  for (const [raw, want] of vectors) assert.equal(L.dltPhoneDigits(raw), want, String(raw));
});

test("planAddressFill — ขอบ 20/60 หลัง normText (ช่องว่างซ้อน/ท้ายไม่นับ)", () => {
  assert.deepEqual(L.planAddressFill({ ...D, addressLine: "1".repeat(20) }).addressLine, { key: "addressLine", value: "1".repeat(20) });
  assert.deepEqual(L.planAddressFill({ ...D, addressLine: "1".repeat(21) }).addressLine, { key: "addressLine", skip: "too_long", value: "1".repeat(21) });
  // เวกเตอร์เดียวกับ branch-address.test.ts ของ moto24 — 19 ตัวหลัง normalize ⇒ กรอก
  assert.deepEqual(L.planAddressFill({ ...D, addressLine: "  12/3   หมู่ 4  ถนนสาย1 " }).addressLine, { key: "addressLine", value: "12/3 หมู่ 4 ถนนสาย1" });
  assert.equal(L.planAddressFill({ ...D, recipientName: "ก".repeat(60) }).recipientName.value, "ก".repeat(60));
  assert.equal(L.planAddressFill({ ...D, recipientName: "ก".repeat(61) }).recipientName.skip, "too_long");
});

test("planAddressFill — ลำดับทอด จังหวัด→อำเภอ→ตำบล · เบอร์/อีเมล/รหัสไปรษณีย์", () => {
  const p = L.planAddressFill(D);
  assert.deepEqual(p.cascade.map((c) => c.key), ["province", "district", "subDistrict"]);
  assert.deepEqual(p.phone, { key: "phone", value: "0800000000" });
  assert.deepEqual(p.email, { key: "email", skip: "no_data", value: null });
  assert.deepEqual(p.postalCode, { key: "postalCode", value: "10000" });
  assert.deepEqual(L.planAddressFill({ ...D, phone: "+66800000000" }).phone, { key: "phone", skip: "invalid_phone", value: "+66800000000" });
  assert.deepEqual(L.planAddressFill({ ...D, phone: null }).phone, { key: "phone", skip: "no_data", value: null });
  assert.deepEqual(L.planAddressFill({ ...D, email: " a@b.co " }).email, { key: "email", value: "a@b.co" });
  assert.deepEqual(L.planAddressFill({ ...D, postalCode: "" }).postalCode, { key: "postalCode", skip: "no_data", value: null });
});

test("Review Focus 1 — textFillDecision: คนกรอกก่อน ⇒ ไม่เขียนทับ · แผนสั่งเว้น ⇒ เว้น · ว่าง ⇒ กรอก", () => {
  assert.deepEqual(L.textFillDecision("ชื่อที่คนพิมพ์", { key: "recipientName", value: "ผู้รับสมมุติ" }), { skip: "officer_filled", value: "ชื่อที่คนพิมพ์" });
  assert.deepEqual(L.textFillDecision("   ", { key: "recipientName", value: "ผู้รับสมมุติ" }), { fill: "ผู้รับสมมุติ" });
  assert.deepEqual(L.textFillDecision("", { key: "addressLine", skip: "too_long", value: "x" }), { skip: "too_long", value: "x" });
});

test("textFillDecision — ช่องมีค่าเท่ากับที่จะกรอก (หลัง normText) ⇒ นับว่ากรอกแล้ว ไม่เขียนซ้ำ ไม่ใช่ officer_filled", () => {
  assert.deepEqual(L.textFillDecision("ผู้รับสมมุติ", { key: "recipientName", value: "ผู้รับสมมุติ" }), { already: true, value: "ผู้รับสมมุติ" });
  assert.deepEqual(L.textFillDecision("  ผู้รับ   สมมุติ ", { key: "recipientName", value: "ผู้รับ สมมุติ" }), { already: true, value: "ผู้รับ สมมุติ" });
  // ค่าต่างกัน ⇒ ยังเป็นของคน ไม่เขียนทับ
  assert.deepEqual(L.textFillDecision("ผู้รับอื่น", { key: "recipientName", value: "ผู้รับสมมุติ" }), { skip: "officer_filled", value: "ผู้รับอื่น" });
});

test("cascadeFillDecision — ก่อนเลือกแต่ละช่องในทอด จังหวัด→อำเภอ→ตำบล", () => {
  const pv = { key: "province", value: "จังหวัดสมมุติ" };
  const empty = { shown: "", hidden: "" };
  assert.deepEqual(L.cascadeFillDecision(false, null, pv), { skip: "selector_missing", value: "จังหวัดสมมุติ", stop: true });
  assert.deepEqual(L.cascadeFillDecision(true, null, pv), { skip: "cascade_stopped", value: "จังหวัดสมมุติ" });
  assert.deepEqual(L.cascadeFillDecision(false, empty, pv), { select: "จังหวัดสมมุติ" });
  assert.deepEqual(L.cascadeFillDecision(true, empty, pv), { skip: "cascade_stopped", value: "จังหวัดสมมุติ" });
  // รันซ้ำ / คนเลือกค่าเดียวกันไว้แล้ว ⇒ นับว่ากรอกแล้ว
  assert.deepEqual(L.cascadeFillDecision(false, { shown: " จังหวัดสมมุติ ", hidden: "จังหวัดสมมุติ" }, pv), { already: true, value: "จังหวัดสมมุติ" });
  // พิมพ์ค้างไม่ได้เลือกจากรายการ (hidden ว่าง) ⇒ ของคน ไม่นับ
  assert.deepEqual(L.cascadeFillDecision(false, { shown: "จังหวัดสมมุติ", hidden: "" }, pv), { skip: "officer_filled", value: "จังหวัดสมมุติ", stop: true });
  // คนเลือกค่าอื่นไว้ ⇒ ไม่แตะ และช่องลูกถัดไปไม่เลือกต่อ (ค่าของเราเป็นของจังหวัดอื่น)
  assert.deepEqual(L.cascadeFillDecision(false, { shown: "จังหวัดอื่น", hidden: "จังหวัดอื่น" }, pv), { skip: "officer_filled", value: "จังหวัดอื่น", stop: true });
  // ช่องที่คนกรอกไว้แล้ว รายงาน officer_filled แม้ทอดจะหยุดแล้ว
  assert.deepEqual(L.cascadeFillDecision(true, { shown: "จังหวัดอื่น", hidden: "x" }, pv), { skip: "officer_filled", value: "จังหวัดอื่น", stop: true });
  assert.deepEqual(L.cascadeFillDecision(false, empty, { key: "district", value: "" }), { skip: "no_data", value: null, stop: true });
});

test("cascadeResultDecision — เลือกติด ⇒ filled · ไม่ติด ⇒ เหตุจากการเลือก + ค่าที่ลอง แล้วหยุดทอด", () => {
  const sd = { key: "subDistrict", value: "ตำบลสมมุติ" };
  assert.deepEqual(L.cascadeResultDecision({ ok: true, value: "ตำบลสมมุติ", hidden: "ตำบลสมมุติ" }, sd), { filled: true });
  // บอทพิมพ์ข้อความลง _input/_hinput ไปแล้ว ⇒ ต้องคืนช่องให้ว่าง (final review I-1) — ช่องที่เลือกไม่ติดต้อง *ดู* ว่าง
  assert.deepEqual(L.cascadeResultDecision({ ok: false, reason: "option_missing", value: "ตำบลสมมุติ" }, sd), { skip: "option_missing", value: "ตำบลสมมุติ", stop: true, clear: true });
  assert.deepEqual(L.cascadeResultDecision({ ok: false, reason: "value_mismatch", value: "" }, sd), { skip: "value_mismatch", value: "ตำบลสมมุติ", stop: true, clear: true });
  // ไม่ได้แตะช่อง (หา widget ไม่เจอ / ไม่มีค่า) ⇒ ไม่มีอะไรให้คืน
  assert.deepEqual(L.cascadeResultDecision({ ok: false, reason: "selector_missing" }, sd), { skip: "selector_missing", value: "ตำบลสมมุติ", stop: true });
  assert.deepEqual(L.cascadeResultDecision({ ok: false, reason: "no_data" }, sd), { skip: "no_data", value: "ตำบลสมมุติ", stop: true });
});

test("final review I-1 — cascadeIncomplete: ทอดมีช่องที่บอทเลือกไม่ติด (ไม่ใช่ของคน) ⇒ true", () => {
  assert.equal(L.cascadeIncomplete([]), false);
  assert.equal(L.cascadeIncomplete(undefined), false);
  assert.equal(L.cascadeIncomplete([{ field: "subDistrict", reason: "option_missing", value: "x" }]), true);
  assert.equal(L.cascadeIncomplete([{ field: "district", reason: "value_mismatch", value: "x" }, { field: "subDistrict", reason: "cascade_stopped", value: "x" }]), true);
  // คนเลือกจังหวัดอื่นไว้ ⇒ อำเภอ/ตำบลของเราเลือกต่อไม่ได้ (cascade_stopped) ⇒ ทอดไม่ครบ
  assert.equal(L.cascadeIncomplete([{ field: "province", reason: "officer_filled", value: "x" }, { field: "district", reason: "cascade_stopped", value: "x" }]), true);
  // คนเลือกครบทั้งสามช่องเอง ⇒ ทอดครบ (ของคน)
  assert.equal(L.cascadeIncomplete(["province", "district", "subDistrict"].map((field) => ({ field, reason: "officer_filled", value: "x" }))), false);
  // ช่องนอกทอดไม่นับ
  assert.equal(L.cascadeIncomplete([{ field: "addressLine", reason: "too_long", value: "x" }]), false);
});

test("final review I-1 — zipFillDecision: ทอดเลือกไม่ครบ ⇒ ไม่เติมรหัสไปรษณีย์ของเรา (cascade_stopped)", () => {
  const z = { key: "postalCode", value: "10000" };
  assert.deepEqual(L.zipFillDecision("", false, z, true), { skip: "cascade_stopped", value: "10000" });
  // ช่องมีค่าอยู่แล้ว (ของคน) ⇒ กติกาช่องข้อความปกติ ไม่เขียนทับ
  assert.deepEqual(L.zipFillDecision("10001", false, z, true), { skip: "officer_filled", value: "10001" });
  // ระบบไม่มีรหัสไปรษณีย์ ⇒ เหตุเดิม no_data
  assert.deepEqual(L.zipFillDecision("", false, { key: "postalCode", skip: "no_data", value: null }, true), { skip: "no_data", value: null });
  // ทอดครบ (ไม่ส่ง / false) ⇒ พฤติกรรมเดิม
  assert.deepEqual(L.zipFillDecision("", true, z, false), { fill: "10000" });
});

test("zipFillDecision — กรมเติมหลังเลือกตำบล ⇒ ใช้ของกรม (+ note ถ้าไม่ตรง) · ไม่เติม ⇒ ใส่ของเรา", () => {
  const z = { key: "postalCode", value: "10000" };
  assert.deepEqual(L.zipFillDecision("10001", true, z), { dlt: "10001", note: "zip_differs:10000" });
  assert.deepEqual(L.zipFillDecision("10000", true, z), { dlt: "10000", note: null });
  assert.deepEqual(L.zipFillDecision("", true, z), { fill: "10000" });
  assert.deepEqual(L.zipFillDecision("10001", true, { key: "postalCode", skip: "no_data", value: null }), { dlt: "10001", note: null });
  // ตำบลไม่ได้มาจากเรา ⇒ ค่าในช่องไม่ใช่ของกรมที่ตอบตำบลของเรา ⇒ กติกาช่องข้อความปกติ
  assert.deepEqual(L.zipFillDecision("10001", false, z), { skip: "officer_filled", value: "10001" });
  assert.deepEqual(L.zipFillDecision("10000", false, z), { already: true, value: "10000" });
  assert.deepEqual(L.zipFillDecision("", false, z), { fill: "10000" });
});

test("addressDialogStop — dialog ของกรมโผล่ ⇒ ช่องที่เหลือ dialog_open + note dlt_dialog (Ruling R9) · ไม่มี ⇒ null", () => {
  assert.equal(L.addressDialogStop([], ["phone"]), null);
  const stop = L.addressDialogStop(["editPage2_reqEmailDialog"], ["phone", "email"]);
  assert.deepEqual(stop, {
    note: "dlt_dialog:editPage2_reqEmailDialog",
    skipped: [{ field: "phone", reason: "dialog_open", value: null }, { field: "email", reason: "dialog_open", value: null }],
  });
  assert.equal(L.addressStatusOf(stop.skipped), "partial");
  // ไม่มีช่องเหลือแล้วก็ยังจด note
  assert.deepEqual(L.addressDialogStop(["editPage2_a", "editPage2_b"], []), { note: "dlt_dialog:editPage2_a,editPage2_b", skipped: [] });
});

test("Review Focus 1 — addressRadioDecision (Ruling R4)", () => {
  assert.equal(L.addressRadioDecision(null, true), "click_other");
  assert.equal(L.addressRadioDecision("5", true), "already_other");
  for (const v of ["1", "2", "4"]) assert.equal(L.addressRadioDecision(v, true), "officer_chose_other");
  assert.equal(L.addressRadioDecision(null, false), "page_changed");
  assert.equal(L.ADDRESS_OTHER_VALUE, "5");
});

test("zipDiffNote — กรมเติมไม่ตรงของเรา ⇒ note · ตรง/ไม่มี ⇒ null", () => {
  assert.equal(L.zipDiffNote("10001", "10000"), "zip_differs:10000");
  assert.equal(L.zipDiffNote("10000", "10000"), null);
  assert.equal(L.zipDiffNote("", "10000"), null);
});

test("addressStatusOf — no_data (เบอร์/อีเมลที่ระบบไม่มี) ไม่นับ (Ruling R3)", () => {
  assert.equal(L.addressStatusOf([]), "filled");
  assert.equal(L.addressStatusOf([{ field: "email", reason: "no_data", value: null }, { field: "phone", reason: "no_data", value: null }]), "filled");
  assert.equal(L.addressStatusOf([{ field: "phone", reason: "invalid_phone", value: "x" }]), "partial");
  assert.equal(L.addressStatusOf([{ field: "recipientName", reason: "officer_filled", value: "x" }]), "partial");
});

test("describeAddressSkips / addressNotReachedText — ข้อความแบนเนอร์ (ไม่มีค่าของลูกค้าในข้อความ)", () => {
  const lines = L.describeAddressSkips({ skipped: [
    { field: "addressLine", reason: "too_long", value: "ค่าลับ" },
    { field: "recipientName", reason: "officer_filled", value: "ค่าลับ" },
    { field: "email", reason: "no_data", value: null },
    { field: "phone", reason: "no_data", value: null },
  ] });
  assert.deepEqual(lines, [
    "เลขที่บ้าน: ยาวเกินช่องของกรม 20 ตัว — กรอกเอง",
    "ชื่อ: มีค่าอยู่แล้ว บอทไม่เขียนทับ — ตรวจเอง",
    "E-mail: ระบบไม่มีข้อมูล — กรอกเอง",
    // เบอร์ไม่บังคับบนหน้ากรม · ตรงกับการ์ด moto24 "ไม่มีเบอร์ — เว้นว่าง"
    "เบอร์โทรศัพท์ติดต่อ: ระบบไม่มีเบอร์ — เว้นว่างได้",
  ]);
  assert.ok(lines.every((l) => !l.includes("ค่าลับ")));
  assert.match(L.addressNotReachedText("superseded"), /moto24/);
  assert.match(L.addressNotReachedText("something_new"), /กรอก/);
});

test("Fix round 1 (M-1) — addressStatusOf: มี note dlt_dialog ⇒ partial แม้ไม่มีช่องที่เว้น (R9)", () => {
  assert.equal(L.addressStatusOf([], ["dlt_dialog:editPage2_reqEmailDialog"]), "partial");
  assert.equal(L.addressStatusOf([], ["zip_differs:10000"]), "filled");
  assert.equal(L.addressStatusOf([], undefined), "filled");
});
