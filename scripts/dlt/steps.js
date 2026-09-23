// scripts/dlt/steps.js — ขั้นต่อหน้าของ flow ต่อภาษีออนไลน์ (MAIN world ของ eservice.dlt.go.th)
//
// service worker inject ไฟล์นี้ (ต่อจาก lib.js) ทุกครั้งที่หน้าโหลดเสร็จ แล้วเรียก
// window.__moto24DltSteps[ชื่อขั้น](ctx) · ขั้นรายงานผ่าน window.postMessage → relay.js → service worker
//
// 🔒 บอทกรอก คนกดยืนยัน — ทุกคลิก/ทุกการตั้งค่าช่องผ่าน click()/setValue() (ห่อ L.safeClick / L.setInputValue
//    อีกชั้นเพื่อเช็ก stopped() ก่อนกดเสมอ) เท่านั้น (test/dlt/steps-scan.test.js สแกนไฟล์นี้)
// 🔒 ทุกขั้นจบด้วยแบนเนอร์ — ห่อ try/finally · helper ทุกตัวประกาศระดับบนสุดของ IIFE
//    (PRB_AUTOFILL_BOT.md ข้อ 5–6 ของ repo moto24: helper ที่ประกาศใน try เป็น block-scoped แล้วพัง)
// ผลวัดที่ไฟล์นี้พึ่ง: DLT_ESERVICE_TAX_RENEWAL.md (repo moto24) — Gotcha 1 (ท่า ①′), 2, 8–11 · S1–S6
// ⛔ PUBLIC REPO — ห้ามใส่ข้อมูลลูกค้า/ทะเบียนจริง/ชื่อบริษัท

