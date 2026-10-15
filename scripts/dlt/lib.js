// scripts/dlt/lib.js — helper ของ flow "ต่อภาษีออนไลน์" (eservice.dlt.go.th)
//
// ใช้ได้ 3 ที่โดยไม่แก้โค้ด:
//   • MAIN world ของหน้ากรม — service worker inject เป็น *ไฟล์* แล้วเรียกผ่าน window.__moto24Dlt
//   • service worker — importScripts แล้วเรียกผ่าน self.__moto24Dlt
//   • node --test — require() ได้ module.exports
//
// 🔒 safeClick / setInputValue คือ "ตัวเดียว" ที่ยิงคลิก/event ใส่หน้ากรม — steps.js ถูกสแกนว่าไม่ยิงเอง
//    (test/dlt/steps-scan.test.js) · บอทกรอก คนกดยืนยัน: รายการปุ่มที่ห้ามกดอยู่ใน FORBIDDEN_TARGETS
// ⛔ PUBLIC REPO: ห้ามมีชื่อบริษัท ชื่อลูกค้า ทะเบียนรถจริง ในไฟล์นี้และในเทสต์ (ชื่อบริษัทมากับ payload)
//
// สัญญากับ moto24: lib/renewal-tracking/dlt-tax-types.ts — KEEP-IN-SYNC: version · resultVersion · LIMITS ·
//   ADDRESS_MAXLEN · normText (= dltFieldText) · dltPhoneDigits · ADDRESS_NOT_READY
// @typedef {{ kind: "branch"|"home", recipientName: string, addressLine: string, subDistrict: string,
//   district: string, province: string, postalCode: string, phone: string|null, email: string|null }
//   | { kind: "none", reason: "no_branch_address"|"no_home_address" }} DltDelivery
// @typedef {{ version: 1|2, runId: string, display: { customer: string, plate: string },
//   vehicleTypeLabel: string, provinceLabel: string|null, plate1: string, plate2: string,
//   ownerNames: { value: string, source: "company"|"customer" }[], mileage: string|null,
//   ours: { expiryDate: string|null, jobType: string }, delivery?: DltDelivery }} DltTaxPayload
//   (delivery มีเฉพาะ version 2 — สเปก 2026-10-15 §6.1 · v1 = moto24 ก่อน 0.12 ยังรับ ทำงานแบบเดิม)

