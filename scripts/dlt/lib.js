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
// สัญญากับ moto24: lib/renewal-tracking/dlt-tax-types.ts — KEEP-IN-SYNC: version · resultVersion · LIMITS
// @typedef {{ version: 1, runId: string, display: { customer: string, plate: string },
//   vehicleTypeLabel: string, provinceLabel: string|null, plate1: string, plate2: string,
//   ownerNames: { value: string, source: "company"|"customer" }[], mileage: string|null,
//   ours: { expiryDate: string|null, jobType: string } }} DltTaxPayloadV1

(function (root) {
  "use strict";

  const URLS = {
    register: "https://eservice.dlt.go.th/esvapp/esv/ebk/esv02i001/index.jsf",
  };

  /** ต้องเท่ากับ DLT_RESULT_LIMITS ของ moto24 — ข้อความยาวกว่านี้ถูกตัดก่อนส่ง */
  const LIMITS = Object.freeze({ text: 2000, short: 200, dltMessages: 50, timeline: 200, nameAttempts: 20, fieldList: 50 });

  /** ปุ่ม/ช่องที่บอทห้ามกดหรือแตะ (spec §6.7) — ตรวจทั้งตัวมันและบรรพบุรุษ */
  const FORBIDDEN_TARGETS = Object.freeze([
    "info_submitBtn", // ยอมรับข้อตกลง
    "info_checkEmailAgreementBtn", // ตกลง ของ dialog แจ้งอีเมล
    "info_backBtn", // ปฏิเสธข้อตกลง
    "editPage1_edit2Btn", // กรอกสถานที่จัดส่งเอกสาร (⚠️ ไม่ใช่ edit1Btn)
    "editPage1_alertFoundOicBtn", // ตกลง ของ dialog ผล พ.ร.บ.
    "editPage1_policyFlag", // radio พ.ร.บ. ทั้งกลุ่ม (ค่า 4/5 = ซื้อ = เงิน)
    "editPage1_baceBtn", // ย้อนกลับ
    "search_srsRegistrantRemoveListTableBtn", // ยกเลิกลงทะเบียนรถ
    "result_confirmRemoveListBtn", // ยืนยันยกเลิกลงทะเบียน
  ]);
  /** ทุกอย่างในหน้าที่อยู่จัดส่ง/ชำระเงิน */
  const FORBIDDEN_PREFIXES = Object.freeze(["editPage2_"]);

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

  function isForbiddenTarget(el) {
    let node = el;
    for (let depth = 0; node && depth < 40; depth++) {
      const id = typeof node.id === "string" ? node.id : "";
      if (id && (FORBIDDEN_TARGETS.includes(id) || FORBIDDEN_PREFIXES.some((p) => id.startsWith(p)))) return true;
      node = node.parentElement;
    }
    return false;
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

  /** ตรวจ payload จาก moto24 ซ้ำฝั่ง extension — 🔒 ชื่อ 1–2 ชื่อ (spec D2) */
  function validatePayload(p) {
    if (!p || typeof p !== "object") return "payload ว่าง";
    if (p.version !== 1) return "payload version ไม่รองรับ (ต้องเป็น 1) — อัปเดต extension หรือ moto24";
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
    return null;
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
      result: null,
    };
  }

  const PAGE_EVENT_TYPES = Object.freeze(["phase", "heartbeat", "note", "name_attempt", "registration", "dlt_message", "fields", "dlt_says", "final"]);

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
      if (key in target.values || Object.keys(target.values).length < LIMITS.fieldList) target.values[key] = clip(v, LIMITS.text);
    }
  }

  function saysDate(d) {
    return d && typeof d === "object" ? { raw: clip(d.raw, LIMITS.short), iso: typeof d.iso === "string" ? d.iso : null } : undefined;
  }

  function mergeSays(target, ev) {
    if (ev.taxExpiry) target.taxExpiry = saysDate(ev.taxExpiry);
    if (ev.nextTaxExpiry) target.nextTaxExpiry = saysDate(ev.nextTaxExpiry);
    if (Array.isArray(ev.amounts)) target.amounts = ev.amounts.slice(0, 10).map((a) => ({ label: clip(a.label, LIMITS.short), raw: clip(a.raw, LIMITS.short) }));
    if (ev.prbInfo) target.prbInfo = clip(ev.prbInfo, LIMITS.text);
    if (ev.siteVersion) target.siteVersion = clip(ev.siteVersion, LIMITS.short);
  }

  function buildDltResult(run, outcome, error) {
    const r = {
      resultVersion: 1,
      outcome,
      fields: run.fields,
      nameAttempts: run.nameAttempts,
      registration: run.registration,
      dltMessages: run.dltMessages,
      dltSays: run.dltSays,
      timeline: run.timeline,
    };
    if (error) r.error = clip(error, LIMITS.text);
    return JSON.parse(JSON.stringify(r));
  }

  /** reducer บริสุทธิ์ — รอบที่มี result แล้วเป็นรอบปิดตาย (คืนตัวเดิม) */
  function applyDltEvent(run, ev, nowIso) {
    if (!run || run.result || !ev) return run;
    const next = JSON.parse(JSON.stringify(run));
    next.updatedAt = nowIso;
    if (ev.type === "heartbeat") return next;

    if (ev.type === "phase" && typeof ev.phase === "string") {
      next.phase = clip(ev.phase, LIMITS.short);
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
    } else if (ev.type === "fields") {
      mergeFields(next.fields, ev);
    } else if (ev.type === "dlt_says") {
      mergeSays(next.dltSays, ev);
    }

    next.timeline.push({ at: nowIso, phase: next.phase, event: clip(describeEvent(ev), LIMITS.text) });
    if (next.timeline.length > LIMITS.timeline) next.timeline = next.timeline.slice(-LIMITS.timeline);

    if (ev.type === "final") {
      next.phase = "done";
      next.result = buildDltResult(next, ev.outcome, ev.error);
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
