// scripts/run-prb-flow.js — Moto24 พรบ Auto-Fill (v0.4.0 — P3 widening)
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
 * @property {string} chassisNumber
 * @property {string|null} marqueValue
 * @property {string|null} carColorValue
 * @property {string|null} carSize
 * @property {string|null} carTypeValue
 * @property {string|null} customerPrefix
 * @property {string|null} customerFirstName
 * @property {string|null} customerLastName
 * @property {string|null} cardId
 * @property {string|null} cardTypeValue
 * @property {string|null} birthdate
 * @property {("01"|"02"|null)} nationType
 * @property {string|null} nationalityOTH
 * @property {string|null} address
 * @property {string|null} changwatCode
 * @property {string|null} amphurName
 * @property {string|null} tumbolName
 * @property {string|null} zipcode
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

  // ── helpers ────────────────────────────────────────────────────────────

  function setText(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setSelectViaJQuery(el, value) {
    el.value = value;
    if (window.jQuery) {
      window.jQuery(el).trigger("change");
    } else {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  /**
   * Set a <select> by matching the visible option label (textContent),
   * not the underlying option value. Used for #CarModel where option
   * values are opaque B0084**** codes the resolver doesn't (and shouldn't)
   * know. The payload carries the user-visible label ("WAVE110i", "SCOOPY I",
   * etc.); this helper finds the matching <option>, copies its value to
   * el.value, then triggers the change event Select2 listens for.
   *
   * If no option matches the label, leaves el.value unchanged and returns
   * false. The caller's verify-after-set step then records `value_did_not_take`.
   */
  function setSelectByLabel(el, label) {
    const target = String(label).trim();
    for (const opt of el.options) {
      if (opt.textContent.trim() === target) {
        el.value = opt.value;
        if (window.jQuery) {
          window.jQuery(el).trigger("change");
        } else {
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return true;
      }
    }
    return false;
  }

  function setRadio(name, value) {
    const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (el) el.click();
  }

  async function dismissPDPAModalIfPresent() {
    for (let i = 0; i < 20; i++) {
      const modal = document.querySelector("#ModalStaticBackdrop");
      if (!modal) break;
      const img = document.querySelector("#imgEvent img, #imgEvent > img");
      if (img) img.click();
      await sleep(100);
    }
  }

  async function waitForFormReady() {
    for (let i = 0; i < 50; i++) {
      if (document.querySelector("#MARQUE") && document.querySelector("#CarTankNo")) return true;
      await sleep(100);
    }
    return false;
  }

  // Polls a select for an option whose visible text matches targetName.
  // Returns the option's `value` once found, or null on timeout / definite miss.
  async function waitAndLookup(selector, targetName, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const sel = document.querySelector(selector);
      if (sel && sel.options.length > 1) {
        const match = Array.from(sel.options).find(
          (o) => o.text.trim() === targetName.trim()
        );
        if (match) return match.value;
        // Heuristic: if the select is well-populated but our name isn't there,
        // it's a definitive miss — don't waste the rest of the timeout.
        if (sel.options.length > 5) return null;
      }
      await sleep(100);
    }
    return null;
  }

  // ── 1. Dismiss PDPA + wait for form ────────────────────────────────────

  await dismissPDPAModalIfPresent();
  const ready = await waitForFormReady();
  if (!ready) return { success: false, error: "RVP อาจเปลี่ยนโครงสร้างหน้าเว็บ" };

  // Chassis is the only true required field. If the selector is missing the
  // form layout has changed beyond what we can recover from.
  if (!document.querySelector("#CarTankNo")) {
    return { success: false, error: "ไม่พบช่องเลขตัวถัง (#CarTankNo)" };
  }

  // ── 2. Simple non-cascade fields (each isolated) ───────────────────────

  // Order matters — RVP triggers reactive resets between fields:
  //   • Setting #MARQUE fires an AJAX cascade that repopulates #CarModel
  //     options AND resets #CarColor to "". Mark cascadeAfter:true to gate
  //     the loop on cascade completion before continuing.
  //   • Setting #CarType wipes #CarSize. Verified live 2026-04-26.
  //     → CarType MUST come before CarSize.
  // Verified live in real RVP /Policy/New that this order keeps all values.
  const SIMPLE_FIELDS = [
    { key: "chassisNumber",     selector: "#CarTankNo", setter: setText },
    { key: "marqueValue",       selector: "#MARQUE",    setter: setSelectViaJQuery, cascadeAfter: true },
    { key: "carModelValue",     selector: "#CarModel",  setter: setSelectByLabel,   verifyLabel: true },
    { key: "carColorValue",     selector: "#CarColor",  setter: setSelectViaJQuery },
    { key: "carTypeValue",      selector: "#CarType",   setter: setSelectViaJQuery },
    { key: "carSize",           selector: "#CarSize",   setter: setText },
    { key: "customerPrefix",    selector: "#Prefix",    setter: setSelectViaJQuery },
    { key: "customerFirstName", selector: "#Name",      setter: setText },
    { key: "customerLastName",  selector: "#Lname",     setter: setText },
    { key: "customerPhone",     selector: "#Tel",       setter: setText },
    { key: "cardId",            selector: "#CardID",    setter: setText },
    { key: "cardTypeValue",     selector: "#CardType",  setter: setSelectViaJQuery },
    { key: "birthdate",         selector: "#Birthdate", setter: setText },
    { key: "address",           selector: "#Address",   setter: setText },
    // NB: zipcode is set AFTER the address cascade, not here. Selecting a
    // Tumbol auto-populates #Zipcode with the tumbol's default zip — which
    // overrides BC's actual mailing zip if we set it earlier. See post-cascade
    // block below.
  ];

  async function waitForCarModelCascade(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const cm = document.querySelector("#CarModel");
      if (cm && cm.options.length > 1) return true;
      await sleep(50);
    }
    return false;
  }

  // Records simple-fields that PASSED their immediate verify, so the
  // end-of-flow re-verify pass can catch any cross-field wipes (e.g. setting
  // #CarType wiping #CarSize). Map: key → { selector, expected }.
  const filledExpected = new Map();

  for (const f of SIMPLE_FIELDS) {
    try {
      const value = payload[f.key];
      if (value == null) {
        skipped.push({ field: f.key, reason: "no_data" });
        continue;
      }
      const el = document.querySelector(f.selector);
      if (!el) {
        skipped.push({ field: f.key, reason: "selector_missing" });
        continue;
      }
      f.setter(el, value);
      // Verify the set "took". For label-setters, compare the option's
      // textContent against the payload label (since el.value is the
      // opaque option-value code, not the label).
      const tookValue = el.value !== "";
      const tookLabelMatch =
        !f.verifyLabel ||
        (el.selectedOptions[0] &&
          el.selectedOptions[0].textContent.trim() === String(value).trim());
      if (!tookValue || !tookLabelMatch) {
        skipped.push({
          field: f.key,
          value: String(value),
          reason: "value_did_not_take",
        });
        continue;
      }
      filled.push(f.key);
      filledExpected.set(f.key, { selector: f.selector, expected: el.value });
      if (f.cascadeAfter) {
        // Wait up to 2s for #CarModel to repopulate. Without this, the next
        // iteration's #CarColor set would race the cascade and get wiped.
        await waitForCarModelCascade(2000);
      }
    } catch (e) {
      skipped.push({ field: f.key, reason: String(e?.message || e) });
    }
  }

  // ── 3. Nationality block (isolated as a unit) ──────────────────────────

  try {
    if (payload.nationType) {
      setRadio("NationType", payload.nationType);
      filled.push("nationType");
      if (payload.nationType === "02" && payload.nationalityOTH) {
        const oth = document.querySelector("#NationalityOTH");
        if (!oth) {
          skipped.push({ field: "nationalityOTH", reason: "selector_missing" });
        } else {
          setSelectViaJQuery(oth, payload.nationalityOTH);
          if (oth.value !== String(payload.nationalityOTH)) {
            skipped.push({
              field: "nationalityOTH",
              value: String(payload.nationalityOTH),
              reason: "value_did_not_take",
            });
          } else {
            filled.push("nationalityOTH");
          }
        }
      }
    } else {
      skipped.push({ field: "nationType", reason: "no_data" });
    }
  } catch (e) {
    skipped.push({ field: "nationType", reason: String(e?.message || e) });
  }

  // ── 4. Address cascade ─────────────────────────────────────────────────

  await fillAddressCascade();

  // ── 5. Zipcode (POST-cascade) ──────────────────────────────────────────
  // Selecting Tumbol auto-populates #Zipcode with the tumbol's default zip,
  // which overrides BC's actual mailing zip. So zipcode goes here, not in
  // the simple-fields phase, to win the race.
  try {
    if (payload.zipcode == null) {
      skipped.push({ field: "zipcode", reason: "no_data" });
    } else {
      const zEl = document.querySelector("#Zipcode");
      if (!zEl) {
        skipped.push({ field: "zipcode", reason: "selector_missing" });
      } else {
        setText(zEl, payload.zipcode);
        if (zEl.value !== String(payload.zipcode)) {
          skipped.push({ field: "zipcode", value: String(payload.zipcode), reason: "value_did_not_take" });
        } else {
          filled.push("zipcode");
          filledExpected.set("zipcode", { selector: "#Zipcode", expected: String(payload.zipcode) });
        }
      }
    }
  } catch (e) {
    skipped.push({ field: "zipcode", reason: String(e?.message || e) });
  }

  // ── 6. End-of-flow re-verify pass ──────────────────────────────────────
  // Catches cross-field wipes (a later field's setter clobbering an earlier
  // field's value). The immediate per-field verify can only see the moment
  // right after each set; this pass sees the final settled state.
  for (const [key, { selector, expected }] of filledExpected) {
    const el = document.querySelector(selector);
    if (!el || el.value !== expected) {
      const idx = filled.indexOf(key);
      if (idx >= 0) filled.splice(idx, 1);
      skipped.push({ field: key, value: expected, reason: "wiped_by_later_field" });
    }
  }

  return { success: true, filled, skipped };

  // ── inner: address cascade ─────────────────────────────────────────────

  async function fillAddressCascade() {
    const { changwatCode, amphurName, tumbolName } = payload;

    if (!changwatCode) {
      skipped.push(
        { field: "changwat", reason: "no_data" },
        { field: "amphur",   reason: "skipped_dependency" },
        { field: "tumbol",   reason: "skipped_dependency" },
      );
      return;
    }
    try {
      const cw = document.querySelector("#Changwat");
      if (!cw) {
        skipped.push(
          { field: "changwat", reason: "selector_missing" },
          { field: "amphur",   reason: "skipped_dependency" },
          { field: "tumbol",   reason: "skipped_dependency" },
        );
        return;
      }
      setSelectViaJQuery(cw, changwatCode);
      filled.push("changwat");
    } catch (e) {
      skipped.push(
        { field: "changwat", reason: String(e?.message || e) },
        { field: "amphur",   reason: "skipped_dependency" },
        { field: "tumbol",   reason: "skipped_dependency" },
      );
      return;
    }

    if (!amphurName) {
      skipped.push(
        { field: "amphur", reason: "no_data" },
        { field: "tumbol", reason: "skipped_dependency" },
      );
      return;
    }
    const amphurCode = await waitAndLookup("#Amphur", amphurName, 3000);
    if (!amphurCode) {
      skipped.push(
        { field: "amphur", reason: `name_not_in_rvp:${amphurName}` },
        { field: "tumbol", reason: "skipped_dependency" },
      );
      return;
    }
    setSelectViaJQuery(document.querySelector("#Amphur"), amphurCode);
    filled.push("amphur");

    if (!tumbolName) {
      skipped.push({ field: "tumbol", reason: "no_data" });
      return;
    }
    const tumbolCode = await waitAndLookup("#Tumbol", tumbolName, 3000);
    if (!tumbolCode) {
      skipped.push({ field: "tumbol", reason: `name_not_in_rvp:${tumbolName}` });
      return;
    }
    setSelectViaJQuery(document.querySelector("#Tumbol"), tumbolCode);
    filled.push("tumbol");
  }
}

// Expose for service worker. Note: chrome.scripting.executeScript({func})
// does not need this global binding (the function is passed directly),
// but having it available makes the file importable for unit testing or
// manual inspection from DevTools.
// eslint-disable-next-line no-unused-vars
globalThis.runPRBFlow = runPRBFlow;