(function (root) {
  "use strict";

  const URLS = {
    register: "https://eservice.dlt.go.th/esvapp/esv/ebk/esv02i001/index.jsf",
  };

  /** ต้องเท่ากับ DLT_RESULT_LIMITS ของ moto24 — ข้อความยาวกว่านี้ถูกตัดก่อนส่ง */
  const LIMITS = Object.freeze({ text: 2000, short: 200, dltMessages: 50, timeline: 200, nameAttempts: 20, fieldList: 50 });

  /** ปุ่ม/ช่องที่บอทห้ามกดหรือแตะ (spec §6.7 + สเปก 2026-10-15 §7) — ตรวจทั้งตัวมันและบรรพบุรุษ */
  const FORBIDDEN_TARGETS = Object.freeze([
    "info_submitBtn", // ยอมรับข้อตกลง
    "info_checkEmailAgreementBtn", // ตกลง ของ dialog แจ้งอีเมล
    "info_backBtn", // ปฏิเสธข้อตกลง
    "editPage1_edit2Btn", // กรอกสถานที่จัดส่งเอกสาร (⚠️ ไม่ใช่ edit1Btn) — คนกดไปหน้าที่อยู่เอง
    "editPage1_alertFoundOicBtn", // ตกลง ของ dialog ผล พ.ร.บ.
    "editPage1_policyFlag", // radio พ.ร.บ. ทั้งกลุ่ม (ค่า 4/5 = ซื้อ = เงิน)
    "editPage1_baceBtn", // ย้อนกลับ
    "search_srsRegistrantRemoveListTableBtn", // ยกเลิกลงทะเบียนรถ
    "result_confirmRemoveListBtn", // ยืนยันยกเลิกลงทะเบียน
    "editPage2_payBtn", // เลือกวิธีการชำระเงิน
    "editPage2_backBtn", // ย้อนกลับ
    "editPage2_confirmReqEmailBtn",
    "editPage2_confirmCheckEmailBtn", // ยืนยัน e-mail รับใบเสร็จ
    "editPage2_declineCheckEmailBtn", // ตรวจสอบข้อมูล
    "editPage2_consent", // radio ยินยอม (dialog recall)
    "editPage2_confirmRecallBtn",
    "editPage2_confirmDeclineBtn",
    "editPage2_backToAlertRecallBtn",
  ]);
  /** หน้าที่อยู่จัดส่ง (editPage2_) — **allowlist** (สเปก 2026-10-15 §7): แตะได้เฉพาะช่องเหล่านี้
   *  id ของช่อง = ฐาน หรือ ฐาน + "_…"/":…" (input/hinput/panel ของ autocomplete · radio รายตัว)
   *  ทุกอย่างอื่นที่ขึ้นต้น editPage2_ ห้าม · ทุกอย่างใน dialog (`editPage2_…Dialog`) ห้ามแม้ id อยู่ใน allowlist */
  const EDITPAGE2_PREFIX = "editPage2_";
  const EDITPAGE2_ALLOWED_BASES = Object.freeze([
    "editPage2_sendAddType", // radio ที่อยู่ — บอทเลือกได้เฉพาะ 5 อื่นๆ (steps.js)
    "editPage2_sendFname", // ชื่อ
    "editPage2_addrNo", // เลขที่บ้าน
    "editPage2_sendLocCodeProvince", // จังหวัด
    "editPage2_sendLocCodeAmphur", // เขต/อำเภอ
    "editPage2_sendLocCode", // แขวง/ตำบล
    "editPage2_sendZipCode", // รหัสไปรษณีย์
    "editPage2_sendPhoneNo", // เบอร์โทรศัพท์ติดต่อ
    "editPage2_sendEmail", // E-mail
  ]);

  function isAllowedEditPage2Id(id) {
    return EDITPAGE2_ALLOWED_BASES.some((b) => id === b || id.startsWith(b + "_") || id.startsWith(b + ":"));
  }

  const OUTCOME_TEXT = Object.freeze({
    ready_to_submit: "ถึงหน้ายื่นภาษีแล้ว",
    prb_not_found: "กรมไม่พบ พ.ร.บ.",
    dlt_blocked: "กรมไม่ให้ยื่น",
    name_rejected: "ชื่อไม่ผ่าน",
    unexpected_page: "บอทหลงหน้า",
    aborted: "ปิดแท็บกลางทาง",
    superseded: "ถูกแทนที่ด้วยรอบใหม่",
    timeout: "ไม่มีความเคลื่อนไหว 30 นาที",
    bot_error: "บอทขัดข้อง",
  });
  const OUTCOMES = Object.freeze(Object.keys(OUTCOME_TEXT));

  function normText(s) {
    return String(s == null ? "" : s).normalize("NFC").replace(/\s+/g, " ").trim();
  }

  function clip(s, max) {
    const t = String(s == null ? "" : s);
    return t.length > max ? t.slice(0, max) : t;
  }

  function describe(el) {
    return (el && (el.id || el.tagName)) || "?";
  }

  /** ห้ามถ้า: (1) ตัวมันหรือบรรพบุรุษอยู่ใน FORBIDDEN_TARGETS · (2) อยู่ใน dialog ของ editPage2 ·
   *  (3) id ใกล้สุดที่ขึ้นต้น editPage2_ ไม่อยู่ใน allowlist (container ไกลกว่านั้น เช่น editActAdd3Grid ไม่นับ) */
  function isForbiddenTarget(el) {
    let node = el;
    let nearestPage2 = null;
    for (let depth = 0; node && depth < 40; depth++) {
      const id = typeof node.id === "string" ? node.id : "";
      if (id) {
        if (FORBIDDEN_TARGETS.includes(id)) return true;
        if (id.startsWith(EDITPAGE2_PREFIX)) {
          if (/Dialog$/.test(id)) return true;
          if (nearestPage2 === null) nearestPage2 = id;
        }
      }
      node = node.parentElement;
    }
    return nearestPage2 !== null && !isAllowedEditPage2Id(nearestPage2);
  }

  /** คลิกที่มีด่าน — ของต้องห้าม ⇒ throw (ขั้นที่เรียกจับแล้วจบรอบ bot_error + แบนเนอร์ ไม่เดินต่อเงียบ ๆ) */
  function safeClick(el, opts) {
    if (!el) throw new Error("safeClick: ไม่พบ element");
    if (isForbiddenTarget(el)) throw new Error("safeClick: บอทห้ามกด " + describe(el));
    if (opts && opts.jquery) {
      const jq = root.jQuery;
      if (typeof jq !== "function") throw new Error("safeClick: ไม่มี jQuery บนหน้า");
      jq(el).trigger("click");
    } else {
      el.click();
    }
    return true;
  }

  /** ตั้งค่าช่องข้อความ + ยิง input/change (input mask ของ add_plate1 รับได้ — Gotcha 4) */
  function setInputValue(el, value) {
    if (!el) throw new Error("setInputValue: ไม่พบช่อง");
    if (isForbiddenTarget(el)) throw new Error("setInputValue: บอทห้ามแตะ " + describe(el));
    el.value = value;
    const Ev = root.Event;
    el.dispatchEvent(new Ev("input", { bubbles: true }));
    el.dispatchEvent(new Ev("change", { bubbles: true }));
    // เหมือนคนออกจากช่อง — add_plate2 ของกรมค้นรถใน onblur (PrimeFaces.ab e:'blur');
    // ไม่ blur ⇒ server ไม่เคยค้น ⇒ บันทึกได้ "ไม่พบข้อมูลรถ…" ทุกคัน (QA 2026-09-23) · ผู้เรียกต้องรอ AJAX ว่างเอง
    el.dispatchEvent(new Ev("blur"));
    return String(el.value);
  }

  /** ข้อความใน #cdgsmessagedlg ของ esv02i001 — ไม่รู้จัก ⇒ unknown (ห้ามเดาความหมาย) */
  function classifyDltMessage(text) {
    const t = normText(text);
    if (!t) return "unknown";
    // "ยกเลิกการลงทะเบียนรถเรียบร้อยแล้ว" มีคำว่า "ลงทะเบียนรถเรียบร้อยแล้ว" อยู่ข้างใน
    if (t.includes("ยกเลิกการลงทะเบียนรถ")) return "unknown";
    if (t.includes("ลงทะเบียนรถเรียบร้อยแล้ว")) return "registered";
    if (t.includes("ผู้ครอบครองหรือผู้ถือกรรมสิทธิ์ไม่ถูกต้อง")) return "owner_mismatch";
    if (t.includes("ต้องไม่เป็นค่าว่าง")) return "field_empty";
    return "unknown";
  }

  /** readMessageDialog() คืน "" เมื่อ dialog มองเห็นอยู่แต่เนื้อความว่าง (กรมยังไม่ตอบ) —
   *  ต่างจาก null (ไม่มี dialog เลย) ห้ามจำแนกเป็น unknown/dlt_blocked ต้องรอต่อ (review fix) */
  function isBlankDialogText(text) {
    return typeof text === "string" && normText(text) === "";
  }

  /** ตาราง #result_table มีมากกว่า 1 หน้าไหม จากข้อมูล paginator ที่ steps.js อ่านจาก DOM
   *  อ่านอย่างเดียว ไม่ auto-page (review fix — reduced scope: แค่เตือน ไม่ไปคลิกเอง) */
  function hasMorePages(info) {
    if (!info) return false;
    if (Number(info.pageLinkCount) > 1) return true;
    return info.nextDisabled === false;
  }

  function emptyFieldsFromMessage(text) {
    const out = [];
    for (const raw of String(text == null ? "" : text).split(/\n+/)) {
      const line = normText(raw);
      if (!line.includes("ต้องไม่เป็นค่าว่าง")) continue;
      const label = normText(line.split(":")[0]);
      let key;
      if (label.startsWith("ประเภทรถ")) key = "vehicleType";
      else if (label.includes("จังหวัด")) key = "province";
      else if (label.includes("ชื่อ")) key = "ownerName";
      else if (label.includes("หมวด") || label.includes("ทะเบียน")) key = "plate";
      else key = "unknown:" + label;
      if (!out.includes(key)) out.push(key);
    }
    return out;
  }

  const TH_MONTHS = { "ม.ค.": 1, "ก.พ.": 2, "มี.ค.": 3, "เม.ย.": 4, "พ.ค.": 5, "มิ.ย.": 6, "ก.ค.": 7, "ส.ค.": 8, "ก.ย.": 9, "ต.ค.": 10, "พ.ย.": 11, "ธ.ค.": 12 };
  const TH_DATE_RE = /(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{4})/;

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /** "08 ก.ย. 2570" → { raw, iso: "2027-09-08" } · วันไม่มีจริง ⇒ iso null · ไม่เจอ ⇒ null */
  function parseThaiDate(text) {
    const m = TH_DATE_RE.exec(String(text == null ? "" : text));
    if (!m) return null;
    const day = Number(m[1]);
    const month = TH_MONTHS[m[2]];
    const be = Number(m[3]);
    const year = be > 2400 ? be - 543 : be;
    const d = new Date(Date.UTC(year, month - 1, day));
    const valid = d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
    return { raw: m[0], iso: valid ? year + "-" + pad2(month) + "-" + pad2(day) : null };
  }

  function plateKey(s) {
    return normText(s).replace(/[\s-]/g, "");
  }

  /** แถวของรถคันนี้ในตาราง #result_table — ต้องตรงทั้งเลขทะเบียนและจังหวัด (จังหวัดว่าง ⇒ พิสูจน์ไม่ได้ ⇒ null) */
  function findListedRow(table, target) {
    if (!table || !target || !target.province) return null;
    const col = (name) => table.headers.findIndex((h) => normText(h).includes(name));
    const plateCol = col("เลขทะเบียน");
    const provinceCol = col("จังหวัด");
    const ownerCol = col("ชื่อเจ้าของ");
    if (plateCol < 0 || provinceCol < 0) return null;
    const want = plateKey(String(target.plate1) + String(target.plate2));
    const wantProvince = normText(target.province);
    for (let i = 0; i < table.rows.length; i++) {
      const r = table.rows[i];
      if (plateKey(r[plateCol]) === want && normText(r[provinceCol]) === wantProvince) {
        return { index: i, ownerName: ownerCol >= 0 ? normText(r[ownerCol]) || null : null };
      }
    }
    return null;
  }

  /** ข้อความ "บันทึก" ตอบกลับที่ไหน — ปกติ #cdgsmessagedlg แต่ลงทะเบียนซ้ำเปิด dialog แยก
   *  ขึ้นต้น `alertExist…` (Gotcha 5) ⇒ ให้ id ของ dialog ที่ *กำลังแสดงอยู่* ที่ควรอ่าน จากรายการ id
   *  ที่มองเห็นตอนนี้ (visibleIds ต้องกรอง visibility มาก่อนแล้ว — ฟังก์ชันนี้ไม่แตะ DOM) */
  function pickMessageDialogId(visibleIds) {
    const ids = Array.isArray(visibleIds) ? visibleIds : [];
    if (ids.includes("cdgsmessagedlg")) return "cdgsmessagedlg";
    const dup = ids.find((id) => typeof id === "string" && id.indexOf("alertExist") === 0);
    return dup || null;
  }

  const OIC_OK_DIALOG = "editPage1_alertFoundOicDialog";
  const OIC_NOT_FOUND_DIALOG = "editPage1_alertFoundNotOicDialog";

  /** ผล พ.ร.บ. บน esv02i002 จาก id ของ dialog ที่มองเห็น + radio (spike S6: ผ่านด่านก็มี dialog) */
  function classifyTaxFormDialogs(visibleIds, flags) {
    const ids = Array.isArray(visibleIds) ? visibleIds : [];
    const enabled = (flags && flags.enabled) || {};
    const selected = flags ? flags.selected : null;
    if (ids.includes(OIC_NOT_FOUND_DIALOG)) return "prb_not_found";
    if (enabled["1"] === false && enabled["6"] === false) return "prb_not_found";
    if (ids.some((id) => id !== OIC_OK_DIALOG)) return "dlt_blocked";
    if (ids.includes(OIC_OK_DIALOG)) return selected === "6" ? "prb_ok" : "dlt_blocked";
    return selected === "6" ? "prb_ok" : "unknown";
  }

  /** ตาราง #editPage1_editDetailGrid — ช่องค่าไม่มี id อ่านเป็นคู่ หัวข้อ→ค่า */
  function pickDetailValues(cellTexts) {
    const clean = (cellTexts || []).map((t) => normText(t).replace(/\s*:\s*$/, ""));
    const out = {};
    for (let i = 0; i < clean.length - 1; i++) {
      if (clean[i] === "วันสิ้นอายุภาษี" && out.taxExpiry == null) out.taxExpiry = clean[i + 1];
      if (clean[i] === "วันสิ้นอายุภาษีครั้งต่อไป" && out.nextTaxExpiry == null) out.nextTaxExpiry = clean[i + 1];
    }
    return out;
  }

  /** เลขเวอร์ชันเว็บกรมท้ายหน้า (เช่น 2.1.0002) — ไว้ไล่ว่าพังตั้งแต่เวอร์ชันไหน */
  function findSiteVersion(text) {
    const s = String(text == null ? "" : text);
    const labelled = /(?:เวอร์ชั่น|เวอร์ชัน|version)\s*:?\s*(\d+\.\d+\.\d+)/i.exec(s);
    if (labelled) return labelled[1];
    const bare = s.match(/\b\d+\.\d+\.\d{4}\b/g);
    return bare ? bare[bare.length - 1] : null;
  }

  // ── service worker: จำแนกหน้า + state ของรอบ (reducer บริสุทธิ์ — orchestrator.js เป็นแค่ I/O) ──

  function classifyDltUrl(url) {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return "ignore";
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return "ignore";
    if (u.hostname !== "eservice.dlt.go.th") return "external_login"; // หน้า Digital ID (connect.egov.go.th ฯลฯ)
    const p = u.pathname;
    if (p === "/esvapp/login.jsf") return "login";
    if (p === "/esvapp/index.jsf") return "index";
    if (p.startsWith("/esvapp/esv/ebk/esv02i001/")) return "register";
    if (p.startsWith("/esvapp/esv/ebk/taxAgreement/")) return "agreement";
    if (p.startsWith("/esvapp/esv/ebk/esv02i002/")) return "tax_form";
    return "unexpected";
  }

  const PHASE_BY_KIND = Object.freeze({
    external_login: "waiting_login",
    login: "waiting_login",
    index: "navigating",
    register: "registering",
    agreement: "waiting_accept",
    tax_form: "reading_tax_form",
  });

  /** ชื่อขั้นใน steps.js ที่ถูกเรียกเมื่อหน้าแต่ละชนิดโหลดเสร็จ */
  const STEP_BY_KIND = Object.freeze({
    login: "onLoginPage",
    register: "runRegister",
    agreement: "onAgreementPage",
    tax_form: "runTaxForm",
  });

  const DELIVERY_TEXT_FIELDS = ["recipientName", "addressLine", "subDistrict", "district", "province", "postalCode"];

  /** delivery ของ payload v2 (สเปก 2026-10-15 §6.1) */
  function validateDelivery(d) {
    if (!d || typeof d !== "object") return "ไม่มีข้อมูลที่อยู่จัดส่ง (delivery)";
    if (d.kind === "none") {
      return d.reason === "no_branch_address" || d.reason === "no_home_address" ? null : "delivery.reason ไม่ถูกต้อง";
    }
    if (d.kind !== "branch" && d.kind !== "home") return "delivery.kind ไม่ถูกต้อง";
    for (const k of DELIVERY_TEXT_FIELDS) {
      if (typeof d[k] !== "string" || !d[k].trim()) return "ที่อยู่จัดส่งไม่ครบ (" + k + ")";
    }
    for (const k of ["phone", "email"]) {
      if (d[k] !== null && typeof d[k] !== "string") return "ที่อยู่จัดส่งไม่ถูกต้อง (" + k + ")";
    }
    return null;
  }

  /** ตรวจ payload จาก moto24 ซ้ำฝั่ง extension — 🔒 ชื่อ 1–2 ชื่อ (spec D2) */
  function validatePayload(p) {
    if (!p || typeof p !== "object") return "payload ว่าง";
    if (p.version !== 1 && p.version !== 2) return "payload version ไม่รองรับ (ต้องเป็น 1 หรือ 2) — อัปเดต extension หรือ moto24";
    if (typeof p.runId !== "string" || !p.runId || p.runId.length > 64) return "ไม่มี runId";
    if (typeof p.plate1 !== "string" || !p.plate1 || typeof p.plate2 !== "string" || !/^\d{1,4}$/.test(p.plate2)) return "ทะเบียนไม่ครบ";
    if (typeof p.vehicleTypeLabel !== "string" || !p.vehicleTypeLabel) return "ไม่มีประเภทรถ";
    if (p.provinceLabel !== null && typeof p.provinceLabel !== "string") return "จังหวัดไม่ถูกต้อง";
    if (!Array.isArray(p.ownerNames) || p.ownerNames.length < 1 || p.ownerNames.length > 2) return "ต้องมีชื่อผู้ถือกรรมสิทธิ์ 1–2 ชื่อ";
    for (const n of p.ownerNames) {
      if (!n || typeof n.value !== "string" || !n.value.trim() || (n.source !== "company" && n.source !== "customer")) {
        return "ชื่อผู้ถือกรรมสิทธิ์ไม่ถูกต้อง";
      }
    }
    if (!p.display || typeof p.display.plate !== "string" || typeof p.display.customer !== "string") return "ไม่มีข้อมูลหัวแบนเนอร์";
    if (p.version === 2) {
      const bad = validateDelivery(p.delivery);
      if (bad) return bad;
    }
    return null;
  }

  // ── ส่วนที่อยู่ของ result v2 (สเปก 2026-10-15 §6.2–6.3) ──────────────────────────────────

  /** address.reason ของรอบที่ไม่เคยถึงหน้ายื่นภาษี · 🔒 KEEP-IN-SYNC: DLT_ADDRESS_NOT_READY ของ moto24 */
  const ADDRESS_NOT_READY = "not_ready";
  const ADDRESS_STATUSES = Object.freeze(["filled", "partial", "not_reached", "skipped"]);
  /** phase จากหน้าที่แปลว่ารอบผ่าน prb_ok แล้ว (I4 — ห้ามพึ่ง ready_reached ตัวเดียว: relay ยิงแล้วลืมอาจหล่น) */
  const PAST_READY_PHASES = Object.freeze(["waiting_address", "filling_address"]);
  /** outcome ที่ SW/หน้าขอปิดรอบ → address.reason เมื่อรอบไปถึงหน้ายื่นภาษีแล้ว */
  const NOT_REACHED_REASON = Object.freeze({
    aborted: "aborted",
    superseded: "superseded",
    timeout: "timeout",
    unexpected_page: "page_changed",
    bot_error: "bot_error",
    prb_not_found: "page_changed",
    dlt_blocked: "page_changed",
    name_rejected: "page_changed",
  });

  function emptyAddress(status, reason) {
    return { status, reason: reason == null ? null : reason, filled: [], skipped: [], dltZip: null, notes: [] };
  }

  /** address จากหน้า — status ไม่รู้จัก ⇒ null (ทิ้ง) · ตัดตาม LIMITS */
  function sanitizeAddress(a) {
    if (!a || typeof a !== "object" || !ADDRESS_STATUSES.includes(a.status)) return null;
    const arr = (x) => (Array.isArray(x) ? x : []);
    return {
      status: a.status,
      reason: a.reason == null ? null : clip(a.reason, LIMITS.short),
      filled: arr(a.filled).slice(0, LIMITS.fieldList).map((f) => clip(f, LIMITS.short)),
      skipped: arr(a.skipped)
        .filter((s) => s && typeof s.field === "string")
        .slice(0, LIMITS.fieldList)
        .map((s) => ({ field: clip(s.field, LIMITS.short), reason: clip(s.reason, LIMITS.short), value: s.value == null ? null : clip(s.value, LIMITS.text) })),
      dltZip: a.dltZip == null || a.dltZip === "" ? null : clip(a.dltZip, LIMITS.short),
      notes: arr(a.notes).slice(0, LIMITS.fieldList).map((n) => clip(n, LIMITS.text)),
    };
  }

  /** 🔒 กติกาเหล็ก (สเปก 2026-10-15 §6.3 · Ruling R8): รอบ v2 ที่ไปถึงหน้ายื่นภาษีแล้ว (reachedReady)
   *  จบด้วยอะไรก็ตาม ⇒ outcome ready_to_submit · เหตุที่รอบจบไปอยู่ที่ address.reason
   *  ทุกทางที่ปิดรอบ (หน้าเอง · dltOnTabRemoved · supersede ใน handleDltExternalMessage · dltSweep ·
   *  unexpected_page · dltFailCurrent) เข้ามาที่ applyDltEvent(final) ⇒ บังคับที่นี่ที่เดียว
   *  คืน { outcome, address (undefined = payload v1), error (เฉพาะ outcome bot_error จริง) } */
  function settleFinal(run, outcome, error) {
    if (!run.payload || run.payload.version !== 2) return { outcome, address: undefined, error };
    if (!run.reachedReady) return { outcome, address: emptyAddress("not_reached", ADDRESS_NOT_READY), error };
    const fallbackReason = outcome === "ready_to_submit" ? "no_report" : NOT_REACHED_REASON[outcome] || outcome;
    const address = JSON.parse(JSON.stringify(run.address || emptyAddress("not_reached", fallbackReason)));
    // R7: ถึงหน้ายื่นภาษีแล้ว address ห้ามเป็น not_reached/not_ready (หน้ารายงานผิดก็ไม่ให้ขัดสัญญา)
    if (address.status === "not_reached" && address.reason === ADDRESS_NOT_READY) address.reason = fallbackReason;
    if (outcome === "bot_error" && error && address.notes.length < LIMITS.fieldList) {
      address.notes.push(clip("bot_error: " + error, LIMITS.text));
    }
    return { outcome: "ready_to_submit", address, error: undefined };
  }

  // ── แผนกรอกหน้าที่อยู่ (editPage2) — บริสุทธิ์ · steps.js ทำตามทีละช่อง (สเปก 2026-10-15 §7 ข้อ 3) ──

  /** maxlength ของกรม (วัด 2026-10-15) · 🔒 KEEP-IN-SYNC: DLT_ADDRESS_MAXLEN ใน moto24 dlt-tax-types.ts */
  const ADDRESS_MAXLEN = Object.freeze({ recipientName: 60, addressLine: 20 });
  /** value ของ radio "อื่นๆ" ใน editPage2_sendAddType (1 สมาชิก · 2 จัดส่งเอกสาร · 4 ล่าสุด · 5 อื่นๆ — วัด 2026-10-15) */
  const ADDRESS_OTHER_VALUE = "5";
  /** ป้ายตามหน้ากรม — ใช้ในแบนเนอร์ */
  const ADDRESS_FIELD_TEXT = Object.freeze({
    recipientName: "ชื่อ",
    addressLine: "เลขที่บ้าน",
    province: "จังหวัด",
    district: "เขต/อำเภอ",
    subDistrict: "แขวง/ตำบล",
    postalCode: "รหัสไปรษณีย์",
    phone: "เบอร์โทรศัพท์ติดต่อ",
    email: "E-mail",
  });
  const ADDRESS_SKIP_TEXT = Object.freeze({
    too_long: "ยาวเกินช่องของกรม",
    option_missing: "ไม่พบในรายการของกรม",
    cascade_stopped: "ช่องก่อนหน้าเลือกไม่ติด",
    invalid_phone: "รูปแบบเบอร์ใช้ไม่ได้",
    officer_filled: "มีค่าอยู่แล้ว บอทไม่เขียนทับ",
    no_data: "ระบบไม่มีข้อมูล",
    selector_missing: "หาช่องไม่เจอ",
    value_mismatch: "ค่าไม่ติด",
    dialog_open: "กรมเปิดกล่องข้อความ",
  });
  const ADDRESS_NOT_REACHED_TEXT = Object.freeze({
    timeout: "รอหน้าที่อยู่เกินเวลา — กรอกที่อยู่เอง",
    aborted: "ปิดแท็บก่อนกรอกที่อยู่",
    superseded: "มีการสั่งงานใหม่จาก moto24 — ที่อยู่ยังไม่ได้กรอก แท็บนี้ไม่ถูกติดตามแล้ว",
    page_changed: "ออกจากหน้ายื่นภาษีก่อนกรอกที่อยู่ — กรอกที่อยู่เอง",
    bot_error: "บอทขัดข้องก่อนกรอกที่อยู่ — กรอกที่อยู่เอง",
  });

  /** 🔒 KEEP-IN-SYNC: dltPhoneDigits ของ moto24 (เวกเตอร์เทสต์ชุดเดียวกัน) */
  function dltPhoneDigits(raw) {
    if (raw == null) return null;
    const s = String(raw).replace(/[-\s]/g, "");
    return /^\d{9,10}$/.test(s) ? s : null;
  }

  function planAddressFill(delivery) {
    const d = delivery || {};
    const text = (k) => normText(d[k]);
    const limited = (key) => {
      const value = text(key);
      return value.length <= ADDRESS_MAXLEN[key] ? { key, value } : { key, skip: "too_long", value };
    };
    const phone = dltPhoneDigits(d.phone);
    const email = text("email");
    const zip = text("postalCode");
    return {
      recipientName: limited("recipientName"),
      addressLine: limited("addressLine"),
      cascade: [
        { key: "province", value: text("province") },
        { key: "district", value: text("district") },
        { key: "subDistrict", value: text("subDistrict") },
      ],
      postalCode: zip ? { key: "postalCode", value: zip } : { key: "postalCode", skip: "no_data", value: null },
      phone: phone
        ? { key: "phone", value: phone }
        : d.phone
          ? { key: "phone", skip: "invalid_phone", value: String(d.phone) }
          : { key: "phone", skip: "no_data", value: null },
      email: email ? { key: "email", value: email } : { key: "email", skip: "no_data", value: null },
    };
  }

  /** ช่องข้อความ: แผนสั่งเว้น ⇒ เว้น · มีค่าเท่าที่จะกรอกอยู่แล้ว (รันซ้ำ / กด "ตรวจสอบข้อมูล" แล้วกลับมา)
   *  ⇒ { already } นับว่ากรอกแล้ว ไม่เขียนซ้ำ · มีค่าอื่น (คนกรอกก่อน) ⇒ ไม่เขียนทับ · ว่าง ⇒ กรอก */
  function textFillDecision(current, planned) {
    if (planned.skip) return { skip: planned.skip, value: planned.value };
    const before = normText(current);
    if (before && before === normText(planned.value)) return { already: true, value: planned.value };
    if (before) return { skip: "officer_filled", value: before };
    return { fill: planned.value };
  }

  /** ก่อนเลือกช่องหนึ่งในทอด จังหวัด→อำเภอ→ตำบล · combo = { shown, hidden } ของ autocomplete (null = หา widget ไม่เจอ)
   *  broken = ช่องก่อนหน้าในทอดไม่ติด ⇒ ช่องลูกกรองตามช่องแม่ เลือกต่อไม่ได้ (§3.1)
   *  stop = ช่องถัดไปในทอดต้องไม่เลือกต่อ (คนเลือกค่าอื่นไว้ ⇒ ค่าของเราเป็นของอีกจังหวัด/อำเภอ)
   *  ข้อความตรงแต่ hidden ว่าง = พิมพ์ค้างไม่ได้เลือกจากรายการ (กรม LovRequired) ⇒ ของคน ไม่นับว่ากรอกแล้ว */
  function cascadeFillDecision(broken, combo, planned) {
    const want = normText(planned.value);
    if (!combo) return broken ? { skip: "cascade_stopped", value: planned.value } : { skip: "selector_missing", value: planned.value, stop: true };
    const shown = normText(combo.shown);
    if (shown) {
      return shown === want && normText(combo.hidden) !== "" ? { already: true, value: planned.value } : { skip: "officer_filled", value: shown, stop: true };
    }
    if (broken) return { skip: "cascade_stopped", value: planned.value };
    if (!want) return { skip: "no_data", value: null, stop: true };
    return { select: planned.value };
  }

  /** เหตุที่ selectAutocomplete พิมพ์ข้อความลง _input/_hinput ไปแล้วแต่เลือกไม่ติด */
  const CASCADE_TYPED_REASONS = Object.freeze(["option_missing", "value_mismatch"]);
  const CASCADE_KEYS = Object.freeze(["province", "district", "subDistrict"]);

  /** หลัง selectAutocomplete ของช่องในทอด — ไม่ติด ⇒ เหตุจากการเลือก + ค่าที่ลอง (§7 ข้อ 3.4) แล้วหยุดทอด
   *  clear = บอทพิมพ์ลงช่องไปแล้ว ⇒ steps ต้องคืน _input/_hinput ให้ว่าง (final review I-1: ช่องที่เลือกไม่ติดต้อง *ดู* ว่าง
   *  ไม่ใช่ดูครบ · ปลอดภัยต่อ "ไม่เขียนทับของคน" เพราะ cascadeFillDecision สั่งเลือกเฉพาะเมื่อช่องว่างอยู่แล้ว) */
  function cascadeResultDecision(res, planned) {
    if (res && res.ok) return { filled: true };
    const reason = (res && res.reason) || "value_mismatch";
    const d = { skip: reason, value: planned.value, stop: true };
    if (CASCADE_TYPED_REASONS.includes(reason)) d.clear = true;
    return d;
  }

  /** ทอด จังหวัด→อำเภอ→ตำบล มีช่องที่ไม่ได้ค่าจากรายการ (บอทเลือกไม่ติด / ถูกหยุดต่อ) — ช่องที่คนเลือกเองไม่นับ */
  function cascadeIncomplete(skipped) {
    return (skipped || []).some((s) => s && CASCADE_KEYS.includes(s.field) && s.reason !== "officer_filled");
  }

  /** รหัสไปรษณีย์ — กรมเติมเองทันทีที่เลือกตำบล (§3.1) ⇒ ถ้าตำบลเป็นของเราและช่องมีค่า ใช้ของกรม (dltZip)
   *  พร้อม note เมื่อไม่ตรงของเรา · ห้ามตัดสินด้วย textFillDecision ในกรณีนี้ (ค่าของกรมจะกลายเป็น officer_filled)
   *  ทอดเลือกไม่ครบ (cascadeBroken — L.cascadeIncomplete) + ช่องว่าง ⇒ ไม่เติมของเรา (cascade_stopped · final review I-1):
   *  ปล่อยให้กรมเติมเองตอนคนเลือกตำบล — รหัสไปรษณีย์ของเราบนทอดที่ขาดทำให้หน้ากรมดูเหมือนกรอกครบ
   *  ตำบลไม่ใช่ของเรา / กรมไม่เติม ⇒ กติกาช่องข้อความปกติ */
  function zipFillDecision(current, subDistrictOurs, planned, cascadeBroken) {
    const now = normText(current);
    if (subDistrictOurs && now) return { dlt: now, note: zipDiffNote(now, planned.value) };
    if (cascadeBroken && !now && !planned.skip) return { skip: "cascade_stopped", value: planned.value };
    return textFillDecision(current, planned);
  }

  /** dialog ของ editPage2 โผล่ระหว่างกรอก ⇒ หยุดกรอก: ช่องที่เหลือ dialog_open + note (Ruling R9) · ไม่มี ⇒ null
   *  บอทไม่แตะอะไรใน dialog เลย (lib.isForbiddenTarget) — คนอ่านแล้วตัดสินใจเอง */
  function addressDialogStop(openIds, remainingKeys) {
    if (!openIds || !openIds.length) return null;
    return {
      note: "dlt_dialog:" + openIds.join(","),
      skipped: (remainingKeys || []).map((field) => ({ field, reason: "dialog_open", value: null })),
    };
  }

  /** radio ที่อยู่: คนเลือกแบบอื่นไว้แล้ว ⇒ ไม่แตะ (Ruling R4) · ไม่มีตัว "อื่นๆ" ⇒ หน้าเปลี่ยน */
  function addressRadioDecision(selected, hasOther) {
    if (selected && selected !== ADDRESS_OTHER_VALUE) return "officer_chose_other";
    if (!hasOther) return "page_changed";
    return selected === ADDRESS_OTHER_VALUE ? "already_other" : "click_other";
  }

  function zipDiffNote(dltZip, ours) {
    const d = normText(dltZip);
    const o = normText(ours);
    return d && o && d !== o ? "zip_differs:" + o : null;
  }

  /** filled = ไม่มีช่องที่เว้น ยกเว้น no_data (เบอร์/อีเมลที่ระบบไม่มี — Ruling R3)
   *  และไม่มี dialog ของกรมโผล่ระหว่าง/หลังกรอก (note dlt_dialog: — Ruling R9 ⇒ partial เสมอ) */
  function addressStatusOf(skipped, notes) {
    if ((notes || []).some((n) => String(n).indexOf("dlt_dialog:") === 0)) return "partial";
    return (skipped || []).some((s) => s.reason !== "no_data") ? "partial" : "filled";
  }

  /** บรรทัด "เหลือให้ทำเอง" ของแบนเนอร์ — ไม่ใส่ค่าในช่อง (ข้อมูลลูกค้า) */
  function describeAddressSkips(address) {
    const skipped = address && Array.isArray(address.skipped) ? address.skipped : [];
    return skipped.map((s) => {
      const field = ADDRESS_FIELD_TEXT[s.field] || s.field;
      const why = ADDRESS_SKIP_TEXT[s.reason] || s.reason;
      const max = s.reason === "too_long" && ADDRESS_MAXLEN[s.field] ? " " + ADDRESS_MAXLEN[s.field] + " ตัว" : "";
      // เบอร์ไม่บังคับบนหน้ากรม ⇒ ไม่มีเบอร์ = เว้นได้ (ตรงกับการ์ด moto24 "ไม่มีเบอร์ — เว้นว่าง")
      if (s.field === "phone" && s.reason === "no_data") return field + ": ระบบไม่มีเบอร์ — เว้นว่างได้";
      const tail = s.reason === "officer_filled" ? " — ตรวจเอง" : " — กรอกเอง";
      return field + ": " + why + max + tail;
    });
  }

  function addressNotReachedText(reason) {
    return ADDRESS_NOT_REACHED_TEXT[reason] || "ไม่ได้กรอกที่อยู่ — กรอกเอง";
  }

  function newRun(input) {
    return {
      runId: input.runId,
      tabId: input.tabId,
      payload: input.payload,
      phase: "starting",
      startedAt: input.nowIso,
      updatedAt: input.nowIso,
      visits: {},
      fields: { filled: [], skipped: [], values: {} },
      nameAttempts: [],
      registration: "not_registered",
      dltMessages: [],
      dltSays: {},
      timeline: [{ at: input.nowIso, phase: "starting", event: "start" }],
      reachedReady: false, // ผ่าน prb_ok แล้ว — ready_reached / phase รอ-กรอกที่อยู่ / address / final ready_to_submit (payload v2 เท่านั้น)
      address: null, // ผลส่วนที่อยู่ล่าสุดที่หน้ารายงาน
      result: null,
    };
  }

  const PAGE_EVENT_TYPES = Object.freeze(["phase", "heartbeat", "note", "name_attempt", "registration", "dlt_message", "fields", "dlt_says", "ready_reached", "address", "final"]);

  /** เหตุการณ์จากหน้า (ผ่าน relay) — whitelist ชนิด · visit มาจาก service worker เท่านั้น */
  function sanitizeEvent(ev) {
    if (!ev || typeof ev !== "object" || !PAGE_EVENT_TYPES.includes(ev.type)) return null;
    if (ev.type === "final" && !OUTCOMES.includes(ev.outcome)) return null;
    return ev;
  }

  /** ไม่มีชื่อลูกค้า/ทะเบียนในไทม์ไลน์ — ชนิดเหตุการณ์ล้วน */
  function describeEvent(ev) {
    switch (ev.type) {
      case "phase": return "phase:" + ev.phase;
      case "visit": return "visit:" + ev.kind;
      case "name_attempt": return "name:" + (ev.source || "?") + ":" + (ev.accepted ? "accepted" : "rejected");
      case "registration": return "registration:" + ev.value;
      case "dlt_message": return "dlt_message:" + ev.kind;
      case "final": return "final:" + ev.outcome;
      case "note": return "note:" + ev.event;
      case "ready_reached": return "ready_reached";
      case "address": return "address:" + (ev.address && ev.address.status ? clip(ev.address.status, LIMITS.short) : "?");
      default: return ev.type;
    }
  }

  function mergeFields(target, ev) {
    const filled = Array.isArray(ev.filled) ? ev.filled.map((f) => clip(f, LIMITS.short)) : [];
    const skipped = Array.isArray(ev.skipped) ? ev.skipped : [];
    for (const f of filled) target.skipped = target.skipped.filter((s) => s.field !== f);
    for (const s of skipped) target.filled = target.filled.filter((f) => f !== s.field);
    for (const f of filled) if (!target.filled.includes(f) && target.filled.length < LIMITS.fieldList) target.filled.push(f);
    for (const s of skipped) {
      if (!s || typeof s.field !== "string") continue;
      const item = { field: clip(s.field, LIMITS.short), reason: clip(s.reason, LIMITS.short), value: s.value == null ? null : clip(s.value, LIMITS.text) };
      const i = target.skipped.findIndex((x) => x.field === item.field);
      if (i >= 0) target.skipped[i] = item;
      else if (target.skipped.length < LIMITS.fieldList) target.skipped.push(item);
    }
    for (const [k, v] of Object.entries(ev.values || {})) {
      const key = clip(k, LIMITS.short);
      // policyFlag อ่านซ้ำได้ "" บนหน้าที่ไม่มี radio พ.ร.บ. (final review m-2) ⇒ ไม่ทับค่าที่อ่านไว้
      if (key === "policyFlag" && v === "" && target.values[key]) continue;
      if (key in target.values || Object.keys(target.values).length < LIMITS.fieldList) target.values[key] = clip(v, LIMITS.text);
    }
  }

  function saysDate(d) {
    return d && typeof d === "object" ? { raw: clip(d.raw, LIMITS.short), iso: typeof d.iso === "string" ? d.iso : null } : undefined;
  }

  function mergeSays(target, ev) {
    if (ev.taxExpiry) target.taxExpiry = saysDate(ev.taxExpiry);
    if (ev.nextTaxExpiry) target.nextTaxExpiry = saysDate(ev.nextTaxExpiry);
    // อ่านซ้ำบนหน้าที่ไม่มียอด (เช่น โหลดหน้าที่อยู่เต็มหน้า — final review m-2) ⇒ ไม่ล้างยอดที่อ่านไว้
    if (Array.isArray(ev.amounts) && (ev.amounts.length || !Array.isArray(target.amounts))) target.amounts = ev.amounts.slice(0, 10).map((a) => ({ label: clip(a.label, LIMITS.short), raw: clip(a.raw, LIMITS.short) }));
    if (ev.prbInfo) target.prbInfo = clip(ev.prbInfo, LIMITS.text);
    if (ev.siteVersion) target.siteVersion = clip(ev.siteVersion, LIMITS.short);
  }

  function buildDltResult(run, outcome, error, address) {
    const r = {
      resultVersion: address ? 2 : 1,
      outcome,
      fields: run.fields,
      nameAttempts: run.nameAttempts,
      registration: run.registration,
      dltMessages: run.dltMessages,
      dltSays: run.dltSays,
      timeline: run.timeline,
    };
    if (address) r.address = address;
    if (error) r.error = clip(error, LIMITS.text);
    return JSON.parse(JSON.stringify(r));
  }

  /** reducer บริสุทธิ์ — รอบที่มี result แล้วเป็นรอบปิดตาย (คืนตัวเดิม) */
  function applyDltEvent(run, ev, nowIso) {
    if (!run || run.result || !ev) return run;
    const next = JSON.parse(JSON.stringify(run));
    next.updatedAt = nowIso;
    if (ev.type === "heartbeat") return next;
    const isV2 = !!next.payload && next.payload.version === 2;

    if (ev.type === "phase" && typeof ev.phase === "string") {
      next.phase = clip(ev.phase, LIMITS.short);
      if (isV2 && PAST_READY_PHASES.includes(next.phase)) next.reachedReady = true;
    } else if (ev.type === "visit") {
      next.visits[ev.kind] = (next.visits[ev.kind] || 0) + 1;
    } else if (ev.type === "name_attempt") {
      if (next.nameAttempts.length < LIMITS.nameAttempts) {
        const a = {
          name: clip(ev.name, LIMITS.text),
          source: ev.source === "company" || ev.source === "customer" ? ev.source : "officer",
          accepted: ev.accepted === true,
        };
        if (ev.dltMessage) a.dltMessage = clip(ev.dltMessage, LIMITS.text);
        next.nameAttempts.push(a);
      }
    } else if (ev.type === "registration") {
      if (next.registration === "not_registered" && (ev.value === "already_listed" || ev.value === "registered")) {
        next.registration = ev.value;
        if (ev.value === "already_listed" && ev.ownerName) next.dltSays.listedOwnerName = clip(ev.ownerName, LIMITS.text);
      }
    } else if (ev.type === "dlt_message") {
      if (next.dltMessages.length < LIMITS.dltMessages) {
        next.dltMessages.push({ page: clip(ev.page, LIMITS.short), kind: clip(ev.kind, LIMITS.short), text: clip(ev.text, LIMITS.text), at: nowIso });
      }
    } else if (ev.type === "ready_reached") {
      if (isV2) next.reachedReady = true;
    } else if (ev.type === "address") {
      if (isV2) {
        next.reachedReady = true; // หน้ารายงานส่วนที่อยู่ได้แปลว่าผ่าน prb_ok แล้ว (I4) — แม้ตัวผลจะใช้ไม่ได้
        const a = sanitizeAddress(ev.address);
        if (a) next.address = a;
      }
    } else if (ev.type === "fields") {
      mergeFields(next.fields, ev);
    } else if (ev.type === "dlt_says") {
      mergeSays(next.dltSays, ev);
    }

    next.timeline.push({ at: nowIso, phase: next.phase, event: clip(describeEvent(ev), LIMITS.text) });
    if (next.timeline.length > LIMITS.timeline) next.timeline = next.timeline.slice(-LIMITS.timeline);

    if (ev.type === "final") {
      next.phase = "done";
      if (isV2 && ev.outcome === "ready_to_submit") next.reachedReady = true; // หน้าบอกเองว่าถึงแล้ว (I4)
      // final review m-6: หน้าพก address มากับ final ด้วย (event address แยกอาจหล่น/มาหลัง final ผ่าน relay)
      // ใช้ได้ ⇒ ใช้ตัวนี้ · ใช้ไม่ได้ ⇒ คงตัวที่มาแยก · ผ่าน settleFinal เหมือนเดิม ⇒ §6.3/R7 ไม่หลุด · v1 ละ (R6)
      if (isV2 && ev.address) {
        next.reachedReady = true; // เหมือน event address (I4)
        const a = sanitizeAddress(ev.address);
        if (a) next.address = a;
      }
      const settled = settleFinal(next, ev.outcome, ev.error);
      next.result = buildDltResult(next, settled.outcome, settled.error, settled.address);
    }
    return next;
  }

  function isIdle(run, nowMs, idleMs) {
    return !!run && !run.result && nowMs - Date.parse(run.updatedAt) > idleMs;
  }

  function isExpired(run, nowMs, keepMs) {
    return !!run && !!run.result && nowMs - Date.parse(run.updatedAt) > keepMs;
  }

  const api = {
    URLS,
    LIMITS,
    FORBIDDEN_TARGETS,
    EDITPAGE2_ALLOWED_BASES,
    isAllowedEditPage2Id,
    OUTCOME_TEXT,
    OUTCOMES,
    normText,
    clip,
    isForbiddenTarget,
    safeClick,
    setInputValue,
    classifyDltMessage,
    isBlankDialogText,
    hasMorePages,
    emptyFieldsFromMessage,
    parseThaiDate,
    plateKey,
    findListedRow,
    pickMessageDialogId,
    classifyTaxFormDialogs,
    pickDetailValues,
    findSiteVersion,
    classifyDltUrl,
    PHASE_BY_KIND,
    STEP_BY_KIND,
    validatePayload,
    ADDRESS_NOT_READY,
    ADDRESS_STATUSES,
    emptyAddress,
    sanitizeAddress,
    settleFinal,
    ADDRESS_MAXLEN,
    ADDRESS_OTHER_VALUE,
    ADDRESS_FIELD_TEXT,
    dltPhoneDigits,
    planAddressFill,
    textFillDecision,
    cascadeFillDecision,
    cascadeResultDecision,
    cascadeIncomplete,
    zipFillDecision,
    addressDialogStop,
    addressRadioDecision,
    zipDiffNote,
    addressStatusOf,
    describeAddressSkips,
    addressNotReachedText,
    newRun,
    sanitizeEvent,
    applyDltEvent,
    buildDltResult,
    isIdle,
    isExpired,
  };

  root.__moto24Dlt = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