(function () {
  "use strict";
  if (window.__moto24DltSteps) return;
  const L = window.__moto24Dlt;
  if (!L) {
    console.warn("[moto24-dlt] lib.js ยังไม่ถูกโหลด");
    return;
  }

  const SOURCE = "moto24-dlt";
  const MANUAL_WAIT_MS = 30 * 60 * 1000;
  const HEARTBEAT_MS = 5 * 60 * 1000;
  const ROW_SUBMIT_WAIT_MS = 30 * 1000;
  const W_VEHICLE = "widget_add_tabtVehicleTypeRef_tabtVehicleTypeRef";
  const W_PROVINCE = "widget_add_offLocCode_offLocCode";
  const COMBO_WIDGET = { vehicleType: W_VEHICLE, province: W_PROVINCE };
  const COMBO_LABEL = { vehicleType: "ประเภทรถ", province: "จังหวัด/สาขา" };
  const AMOUNT_FIELDS = [
    ["editPage1_taxAmt", "ภาษี"],
    ["editPage1_addAmt", "เงินเพิ่ม"],
    ["editPage1_feeAmt", "ค่าจัดส่ง"],
    ["editPage1_ptmAmt", "ค่าปรับใบสั่ง"],
    ["editPage1_total", "รวม"],
  ];
  const TONES = {
    info: ["#eff6ff", "#3b82f6"],
    wait: ["#fefce8", "#eab308"],
    ok: ["#ecfdf5", "#10b981"],
    warn: ["#fff7ed", "#f97316"],
    error: ["#fef2f2", "#ef4444"],
  };
  const OUTCOME_TONE = {
    ready_to_submit: "ok",
    prb_not_found: "warn",
    dlt_blocked: "warn",
    name_rejected: "warn",
    unexpected_page: "error",
    aborted: "info",
    superseded: "info",
    timeout: "warn",
    bot_error: "error",
  };

  // ── พื้นฐาน ─────────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function errText(err) {
    return String(err && err.message ? err.message : err);
  }

  /** true หลัง service worker ปิดรอบนี้ไปแล้ว (superseded/timeout/unexpected_page — showFinal ตั้งค่านี้)
   *  ⇒ ขั้นที่ค้างอยู่ในหน้าเดิมต้องหยุดเงียบ ๆ ไม่กด ไม่กรอก ไม่วาดแบนเนอร์ใหม่ (review fix) */
  function stopped() {
    return window.__moto24DltStopped === true;
  }

  /** โยนแล้วให้ try/catch ระดับบนสุดของแต่ละขั้นจับแยกจาก error จริง — ไม่ใช่ Error ธรรมดา
   *  เพื่อไม่ให้ finish(ctx, view, "bot_error", …) ถูกเรียกหลังรอบถูกปิดไปแล้ว */
  function StoppedError() {}
  StoppedError.prototype = Object.create(Error.prototype);
  StoppedError.prototype.name = "StoppedError";

  function ensureNotStopped() {
    if (stopped()) throw new StoppedError();
  }

  /** ตัวเดียวที่ steps.js เรียกเพื่อคลิก/กรอก — เช็ก stopped() ก่อนทุกครั้งแล้วค่อยส่งต่อ L.safeClick/L.setInputValue
   *  (steps.js เองยังไม่ยิงคลิก/event เอง — ยังผ่านด่านเดิมของ L ทั้งหมด) */
  function click(el, opts) {
    ensureNotStopped();
    return L.safeClick(el, opts);
  }
  function setValue(el, value) {
    ensureNotStopped();
    return L.setInputValue(el, value);
  }

  function post(ctx, event) {
    window.postMessage({ source: SOURCE, runId: ctx.runId, event }, window.location.origin);
  }

  function isVisible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && el.getClientRects().length > 0;
  }

  function readValue(id) {
    const el = byId(id);
    if (!el) return "";
    const v = el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? el.value : el.innerText;
    return L.normText(v);
  }

  /** AJAX ของ PrimeFaces 5 เสร็จ (Gotcha 11) — ต้องว่างต่อเนื่อง 250 ms */
  async function waitAjaxIdle(timeoutMs) {
    const limit = Date.now() + (timeoutMs || 20000);
    await sleep(150);
    let idleSince = 0;
    while (Date.now() < limit) {
      ensureNotStopped();
      const jq = window.jQuery;
      const q = window.PrimeFaces && window.PrimeFaces.ajax && window.PrimeFaces.ajax.Queue;
      const idle = !!jq && jq.active === 0 && (!q || q.isEmpty());
      if (idle) {
        if (!idleSince) idleSince = Date.now();
        if (Date.now() - idleSince >= 250) return true;
      } else {
        idleSince = 0;
      }
      await sleep(100);
    }
    return false;
  }

  /** id ของ dialog ข้อความที่มองเห็นอยู่ตอนนี้ — #cdgsmessagedlg ตามปกติ แต่ลงทะเบียนซ้ำเปิด
   *  dialog แยกที่ id ขึ้นต้น `alertExist…` (Gotcha 5, DLT_ESERVICE_TAX_RENEWAL.md) · อ่านอย่างเดียว
   *  ไม่คลิกอะไร */
  function visibleMessageDialogIds() {
    const ids = [];
    if (isVisible(byId("cdgsmessagedlg"))) ids.push("cdgsmessagedlg");
    document.querySelectorAll('[id^="alertExist"]').forEach((el) => {
      if (isVisible(el)) ids.push(el.id);
    });
    return ids;
  }

  /** ข้อความของ dialog ที่ควรอ่านตอนนี้ (ทั้งสำเร็จ ผิดพลาด และลงทะเบียนซ้ำขึ้นที่นี่ — spike S6 + Gotcha 5)
   *  ไม่มี dialog ที่ต้องอ่าน ⇒ null */
  function readMessageDialog() {
    const id = L.pickMessageDialogId(visibleMessageDialogIds());
    if (!id) return null;
    const dlg = byId(id);
    const content = dlg ? dlg.querySelector(".ui-dialog-content") : null;
    return content ? content.innerText.trim() : "";
  }

  /** ปิดด้วยปุ่มบน title bar ⇒ overlay หายไปด้วย (Gotcha 2) */
  async function closeMessageDialog() {
    const btn = document.querySelector("#cdgsmessagedlg .ui-dialog-titlebar-close");
    if (btn && isVisible(byId("cdgsmessagedlg"))) {
      click(btn);
      await sleep(300);
    }
  }

  function widget(widgetVar) {
    const pf = window.PrimeFaces;
    return pf && pf.widgets ? pf.widgets[widgetVar] || null : null;
  }

  function comboState(widgetVar) {
    const w = widget(widgetVar);
    if (!w || !w.input || !w.hinput) return null;
    return { shown: String(w.input.val() || ""), hidden: String(w.hinput.val() || "") };
  }

  /** ท่า ①′ (spike S1): ตั้ง _input + _hinput = ข้อความเต็ม *ก่อน* search แล้วคลิกรายการที่ตรง
   *  ⛔ ① (search อย่างเดียว) และ ② (invokeItemSelectBehavior) วัดแล้วไม่ผ่าน */
  async function selectAutocomplete(widgetVar, label) {
    if (!label) return { ok: false, reason: "no_data" };
    const w = widget(widgetVar);
    if (!w || !w.input || !w.hinput || !w.panel || typeof w.search !== "function") return { ok: false, reason: "selector_missing" };
    w.input.val(label);
    w.hinput.val(label); // ต้องตั้งก่อน search — ตัวชี้ขาด (Gotcha 1)
    w.search(label);
    await waitAjaxIdle();
    const items = w.panel.find("li.ui-autocomplete-item");
    const li = Array.prototype.find.call(items, (el) => el.getAttribute("data-item-label") === label);
    if (!li) return { ok: false, reason: "option_missing", value: String(w.input.val() || "") };
    click(li, { jquery: true });
    await waitAjaxIdle();
    const shown = String(w.input.val() || "");
    const hidden = String(w.hinput.val() || "");
    return shown === label && hidden !== "" ? { ok: true, value: shown, hidden } : { ok: false, reason: "value_mismatch", value: shown };
  }

  function noteCombo(fields, key, res, expected) {
    if (res.ok) {
      fields.filled.push(key);
      fields.values[key] = res.value;
      if (res.hidden) fields.values[key + "Hidden"] = res.hidden;
    } else {
      fields.skipped.push({ field: key, reason: res.reason, value: expected == null ? null : String(expected) });
    }
  }

  function fillText(fields, key, id, value) {
    const el = byId(id);
    if (!el) {
      fields.skipped.push({ field: key, reason: "selector_missing", value: String(value) });
      return;
    }
    const got = setValue(el, value);
    if (got === value) {
      fields.filled.push(key);
      fields.values[key] = got;
    } else {
      fields.skipped.push({ field: key, reason: "value_mismatch", value: got });
    }
  }

  function postFields(ctx, fields) {
    post(ctx, { type: "fields", filled: fields.filled, skipped: fields.skipped, values: fields.values });
  }

  function readTable() {
    const table = byId("result_table");
    if (!table) return null;
    const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.innerText);
    const trs = Array.from(table.querySelectorAll("tbody tr")).filter((tr) => tr.querySelectorAll("td").length > 1);
    const rows = trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.innerText));
    return { headers, rows, trs };
  }

  function submitButtonOf(table, index) {
    const tr = table.trs[index];
    if (!tr) return null;
    const col = table.headers.findIndex((h) => L.normText(h).includes("ยื่นชำระภาษี"));
    const cell = col >= 0 ? tr.querySelectorAll("td")[col] : null;
    return (cell && cell.querySelector("button, a")) || byId("result_table_" + index + "_j_id_8p");
  }

  /** paginator ของ #result_table — อ่านอย่างเดียว ไม่คลิก (review fix — ไม่ auto-page แค่บอกว่ามีหน้าอื่นไหม) */
  function readPaginatorInfo() {
    const table = byId("result_table");
    if (!table) return null;
    const root = (table.closest && table.closest(".ui-datatable")) || table.parentElement || document;
    const pageLinkCount = root.querySelectorAll(".ui-paginator .ui-paginator-page").length;
    const next = root.querySelector(".ui-paginator .ui-paginator-next");
    const nextDisabled = next ? next.classList.contains("ui-state-disabled") : null;
    return { pageLinkCount, nextDisabled };
  }

  // ── แบนเนอร์ ────────────────────────────────────────────────────────────

  function newView(ctx, tone, title) {
    const d = (ctx.payload && ctx.payload.display) || { plate: "", customer: "" };
    return { header: "moto24 · บอทต่อภาษี — " + d.plate + " · " + d.customer, tone, title, done: [], todo: [], dlt: [], notes: [] };
  }

  function addLine(parent, text, style) {
    const p = document.createElement("div");
    p.textContent = text;
    if (style) p.setAttribute("style", style);
    parent.appendChild(p);
  }

  function addList(parent, title, items) {
    if (!items || !items.length) return;
    addLine(parent, title, "margin-top:4px;font-size:12px;font-weight:600;color:#374151");
    const ul = document.createElement("ul");
    ul.setAttribute("style", "margin:0;padding-left:18px");
    for (const it of items) {
      const li = document.createElement("li");
      li.textContent = it; // textContent เท่านั้น — ข้อความจากกรมไม่ใช่ HTML ที่ไว้ใจได้
      li.setAttribute("style", "white-space:pre-wrap");
      ul.appendChild(li);
    }
    parent.appendChild(ul);
  }

  /** แถบคงที่ด้านบน เหนือ overlay ของ PrimeFaces · render ใหม่ทั้งก้อนทุกครั้ง · ห้าม throw */
  function renderBanner(view) {
    try {
      const old = byId("moto24-dlt-banner");
      if (old) old.remove();
      const tone = TONES[view.tone] || TONES.info;
      const bar = document.createElement("div");
      bar.id = "moto24-dlt-banner";
      bar.setAttribute(
        "style",
        [
          "position:fixed", "top:0", "left:0", "right:0", "z-index:2147483647",
          "max-height:30vh", "overflow:auto", "background:" + tone[0],
          "border-bottom:3px solid " + tone[1], "color:#111827",
          "font:14px/1.5 Tahoma,sans-serif", "padding:6px 72px 6px 12px",
          "box-shadow:0 2px 8px rgba(0,0,0,.18)",
        ].join(";")
      );
      const hide = document.createElement("button");
      hide.type = "button";
      hide.textContent = "ซ่อน";
      hide.setAttribute("style", "position:absolute;top:6px;right:8px;border:1px solid #9ca3af;background:#fff;border-radius:4px;padding:0 8px;cursor:pointer");
      hide.addEventListener("click", () => {
        bar.style.display = "none";
      });
      bar.appendChild(hide);
      addLine(bar, view.header, "font-size:12px;color:#4b5563");
      addLine(bar, view.title, "font-weight:600");
      addList(bar, "บอททำแล้ว", view.done);
      addList(bar, "เหลือให้ทำเอง", view.todo);
      addList(bar, "ข้อความจากกรม (คำต่อคำ)", view.dlt);
      addList(bar, "หมายเหตุ", view.notes);
      (document.body || document.documentElement).appendChild(bar);
    } catch (err) {
      console.warn("[moto24-dlt] banner", err);
    }
  }

  function finish(ctx, view, outcome, error) {
    post(ctx, error ? { type: "final", outcome, error } : { type: "final", outcome });
    view.tone = OUTCOME_TONE[outcome] || "info";
    view.title = "บอทจบรอบ: " + (L.OUTCOME_TEXT[outcome] || outcome);
    if (error) view.notes.push("ข้อผิดพลาด: " + error);
  }

  // ── esv02i001: ลงทะเบียนรถ ──────────────────────────────────────────────

  async function fillVehicleForm(ctx) {
    const p = ctx.payload;
    const fields = { filled: [], skipped: [], values: {} };
    noteCombo(fields, "vehicleType", await selectAutocomplete(W_VEHICLE, p.vehicleTypeLabel), p.vehicleTypeLabel);
    noteCombo(fields, "province", await selectAutocomplete(W_PROVINCE, p.provinceLabel), p.provinceLabel);
    fillText(fields, "plate1", "add_plate1", p.plate1);
    fillText(fields, "plate2", "add_plate2", p.plate2);
    await waitAjaxIdle(); // blur ของ plate2 ยิง AJAX ค้นรถ — ต้องเสร็จก่อนกดบันทึก
    postFields(ctx, fields);
    return fields;
  }

  function fillOwnerName(ctx, name) {
    const el = byId("add_ownName");
    if (!el) throw new Error("ไม่พบช่องชื่อผู้ถือกรรมสิทธิ์ (add_ownName)");
    const got = setValue(el, name);
    post(ctx, { type: "fields", filled: ["ownerName"], values: { ownerName: got } });
  }

  /** กดบันทึกแล้วรอข้อความ — ⚠️ หลังตอบกลับ ฟอร์มถูก render ใหม่ (Gotcha 10) ⇒ query element ใหม่ทุกครั้ง
   *  dialog ที่มองเห็นแต่ยังว่าง (L.isBlankDialogText) ⇒ กรมยังไม่ตอบ รอต่อ ไม่ใช่คำตอบ (review fix) ·
   *  ไม่มี dialog เลยจนหมดเวลา ⇒ null · มีแต่ว่างตลอดจนหมดเวลา ⇒ "" (ให้ผู้เรียกแยกสองกรณีนี้) */
  async function clickSaveAndRead() {
    await closeMessageDialog();
    const btn = byId("add_searchBtn");
    if (!btn) throw new Error("ไม่พบปุ่มบันทึก (add_searchBtn)");
    click(btn);
    await waitAjaxIdle();
    let sawBlank = false;
    for (let t = 0; t < 25; t++) {
      ensureNotStopped();
      const msg = readMessageDialog();
      if (msg != null) {
        if (L.isBlankDialogText(msg)) sawBlank = true;
        else return msg;
      }
      await sleep(200);
    }
    return sawBlank ? "" : null;
  }

  /** รอคนเลือก autocomplete ที่บอทเลือกไม่ติด (ทางสำรองของ S1) */
  async function waitForHumanCombos(ctx, view, keys) {
    view.tone = "wait";
    view.title = "รอเจ้าหน้าที่เลือกจากรายการ";
    view.todo = ["เลือก " + keys.map((k) => COMBO_LABEL[k] || k).join(" และ ") + " จากรายการของช่องนั้นเอง — เลือกเสร็จแล้วบอทจะกดบันทึกต่อให้"];
    renderBanner(view);
    post(ctx, { type: "phase", phase: "waiting_manual" });
    const deadline = Date.now() + MANUAL_WAIT_MS;
    let lastBeat = Date.now();
    let readySince = 0;
    while (Date.now() < deadline) {
      ensureNotStopped();
      await sleep(500);
      if (Date.now() - lastBeat > HEARTBEAT_MS) {
        post(ctx, { type: "heartbeat" });
        lastBeat = Date.now();
      }
      const dlgMsg = readMessageDialog();
      if (dlgMsg != null && !L.isBlankDialogText(dlgMsg)) return "officer_took_over";
      const ready = keys.every((k) => {
        const s = comboState(COMBO_WIDGET[k]);
        return !!s && s.shown !== "" && s.hidden !== "";
      });
      if (!ready) {
        readySince = 0;
        continue;
      }
      if (!readySince) readySince = Date.now();
      if (Date.now() - readySince >= 1500) {
        const values = {};
        for (const k of keys) values[k] = comboState(COMBO_WIDGET[k]).shown;
        post(ctx, { type: "fields", filled: keys, values });
        post(ctx, { type: "note", event: "officer_selected:" + keys.join(",") });
        post(ctx, { type: "phase", phase: "registering" });
        view.tone = "info";
        view.title = "บอทกำลังลงทะเบียนรถ";
        view.todo = [];
        renderBanner(view);
        return "ready";
      }
    }
    return "timeout";
  }

  /** ไม่ผ่านทั้งสองชื่อ / ช่องว่างซ้ำ ⇒ ให้คนแก้แล้วกดบันทึกเอง · จดชื่อที่คนพิมพ์ (source: officer) */
  async function waitForOfficerRegistration(ctx, view, rejectedBefore, tookOver) {
    const p = ctx.payload;
    let rejected = rejectedBefore;
    view.tone = "wait";
    view.title = "รอเจ้าหน้าที่ลงทะเบียนรถเอง";
    view.todo = [
      "แก้ชื่อผู้ถือกรรมสิทธิ์ตามเล่มทะเบียน (และช่องที่ยังว่าง) แล้วกด บันทึก เอง",
      "ลงทะเบียนสำเร็จแล้วบอทจะกดยื่นชำระภาษีต่อให้",
    ];
    renderBanner(view);
    post(ctx, { type: "phase", phase: "waiting_manual" });

    function snapshot() {
      const name = byId("add_ownName");
      const prov = comboState(W_PROVINCE);
      return { name: name ? L.normText(name.value) : "", province: prov ? prov.shown : null };
    }
    let pending = tookOver ? snapshot() : null;
    let handled = tookOver ? null : readMessageDialog();
    function onSaveClick(e) {
      const hit = e.target && e.target.closest ? e.target.closest("#add_searchBtn") : null;
      if (hit) pending = snapshot();
    }
    document.addEventListener("click", onSaveClick, true);
    const deadline = Date.now() + MANUAL_WAIT_MS;
    let lastBeat = Date.now();
    let sawBlankDialog = false;
    try {
      while (Date.now() < deadline) {
        ensureNotStopped();
        await sleep(600);
        ensureNotStopped();
        if (Date.now() - lastBeat > HEARTBEAT_MS) {
          post(ctx, { type: "heartbeat" });
          lastBeat = Date.now();
        }
        const msg = readMessageDialog();
        if (msg == null) {
          handled = null;
          continue;
        }
        if (L.isBlankDialogText(msg)) {
          // dialog มองเห็นแต่ยังว่าง ⇒ กรมยังไม่ตอบ รอต่อ ไม่ใช่คำตอบ (review fix)
          sawBlankDialog = true;
          handled = null;
          continue;
        }
        if (msg === handled) continue;
        handled = msg;
        const kind = L.classifyDltMessage(msg);
        post(ctx, { type: "dlt_message", page: "esv02i001", kind, text: msg });
        const attempt = pending;
        pending = null;
        if (attempt && (kind === "registered" || kind === "owner_mismatch")) {
          const ev = { type: "name_attempt", name: attempt.name, source: "officer", accepted: kind === "registered" };
          if (kind === "owner_mismatch") ev.dltMessage = msg;
          post(ctx, ev);
        }
        if (kind === "owner_mismatch") rejected = true;
        if (kind === "registered") {
          post(ctx, { type: "registration", value: "registered" });
          view.done.push("เจ้าหน้าที่ลงทะเบียนรถสำเร็จ");
          await closeMessageDialog();
          await waitAjaxIdle();
          return { final: false, target: { plate1: p.plate1, plate2: p.plate2, province: (attempt && attempt.province) || p.provinceLabel } };
        }
        if (kind === "unknown") {
          // ข้อความที่ไม่รู้จัก (รวมลงทะเบียนซ้ำ — Gotcha 5) ⇒ ไม่เดาความหมาย ไม่รอต่อจนหมดเวลา
          view.dlt.push(msg);
          finish(ctx, view, "dlt_blocked");
          return { final: true };
        }
      }
      // เคยถูกปฏิเสธชื่อ = กรมตอบแล้ว ⇒ name_rejected ชนะ dialog ว่างที่แวบมา
      if (sawBlankDialog && !rejected) {
        finish(ctx, view, "bot_error", "dialog ของกรมว่าง");
      } else {
        finish(ctx, view, rejected ? "name_rejected" : "timeout");
      }
      return { final: true };
    } finally {
      document.removeEventListener("click", onSaveClick, true);
    }
  }

  function sourceWord(source) {
    return source === "company" ? "บริษัท" : "ลูกค้า";
  }

  async function registerVehicle(ctx, view) {
    const p = ctx.payload;
    if (!isVisible(byId("add_plate1"))) {
      const open = byId("search_esvCarRegistGotoAddTableBtn");
      if (!open) throw new Error("ไม่พบปุ่มเปิดฟอร์มลงทะเบียนรถ (search_esvCarRegistGotoAddTableBtn)");
      click(open);
      await waitAjaxIdle();
    }
    if (!byId("add_plate1")) throw new Error("ไม่พบฟอร์มลงทะเบียนรถ (add_plate1)");
    view.title = "บอทกำลังลงทะเบียนรถ";
    renderBanner(view);

    const fields = await fillVehicleForm(ctx);
    const missing = ["vehicleType", "province"].filter((k) => !fields.filled.includes(k));
    if (missing.length) {
      const w = await waitForHumanCombos(ctx, view, missing);
      if (w === "timeout") {
        finish(ctx, view, "timeout");
        return { final: true };
      }
      if (w === "officer_took_over") return waitForOfficerRegistration(ctx, view, false, true);
    }

    const names = p.ownerNames.slice(0, 2); // 🔒 ลองไม่เกิน 2 ชื่อ (spec D2)
    let rejected = false;
    let retriedEmpty = false;
    let i = 0;
    while (i < names.length) {
      const n = names[i];
      fillOwnerName(ctx, n.value);
      const msg = await clickSaveAndRead();
      if (msg == null) {
        finish(ctx, view, "bot_error", "กดบันทึกแล้วไม่มีข้อความจากกรม");
        return { final: true };
      }
      if (L.isBlankDialogText(msg)) {
        finish(ctx, view, "bot_error", "dialog ของกรมว่าง");
        return { final: true };
      }
      const kind = L.classifyDltMessage(msg);
      post(ctx, { type: "dlt_message", page: "esv02i001", kind, text: msg });

      if (kind === "registered") {
        post(ctx, { type: "name_attempt", name: n.value, source: n.source, accepted: true });
        post(ctx, { type: "registration", value: "registered" });
        view.done.push("ลงทะเบียนรถสำเร็จด้วยชื่อ" + sourceWord(n.source));
        const prov = comboState(W_PROVINCE);
        await closeMessageDialog();
        await waitAjaxIdle();
        return { final: false, target: { plate1: p.plate1, plate2: p.plate2, province: p.provinceLabel || (prov && prov.shown) || null } };
      }
      if (kind === "owner_mismatch") {
        rejected = true;
        post(ctx, { type: "name_attempt", name: n.value, source: n.source, accepted: false, dltMessage: msg });
        view.done.push("ลองชื่อ" + sourceWord(n.source) + " — กรมตอบว่าไม่ตรง");
        view.dlt.push(msg);
        await closeMessageDialog();
        i += 1; // ช่องอื่นยังอยู่ — เปลี่ยนแค่ชื่อแล้วกดใหม่
        continue;
      }
      if (kind === "field_empty") {
        await closeMessageDialog();
        post(ctx, { type: "fields", skipped: L.emptyFieldsFromMessage(msg).map((f) => ({ field: f, reason: "dlt_says_empty", value: null })) });
        view.dlt.push(msg);
        if (retriedEmpty) break;
        retriedEmpty = true;
        // ฟอร์มถูก render ใหม่ ⇒ autocomplete ว่าง (Gotcha 10) — กรอกหมวด/เลขใหม่แล้วให้คนเลือกสองช่อง
        const refill = { filled: [], skipped: [], values: {} };
        fillText(refill, "plate1", "add_plate1", p.plate1);
        fillText(refill, "plate2", "add_plate2", p.plate2);
        postFields(ctx, refill);
        const w = await waitForHumanCombos(ctx, view, ["vehicleType", "province"]);
        if (w === "timeout") {
          finish(ctx, view, "timeout");
          return { final: true };
        }
        if (w === "officer_took_over") return waitForOfficerRegistration(ctx, view, rejected, true);
        // คนเพิ่งเลือกจังหวัด/ประเภท ⇒ blur plate2 ซ้ำให้กรมค้นรถด้วยค่าชุดใหม่ก่อนบันทึก
        fillText(refill, "plate2", "add_plate2", p.plate2);
        await waitAjaxIdle();
        continue; // ลองชื่อเดิมอีกครั้ง — ช่องว่างไม่ใช่ชื่อผิด จึงไม่นับเป็นการลองชื่อ
      }
      // ข้อความที่ไม่รู้จัก ⇒ ไม่เดาความหมาย (spec §6.7) — ทิ้ง dialog ไว้ให้เจ้าหน้าที่อ่าน
      view.dlt.push(msg);
      finish(ctx, view, "dlt_blocked");
      return { final: true };
    }
    return waitForOfficerRegistration(ctx, view, rejected, false);
  }

  /** ปุ่มยื่นของแถว: ผ่าน ⇒ redirect เต็มหน้าไป taxAgreement (สคริปต์นี้หายไปพร้อมหน้า) · ไม่ผ่าน ⇒ dialog ในหน้าเดิม */
  async function submitRow(ctx, view, index) {
    await closeMessageDialog();
    const table = readTable();
    const btn = table ? submitButtonOf(table, index) : null;
    if (!btn) throw new Error("ไม่พบปุ่มยื่นชำระภาษีของแถว");
    post(ctx, { type: "phase", phase: "submitting_row" });
    view.title = "บอทกดยื่นชำระภาษี — กรมกำลังตรวจ";
    renderBanner(view);
    click(btn);
    await waitAjaxIdle();
    const deadline = Date.now() + ROW_SUBMIT_WAIT_MS;
    let sawBlank = false;
    while (Date.now() < deadline) {
      ensureNotStopped();
      const msg = readMessageDialog();
      if (msg != null) {
        if (L.isBlankDialogText(msg)) {
          // dialog มองเห็นแต่ยังว่าง ⇒ กรมยังไม่ตอบ รอต่อ ไม่ใช่คำตอบ (review fix)
          sawBlank = true;
        } else {
          post(ctx, { type: "dlt_message", page: "esv02i001", kind: "row_submit", text: msg });
          const d = L.parseThaiDate(msg);
          if (d && msg.includes("สิ้นอายุภาษี")) post(ctx, { type: "dlt_says", taxExpiry: d });
          view.dlt.push(msg);
          finish(ctx, view, "dlt_blocked");
          return;
        }
      }
      await sleep(200);
    }
    finish(
      ctx,
      view,
      "bot_error",
      sawBlank ? "dialog ของกรมว่าง" : "กดยื่นชำระภาษีแล้วไม่มีการตอบกลับจากกรมภายใน 30 วินาที"
    );
  }

  async function runRegister(ctx) {
    if (stopped()) return;
    const view = newView(ctx, "info", "บอทกำลังค้นรถในรายการ");
    let haltedSilently = false;
    try {
      renderBanner(view);
      await waitAjaxIdle();
      const p = ctx.payload;
      let found = L.findListedRow(readTable(), { plate1: p.plate1, plate2: p.plate2, province: p.provinceLabel });
      if (found) {
        post(ctx, { type: "registration", value: "already_listed", ownerName: found.ownerName });
        view.done.push("พบรถในรายการของบัญชีนี้แล้ว — ไม่ต้องลงทะเบียนซ้ำ");
      } else {
        if (L.hasMorePages(readPaginatorInfo())) {
          // ไม่ auto-page (paginator ยังไม่ได้วัด DOM จริง) — แค่เตือนความเสี่ยงลงทะเบียนซ้ำ (review fix)
          post(ctx, { type: "note", event: "vehicle_table_may_have_more_pages" });
          view.notes.push("รถอาจอยู่หน้าถัดไปของตารางรายการรถ — ถ้ากรมตอบว่าลงทะเบียนซ้ำ ให้ค้นในตารางเอง");
        }
        const reg = await registerVehicle(ctx, view);
        if (reg.final) return;
        found = L.findListedRow(readTable(), reg.target);
        if (!found) {
          // ตารางยังไม่ render แถวใหม่ — โหลดหน้าใหม่ครั้งเดียว รอบหน้าจะเจอเป็น already_listed
          if (((ctx.visits && ctx.visits.register) || 0) <= 2) {
            post(ctx, { type: "note", event: "reload_after_register" });
            view.notes.push("โหลดหน้าใหม่เพื่อหาแถวที่เพิ่งลงทะเบียน");
            window.location.reload();
            return;
          }
          finish(ctx, view, "bot_error", "ลงทะเบียนแล้วแต่ไม่พบรถในตาราง");
          return;
        }
      }
      await submitRow(ctx, view, found.index);
    } catch (err) {
      if (err instanceof StoppedError) {
        haltedSilently = true;
        return;
      }
      finish(ctx, view, "bot_error", errText(err));
    } finally {
      if (!haltedSilently) renderBanner(view);
    }
  }

  // ── หน้าอื่น ────────────────────────────────────────────────────────────

  async function onLoginPage(ctx) {
    if (stopped()) return;
    const view = newView(ctx, "wait", "ล็อกอินด้วย Digital ID แล้วบอทจะทำต่อเอง");
    let haltedSilently = false;
    try {
      renderBanner(view);
      // dialog ประกาศของกรมขึ้นช้ากว่าหน้าโหลด — รอสูงสุด 5 วิ
      for (let t = 0; t < 25; t++) {
        ensureNotStopped();
        const dlg = byId("popupOptionalAnnounce");
        const x = document.querySelector("#popupOptionalAnnounce .ui-dialog-titlebar-close");
        if (dlg && x && isVisible(dlg)) {
          click(x);
          view.done.push("ปิดประกาศของกรมให้แล้ว");
          break;
        }
        await sleep(200);
      }
    } catch (err) {
      if (err instanceof StoppedError) {
        haltedSilently = true;
        return;
      }
      view.notes.push("ปิดประกาศไม่ได้ — ปิดเองได้: " + errText(err)); // ไม่จบรอบ
    } finally {
      if (!haltedSilently) renderBanner(view);
    }
  }

  async function onAgreementPage(ctx) {
    const view = newView(ctx, "wait", "กด ตกลง แล้วกด ยอมรับ เพื่อไปต่อ — บอทไม่กดให้");
    try {
      view.done.push("กรมให้ยื่นชำระภาษีรถคันนี้ได้");
      view.todo.push("อ่านข้อตกลง กด ตกลง ที่กล่องแจ้งอีเมล แล้วกด ยอมรับ — บอทจะอ่านหน้ายื่นภาษีต่อเอง");
    } finally {
      renderBanner(view);
    }
  }

  function visibleDialogIds(prefix) {
    return Array.from(document.querySelectorAll('.ui-dialog[id^="' + prefix + '"]'))
      .filter(isVisible)
      .map((d) => d.id);
  }

  function dialogText(id) {
    const d = byId(id);
    const c = d ? d.querySelector(".ui-dialog-content") : null;
    return c ? c.innerText.trim() : "";
  }

  function policyFlagState() {
    const inputs = Array.from(document.querySelectorAll('input[name="editPage1_policyFlag"]'));
    const state = { selected: null, enabled: {}, labels: {} };
    for (const input of inputs) {
      state.enabled[input.value] = !input.disabled;
      if (input.checked) state.selected = input.value;
      const lab = input.id ? document.querySelector('label[for="' + input.id + '"]') : null;
      state.labels[input.value] = lab ? L.normText(lab.innerText) : "";
    }
    return state;
  }

  async function runTaxForm(ctx) {
    if (stopped()) return;
    const view = newView(ctx, "info", "บอทกำลังอ่านหน้ายื่นภาษี");
    let haltedSilently = false;
    try {
      renderBanner(view);
      await waitAjaxIdle();
      let ids = [];
      for (let t = 0; t < 50; t++) {
        ensureNotStopped();
        ids = visibleDialogIds("editPage1_");
        if (ids.length) break;
        await sleep(200);
      }
      const flags = policyFlagState();
      for (const id of ids) {
        const text = dialogText(id);
        post(ctx, { type: "dlt_message", page: "esv02i002", kind: id, text });
        view.dlt.push(text);
      }

      const cells = Array.from(document.querySelectorAll("#editPage1_editDetailGrid td")).map((td) => td.innerText);
      const grid = L.pickDetailValues(cells);
      const says = {};
      if (grid.taxExpiry) says.taxExpiry = { raw: grid.taxExpiry, iso: (L.parseThaiDate(grid.taxExpiry) || {}).iso || null };
      if (grid.nextTaxExpiry) says.nextTaxExpiry = { raw: grid.nextTaxExpiry, iso: (L.parseThaiDate(grid.nextTaxExpiry) || {}).iso || null };
      says.amounts = AMOUNT_FIELDS.map(([id, label]) => ({ label, raw: readValue(id) })).filter((a) => a.raw);
      if (flags.selected) says.prbInfo = flags.labels[flags.selected] || "policyFlag=" + flags.selected;
      const siteVersion = L.findSiteVersion(document.body ? document.body.innerText.slice(-3000) : "");
      if (siteVersion) says.siteVersion = siteVersion;
      post(ctx, Object.assign({ type: "dlt_says" }, says));

      // เลขไมล์: กรมไม่บังคับ (spike S2) — กรอกเฉพาะเมื่อ payload มีค่า · radio พ.ร.บ. ไม่แตะ แค่จดค่า
      const f = { filled: [], skipped: [], values: { policyFlag: flags.selected || "" } };
      if (ctx.payload.mileage) fillText(f, "mileage", "editPage1_mileage", ctx.payload.mileage);
      else f.skipped.push({ field: "mileage", reason: "no_data", value: null });
      postFields(ctx, f);

      const verdict = L.classifyTaxFormDialogs(ids, flags);
      if (verdict === "prb_ok") {
        view.done.push("กรมพบ พ.ร.บ. — ทำรายการต่อได้");
        finish(ctx, view, "ready_to_submit");
        view.title = "บอทหยุดตรงนี้ — ที่เหลือทำเอง";
        view.todo = ["กด ตกลง ที่กล่องข้อความของกรม", "กรอกสถานที่จัดส่งเอกสาร", "เลือกช่องทางชำระเงิน"];
      } else if (verdict === "prb_not_found") {
        finish(ctx, view, "prb_not_found");
      } else if (verdict === "dlt_blocked") {
        finish(ctx, view, "dlt_blocked");
      } else {
        finish(ctx, view, "bot_error", "ไม่พบผลตรวจ พ.ร.บ. บนหน้ายื่นภาษี");
      }
    } catch (err) {
      if (err instanceof StoppedError) {
        haltedSilently = true;
        return;
      }
      finish(ctx, view, "bot_error", errText(err));
    } finally {
      if (!haltedSilently) renderBanner(view);
    }
  }

  /** แบนเนอร์ของรอบที่จบแล้วจากฝั่ง service worker (superseded / timeout / unexpected_page)
   *  ⇒ ตั้ง stopped() ให้เป็น true ทันที กันขั้นที่ยังค้างอยู่ในหน้าเดิมกด/กรอก/วาดแบนเนอร์ทับต่อ (review fix) */
  function showFinal(ctx) {
    window.__moto24DltStopped = true;
    const r = ctx.result;
    const outcome = r ? r.outcome : null;
    const view = newView(ctx, OUTCOME_TONE[outcome] || "info", "บอทจบรอบ: " + (outcome ? L.OUTCOME_TEXT[outcome] || outcome : "—"));
    if (outcome === "superseded") view.notes.push("มีการสั่งงานใหม่จาก moto24 — แท็บนี้ไม่ถูกติดตามแล้ว");
    if (outcome === "unexpected_page") view.notes.push("บอทไม่รู้จักหน้านี้ — ทำต่อเองได้ แล้วกลับไปรันบอทใหม่จาก moto24");
    renderBanner(view);
  }

  /** กันสองขั้นรันพร้อมกันในหน้าเดียว (เช่น service worker ยิง tabs.onUpdated(complete) ซ้ำ) —
   *  ขั้นที่สองถูกละไว้ ไม่ใช่ตัวหลอกให้เข้าใจว่าขั้นแรกก็หยุดด้วย (review fix) */
  function withActiveGuard(name, fn) {
    return async function (ctx) {
      if (window.__moto24DltActiveStep) {
        try {
          post(ctx, { type: "note", event: "duplicate_step_ignored:" + name });
        } catch (e) {
          // post ล้มเหลว ⇒ ยังคงละขั้นซ้ำต่อไปเงียบ ๆ
        }
        return;
      }
      window.__moto24DltActiveStep = name;
      try {
        await fn(ctx);
      } finally {
        window.__moto24DltActiveStep = null;
      }
    };
  }

  window.__moto24DltSteps = {
    onLoginPage: withActiveGuard("onLoginPage", onLoginPage),
    runRegister: withActiveGuard("runRegister", runRegister),
    onAgreementPage: withActiveGuard("onAgreementPage", onAgreementPage),
    runTaxForm: withActiveGuard("runTaxForm", runTaxForm),
    showFinal, // อ่าน/วาดแบนเนอร์อย่างเดียว ไม่กด ไม่กรอก — ไม่ต้องกันซ้อน
  };
})();
