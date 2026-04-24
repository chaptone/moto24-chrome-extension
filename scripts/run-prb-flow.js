// scripts/run-prb-flow.js — Moto24 พรบ Auto-Fill
//
// This module exports the `runPRBFlow` page-function that the service worker
// passes to chrome.scripting.executeScript({func}). It runs inside the RVP
// page context (or dummy form page), filled with the payload as its sole arg.
//
// The function MUST be self-contained: no closure references to outer scope
// (Chrome serializes the function body via .toString()). All helpers live
// inside the function.

/**
 * @typedef {Object} PRBPayload
 * @property {string} chassisNumber                Required.
 * @property {string|null} customerPrefix          RVP Prefix value (e.g. "นาย").
 * @property {string|null} customerFirstName
 * @property {string|null} customerLastName
 * @property {string|null} marqueValue             RVP MARQUE value (e.g. "ฮอนด้า").
 * @property {string|null} productModelDesc        Reference only — never filled.
 */

/**
 * @typedef {Object} SkippedField
 * @property {string} field
 * @property {string=} value
 * @property {string} reason
 */

/**
 * @typedef {(
 *   | { success: true, filled: string[], skipped: SkippedField[] }
 *   | { success: false, error: string }
 * )} PRBResult
 */

/**
 * Runs the PRB autofill inside the current page. Injected via
 * chrome.scripting.executeScript({func: runPRBFlow, args: [payload]}).
 *
 * @param {PRBPayload} payload
 * @returns {Promise<PRBResult>}
 */
async function runPRBFlow(payload) {
  const filled = [];
  const skipped = [];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- 1. Dismiss PDPA modal if present ---------------------------------
  for (let i = 0; i < 20; i++) {
    const modal = document.querySelector("#ModalStaticBackdrop");
    if (!modal) break;
    const img = document.querySelector("#imgEvent img, #imgEvent > img");
    if (img) img.click();
    await sleep(100);
  }
  // At this point the modal should be gone. If not, we proceed anyway —
  // the form fields may still be reachable underneath on some pages.

  // --- 2. Wait for form ready -------------------------------------------
  let formReady = false;
  for (let i = 0; i < 50; i++) {
    if (document.querySelector("#MARQUE") && document.querySelector("#CarTankNo")) {
      formReady = true;
      break;
    }
    await sleep(100);
  }
  if (!formReady) {
    return {
      success: false,
      error: "RVP อาจเปลี่ยนโครงสร้างหน้าเว็บ",
    };
  }

  // --- 3. Fill fields (best-effort) --------------------------------------
  // Native setter trick for plain textboxes.
  function setTextboxValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Select2-compat: set .value then trigger change via jQuery ONCE.
  // jQuery-missing warning is recorded at most once per fill (dedup).
  let jqueryWarned = false;
  function setSelectValue(el, value) {
    el.value = value;
    if (window.jQuery) {
      window.jQuery(el).trigger("change");
    } else {
      // Fallback: native change. Less reliable on Select2 but the dummy
      // site uses plain <select> so it works there.
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if (!jqueryWarned) {
        skipped.push({
          field: "_environment",
          reason: "jQuery ไม่พบในหน้านี้ (ใช้ native event แทน)",
        });
        jqueryWarned = true;
      }
    }
  }

  // a. chassisNumber (required — hard-fail if setting fails)
  const chassisEl = document.querySelector("#CarTankNo");
  if (chassisEl) {
    setTextboxValue(chassisEl, payload.chassisNumber);
    filled.push("chassisNumber");
  } else {
    return { success: false, error: "ไม่พบช่องเลขตัวถัง (#CarTankNo)" };
  }

  // b. customerPrefix
  if (payload.customerPrefix !== null) {
    const prefixEl = document.querySelector("#Prefix");
    if (prefixEl) {
      setSelectValue(prefixEl, payload.customerPrefix);
      filled.push("customerPrefix");
    } else {
      skipped.push({ field: "customerPrefix", reason: "ไม่พบช่องคำนำหน้า (#Prefix)" });
    }
  } else {
    skipped.push({
      field: "customerPrefix",
      reason: "ไม่พบคำนำหน้าที่รองรับในข้อมูลลูกค้า",
    });
  }

  // c. customerFirstName
  if (payload.customerFirstName !== null) {
    const nameEl = document.querySelector("#Name");
    if (nameEl) {
      setTextboxValue(nameEl, payload.customerFirstName);
      filled.push("customerFirstName");
    } else {
      skipped.push({ field: "customerFirstName", reason: "ไม่พบช่องชื่อ (#Name)" });
    }
  } else {
    skipped.push({ field: "customerFirstName", reason: "ไม่มีข้อมูลชื่อ" });
  }

  // d. customerLastName
  if (payload.customerLastName !== null) {
    const lnameEl = document.querySelector("#Lname");
    if (lnameEl) {
      setTextboxValue(lnameEl, payload.customerLastName);
      filled.push("customerLastName");
    } else {
      skipped.push({ field: "customerLastName", reason: "ไม่พบช่องนามสกุล (#Lname)" });
    }
  } else {
    skipped.push({ field: "customerLastName", reason: "ไม่มีข้อมูลนามสกุล" });
  }

  // e. marqueValue
  let marqueWasSet = false;
  if (payload.marqueValue !== null) {
    const marqueEl = document.querySelector("#MARQUE");
    if (marqueEl) {
      setSelectValue(marqueEl, payload.marqueValue);
      filled.push("marqueValue");
      marqueWasSet = true;
    } else {
      skipped.push({ field: "marqueValue", reason: "ไม่พบช่องยี่ห้อรถ (#MARQUE)" });
    }
  } else {
    skipped.push({ field: "marqueValue", reason: "ไม่มีในตารางแปลงยี่ห้อ" });
  }

  // f. productModelDesc — always skipped, with BC value as reference
  skipped.push({
    field: "productModelDesc",
    value: payload.productModelDesc ?? undefined,
    reason: "เลือกเองในรายการ",
  });

  // --- 4. Wait for CarModel cascade (only if MARQUE was set) ------------
  if (marqueWasSet) {
    const carModelEl = document.querySelector("#CarModel");
    if (carModelEl) {
      for (let i = 0; i < 30; i++) {
        if (carModelEl.options.length > 1) break;
        await sleep(100);
      }
      // Timeout is NOT an error — extension still reports success.
    }
  }

  return { success: true, filled, skipped };
}

// Expose for service worker. Note: chrome.scripting.executeScript({func})
// does not need this global binding (the function is passed directly),
// but having it available makes the file importable for unit testing or
// manual inspection from DevTools.
// eslint-disable-next-line no-unused-vars
globalThis.runPRBFlow = runPRBFlow;
