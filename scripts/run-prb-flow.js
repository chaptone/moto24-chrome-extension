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
 * @property {string|null} carModelValue
 * @property {string|null} carColorValue
 * @property {string|null} carSize
 * @property {string|null} carTypeValue
 * @property {("1"|"2"|null)} licenseTypeValue
 * @property {string|null} licenseAValue
 * @property {string|null} licenseBValue
 * @property {string|null} carChangwatCode
 * @property {string|null} registrationNo  Raw HMETER plate string; banner uses it as a hint when a plate part couldn't be mapped.
 * @property {string|null} customerPrefix
 * @property {string|null} customerFirstName
 * @property {string|null} customerLastName
 * @property {string|null} customerPhone
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
 * @property {boolean} useNAddress
 * @property {string|null} nAddress
 * @property {string|null} nChangwatCode
 * @property {string|null} nAmphurName
 * @property {string|null} nTumbolName
 * @property {string|null} nZipcode
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
  // Records simple-fields that PASSED their immediate verify, so the end-of-flow
  // re-verify pass can catch cross-field wipes (e.g. setting #CarType wiping
  // #CarSize). Map: key → { selector, expected }. MUST be declared at function
  // scope (not inside the fill-pipeline try block) — the hoisted fillPlateRow()
  // runs at function scope and writes to it, so a block-scoped const would throw
  // "filledExpected is not defined" there.
  const filledExpected = new Map();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── helpers ────────────────────────────────────────────────────────────

  function setText(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    // Best-effort — RVP's input/change handlers can throw (see fireChange).
    // Value is already set; never let a thrown handler abort the pipeline.
    try {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_) {
      /* RVP handler threw — value is set, keep going */
    }
  }

  /**
   * Fire a change event on `el` BEST-EFFORT — RVP's own change handlers can
   * throw (its sweetalert2.js is 404'd, and a province-reset can null DOM that
   * its amphur handler then reads — observed: `New:5135 TypeError: Cannot read
   * properties of undefined (reading 'value')`). The caller has ALREADY set
   * el.value, so RVP reacting is best-effort: a throw here must never abort our
   * pipeline. Swallow it; the caller's post-set verify confirms the value took.
   */
  function fireChange(el) {
    try {
      if (window.jQuery) window.jQuery(el).trigger("change");
      else el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_) {
      /* RVP handler threw — value is already set, keep going */
    }
  }

  function setSelectViaJQuery(el, value) {
    el.value = value;
    if (window.jQuery) window.jQuery(el).val(value);
    fireChange(el);
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
        fireChange(el);
        return true;
      }
    }
    return false;
  }

  /**
   * Set an iCheck-wrapped checkbox (RVP uses iCheck on the chkAddress checkbox).
   * iCheck hides the underlying <input> and intercepts clicks — programmatic
   * `el.checked = true` doesn't update the iCheck visual or fire the right
   * events. The library's API does both. Falls back to plain checkbox handling
   * if iCheck isn't loaded (defensive — current RVP loads iCheck globally).
   */
  function setCheckbox(el, value) {
    const wantChecked = !!value;
    // Best-effort — iCheck/RVP handlers can throw (see fireChange).
    try {
      if (window.jQuery && window.jQuery.fn.iCheck) {
        window.jQuery(el).iCheck(wantChecked ? "check" : "uncheck");
      } else {
        el.checked = wantChecked;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } catch (_) {
      el.checked = wantChecked; // fallback so the state is at least correct
    }
  }

  function setRadio(name, value) {
    const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (el) {
      try {
        el.click();
      } catch (_) {
        /* RVP handler threw — selection is set, keep going */
      }
    }
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

  // Select an <option> by its visible TEXT, robust to RVP's async
  // province→amphur (and amphur→tambon) cascade.
  //
  // WHY by text, not value — RVP's amphur/tambon `<option value>` is the
  // 2-digit *in-province* admin code, NOT a nationwide-unique id. So value
  // "07" is ชะอวด under province 80 (นครศรีธรรมราช) but วังวิเศษ under
  // province 92 (ตรัง); "08" is ท่าศาลา vs นาโยง. Committing a value captured
  // from one province's list while the <select> holds another province's list
  // silently renders the wrong amphur (the ชะอวด→วังวิเศษ field bug). So we
  // match AND commit against the SAME live list with no gap, then settle and
  // re-verify the committed option's TEXT (the only stable id).
  //
  // WHY no re-trigger of the parent here — verified live in DevTools against
  // RVP (2026-06-16): a SINGLE `$('#Changwat').val(code).trigger('change')`
  // reliably reloads #Amphur to the new province's list (RVP's GetAmphur AJAX,
  // ~0.5–2s; slower on a cold tab). An earlier version re-fired the province
  // every 800ms when the target was still absent — that RESTARTED the in-flight
  // GetAmphur before it could finish, so #Amphur never settled and the lookup
  // timed out on the form's default ตรัง list. The cure is to set the parent
  // ONCE (the caller does that) and just POLL here until the new list lands.
  // A genuine AJAX drop is rare and falls through to the banner (safe).
  //
  // Thai text defense: NFC-normalize both sides + collapse all whitespace.
  async function selectByTextStable(selector, targetName, timeoutMs) {
    const target = normalizeThai(targetName);
    const start = Date.now();
    const deadline = start + timeoutMs;
    while (Date.now() < deadline) {
      const sel = document.querySelector(selector);
      const match =
        sel && sel.options.length > 1
          ? Array.from(sel.options).find((o) => normalizeThai(o.text) === target)
          : null;
      if (match) {
        // Commit against THIS live list (no capture/apply gap), then let any
        // in-flight cascade settle and re-verify by TEXT.
        setSelectViaJQuery(sel, match.value);
        await sleep(150);
        const after = document.querySelector(selector);
        if (
          after &&
          after.selectedOptions[0] &&
          normalizeThai(after.selectedOptions[0].text) === target
        ) {
          return { kind: "found" };
        }
        // drifted (a later RVP cascade swapped the list) — keep polling
      }
      await sleep(50);
    }
    const sel = document.querySelector(selector);
    const optionsSample = sel
      ? Array.from(sel.options).slice(0, 30).map((o) => o.text.trim())
      : [];
    const waitedMs = Date.now() - start;
    // Structured diagnostic so the officer (or us, via DevTools) can compare
    // the actual final option list vs the expected name on a genuine miss.
    try {
      console.warn("[moto24-prb] selectByTextStable timeout", {
        selector,
        target,
        waitedMs,
        optionCount: optionsSample.length,
        optionsSample,
      });
    } catch (_) {
      /* ignore */
    }
    return {
      kind: "timeout",
      waitedMs,
      optionCount: optionsSample.length,
      optionsSample,
    };
  }

  function normalizeThai(s) {
    return (typeof s === "string" ? s : "")
      .normalize("NFC")
      // \s + NBSP + ZWSP/ZWNJ/ZWJ + BOM \u2014 collapse all invisible separators
      // to a regular space before comparing. Defends against any future
      // encoding divergence between HMETER and RVP option labels.
      .replace(/[\s\u00A0\u200B-\u200D\uFEFF]+/g, " ")
      .trim();
  }

  // ── 1. Dismiss PDPA + wait for form ────────────────────────────────────

  // Wait until a cascade-child <select> has loaded options AND they've stopped
  // changing — i.e. RVP's OWN default-province load has settled. On page load
  // RVP fires GetAmphur_bydefault for the agent's default province (ตรัง); if we
  // set #Changwat before that finishes, the late default response clobbers
  // #Amphur back to ตรัง (confirmed live; a real failing tab showed a merged
  // 35-option ตรัง+นครศรีธรรมราช list) → the ~1/6 "stuck on ตรัง" timeout. Gating
  // the province set on this lets the default load finish first so our change
  // wins. MUST be at function scope — the hoisted fillAddressCascade/
  // fillNAddressCascade call it; declaring it inside the pipeline try block
  // below would be block-scoped → "waitForChildStable is not defined".
  async function waitForChildStable(selector, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastSig = null;
    let stableSince = 0;
    while (Date.now() < deadline) {
      const sel = document.querySelector(selector);
      if (sel && sel.options.length > 1) {
        const sig = sel.options.length + "|" + (sel.options[1] && sel.options[1].text);
        if (sig === lastSig) {
          if (Date.now() - stableSince >= 400) return true;
        } else {
          lastSig = sig;
          stableSince = Date.now();
        }
      }
      await sleep(100);
    }
    return false;
  }

  await dismissPDPAModalIfPresent();
  const ready = await waitForFormReady();
  if (!ready) return { success: false, error: "RVP อาจเปลี่ยนโครงสร้างหน้าเว็บ" };

  // Chassis is the only true required field. If the selector is missing the
  // form layout has changed beyond what we can recover from.
  if (!document.querySelector("#CarTankNo")) {
    return { success: false, error: "ไม่พบช่องเลขตัวถัง (#CarTankNo)" };
  }

  // The fill pipeline is wrapped so an exception thrown from inside an RVP
  // change handler (e.g. its sweetalert2.js is 404'd → a validation popup
  // ReferenceErrors mid-cascade) can NEVER abort us silently. On throw we log
  // the real error and fall through to render the banner with whatever filled,
  // so the officer always sees what still needs manual entry. INVARIANT: the
  // bot never finishes with unfilled/wrong fields and no banner.
  try {
  // ── 2. Simple non-cascade fields (each isolated) ───────────────────────

  // Order matters — RVP triggers reactive resets between fields:
  //   • Setting #MARQUE fires an AJAX cascade that repopulates #CarModel
  //     options AND resets #CarColor to "". Mark cascadeAfter:true to gate
  //     the loop on cascade completion before continuing.
  //   • Setting #CarType wipes #CarSize. Verified live 2026-04-26.
  //     → CarType MUST come before CarSize.
  // Verified live in real RVP /Policy/New that this order keeps all values.
  // NB: #CardType (ID type) and the nationality radio are intentionally NOT
  // in this list. RVP defaults both correctly (บัตรประจำตัวประชาชน + Thai)
  // for moto24's customer base; setting them ourselves only generates
  // banner noise on the rare "BC has no card type" rows. Officer flips
  // manually for the rare passport case.
  //
  // Plate row (#chkCarNo, #LicenseA, #LicenseB, #CarChangwat) is also NOT
  // here — handled in Section 5c so we can branch on licenseTypeValue and
  // silence A/B/Changwat for new MC (LicenseType="2") where RVP auto-fills.
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

  for (const f of SIMPLE_FIELDS) {
    try {
      const value = payload[f.key];
      if (value == null) {
        if (f.skipIfNull) {
          // Quiet skip — not a banner-worthy "officer must fill". Used for
          // N-block fields when useNAddress=false (same address).
          continue;
        }
        skipped.push({ field: f.key, reason: "no_data" });
        continue;
      }
      const el = document.querySelector(f.selector);
      if (!el) {
        skipped.push({ field: f.key, reason: "selector_missing" });
        continue;
      }
      if (f.skipIfReadonly && el.readOnly) {
        // Field is locked by an earlier-set field (e.g. LicenseA/B when
        // LicenseType !== "1"). RVP auto-populates a sentinel; don't fight it.
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

  // ── 3. Nationality + ID type — INTENTIONALLY NOT SET ──────────────────
  // RVP defaults both to Thai customer + บัตรประจำตัวประชาชน, which is
  // correct for moto24's entire customer base. For the rare foreign /
  // passport case, the officer flips manually. Setting these ourselves
  // only generates "(ไม่มีข้อมูล)" banner noise when BC happens to lack
  // the field, which is most of the time.

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

  // ── 5b. House-registration address block (only when useNAddress=true) ──
  if (payload.useNAddress) {
    // Set the chkAddress checkbox first so RVP's submit handler knows
    // to treat the N-block as a separate address.
    try {
      const chk = document.querySelector("#chkAddress");
      if (!chk) {
        skipped.push({ field: "useNAddress", reason: "selector_missing" });
      } else {
        setCheckbox(chk, true);
        filled.push("useNAddress");
      }
    } catch (e) {
      skipped.push({ field: "useNAddress", reason: String(e?.message || e) });
    }

    // N-block address text
    try {
      if (payload.nAddress == null) {
        skipped.push({ field: "nAddress", reason: "no_data" });
      } else {
        const el = document.querySelector("#NAddress");
        if (!el) {
          skipped.push({ field: "nAddress", reason: "selector_missing" });
        } else {
          setText(el, payload.nAddress);
          filled.push("nAddress");
        }
      }
    } catch (e) {
      skipped.push({ field: "nAddress", reason: String(e?.message || e) });
    }

    // N-block cascade — same shape as fillAddressCascade but with N-prefixed selectors
    await fillNAddressCascade();

    // N-block zipcode (post-cascade, same reason as the current-address zipcode)
    try {
      if (payload.nZipcode == null) {
        skipped.push({ field: "nZipcode", reason: "no_data" });
      } else {
        const zEl = document.querySelector("#NZipcode");
        if (!zEl) {
          skipped.push({ field: "nZipcode", reason: "selector_missing" });
        } else {
          setText(zEl, payload.nZipcode);
          if (zEl.value !== String(payload.nZipcode)) {
            skipped.push({ field: "nZipcode", value: String(payload.nZipcode), reason: "value_did_not_take" });
          } else {
            filled.push("nZipcode");
          }
        }
      }
    } catch (e) {
      skipped.push({ field: "nZipcode", reason: String(e?.message || e) });
    }

    // N-block phone — same payload field (customerPhone) flows to #NTel
    try {
      if (payload.customerPhone == null) {
        skipped.push({ field: "nTel", reason: "no_data" });
      } else {
        const el = document.querySelector("#NTel");
        if (!el) {
          skipped.push({ field: "nTel", reason: "selector_missing" });
        } else {
          setText(el, payload.customerPhone);
          if (el.value !== String(payload.customerPhone)) {
            skipped.push({ field: "nTel", value: String(payload.customerPhone), reason: "value_did_not_take" });
          } else {
            filled.push("nTel");
          }
        }
      }
    } catch (e) {
      skipped.push({ field: "nTel", reason: String(e?.message || e) });
    }
  }

  // ── 5c. Plate row (branches on licenseTypeValue) ───────────────────────
  // Hand-written instead of SIMPLE_FIELDS so we can:
  //   • silence A/B/Changwat for new MC (LicenseType="2") — RVP auto-fills
  //     and locks them; flagging them as "no_data" is noise.
  //   • still set #chkCarNo + report problems on used MC (LicenseType="1").
  await fillPlateRow();

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

  // ── 6b. Address-cascade TEXT re-verify ─────────────────────────────────
  // The filledExpected pass above compares el.value, which is unreliable for
  // amphur/tambon (province-local option values — see selectByTextStable).
  // A later field (zipcode, the N-block, the plate row) can re-fire a cascade
  // that swaps an earlier select's list out from under a committed value, so
  // verify the four cascade selects by TEXT one final time. On drift, demote
  // filled→skipped so it surfaces in the banner instead of being silently
  // submitted wrong (the original ชะอวด→วังวิเศษ failure mode).
  const ADDRESS_TEXT_VERIFY = [
    { field: "amphur",  selector: "#Amphur",  expected: payload.amphurName },
    { field: "tumbol",  selector: "#Tumbol",  expected: payload.tumbolName },
    { field: "nAmphur", selector: "#NAmphur", expected: payload.nAmphurName },
    { field: "nTumbol", selector: "#NTumbol", expected: payload.nTumbolName },
  ];
  for (const { field, selector, expected } of ADDRESS_TEXT_VERIFY) {
    if (!filled.includes(field) || expected == null) continue;
    const el = document.querySelector(selector);
    const ok =
      el &&
      el.selectedOptions[0] &&
      normalizeThai(el.selectedOptions[0].text) === normalizeThai(expected);
    if (!ok) {
      const idx = filled.indexOf(field);
      if (idx >= 0) filled.splice(idx, 1);
      skipped.push({ field, value: String(expected), reason: "wiped_by_later_field" });
    }
  }

  } catch (flowErr) {
    // RVP threw inside one of its own change handlers mid-fill. Don't abort
    // silently — surface it so the next run's console pinpoints the field.
    try {
      console.error("[moto24-prb] fill pipeline threw", flowErr);
    } catch (_) {
      /* ignore */
    }
    skipped.push({
      field: "_pipeline_error",
      reason: String(flowErr?.message || flowErr),
    });
  }

  // ── 7. Render in-page banner for skipped fields (ALWAYS runs) ──────────
  // One structured line so a failing run is fully diagnosable from the console
  // (which fields took, which were skipped + why) without re-instrumenting.
  try {
    console.log("[moto24-prb] result", { filled, skipped });
  } catch (_) {
    /* ignore */
  }
  renderSkippedBanner(skipped);

  return { success: true, filled, skipped };

  // ── inner: skipped-fields banner ───────────────────────────────────────

  function renderSkippedBanner(skippedFields) {
    if (!Array.isArray(skippedFields) || skippedFields.length === 0) return;

    // Remove any banner from a previous fill on this tab.
    const prev = document.getElementById("moto24-prb-skipped-banner");
    if (prev) prev.remove();

    // field-key → { label, selector }. Selectors mirror SIMPLE_FIELDS + the
    // address-cascade keys used in the skipped[] entries above.
    const FIELDS = {
      chassisNumber:     { label: "เลขตัวถัง",         selector: "#CarTankNo" },
      marqueValue:       { label: "ยี่ห้อรถ",           selector: "#MARQUE" },
      carModelValue:     { label: "รุ่นรถ",             selector: "#CarModel" },
      carColorValue:     { label: "สีรถ",              selector: "#CarColor" },
      carTypeValue:      { label: "รหัสรถ (CarType)",   selector: "#CarType" },
      carSize:           { label: "ขนาดเครื่องยนต์ (cc)", selector: "#CarSize" },
      customerPrefix:    { label: "คำนำหน้า",          selector: "#Prefix" },
      customerFirstName: { label: "ชื่อ",              selector: "#Name" },
      customerLastName:  { label: "นามสกุล",            selector: "#Lname" },
      customerPhone:     { label: "เบอร์โทร",           selector: "#Tel" },
      cardId:            { label: "เลขบัตรประชาชน",      selector: "#CardID" },
      cardTypeValue:     { label: "ประเภทบัตร",         selector: "#CardType" },
      birthdate:         { label: "วันเกิด",            selector: "#Birthdate" },
      nationType:        { label: "สัญชาติ",           selector: "input[name='NationType']" },
      nationalityOTH:    { label: "สัญชาติ (อื่น)",     selector: "#NationalityOTH" },
      address:           { label: "ที่อยู่ (บรรทัด 1)",   selector: "#Address" },
      changwat:          { label: "จังหวัด",            selector: "#Changwat" },
      amphur:            { label: "อำเภอ",             selector: "#Amphur" },
      tumbol:            { label: "ตำบล",              selector: "#Tumbol" },
      zipcode:           { label: "รหัสไปรษณีย์",       selector: "#Zipcode" },
      // Plate
      licenseTypeValue:  { label: "ทะเบียนรถ",                  selector: "#chkCarNo" },
      licenseAValue:     { label: "ทะเบียน (หมวดตัวอักษร)",      selector: "#LicenseA" },
      licenseBValue:     { label: "ทะเบียน (หมวดตัวเลข)",        selector: "#LicenseB" },
      carChangwatCode:   { label: "ทะเบียน (จังหวัด)",           selector: "#CarChangwat" },
      // N-block (house registration)
      useNAddress:       { label: "ที่อยู่ทะเบียนบ้าน (toggle)", selector: "#chkAddress" },
      nAddress:          { label: "ที่อยู่ตามทะเบียน",     selector: "#NAddress" },
      nChangwat:         { label: "จังหวัด (ทะเบียนบ้าน)", selector: "#NChangwat" },
      nAmphur:           { label: "อำเภอ (ทะเบียนบ้าน)",  selector: "#NAmphur" },
      nTumbol:           { label: "ตำบล (ทะเบียนบ้าน)",   selector: "#NTumbol" },
      nZipcode:          { label: "รหัสไปรษณีย์ (ทะเบียนบ้าน)", selector: "#NZipcode" },
      nTel:              { label: "เบอร์โทร (ทะเบียนบ้าน)", selector: "#NTel" },
      // Pipeline aborted by a thrown RVP handler — see console for the error.
      _pipeline_error:   { label: "ระบบกรอกขัดข้อง (ดู Console)", selector: null },
    };

    // De-duplicate by field key — a field may be reported twice (e.g. once
    // as `value_did_not_take` then again as `wiped_by_later_field`).
    const seen = new Set();
    const unique = [];
    for (const item of skippedFields) {
      if (seen.has(item.field)) continue;
      seen.add(item.field);
      unique.push(item);
    }

    // One-time style injection.
    if (!document.getElementById("moto24-prb-skipped-style")) {
      const style = document.createElement("style");
      style.id = "moto24-prb-skipped-style";
      style.textContent =
        "#moto24-prb-skipped-banner{position:fixed;top:16px;right:16px;z-index:2147483647;" +
        "width:320px;max-height:calc(100vh - 32px);overflow:auto;background:#fffbeb;" +
        "border:1px solid #f59e0b;border-radius:10px;box-shadow:0 10px 25px rgba(0,0,0,.15);" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;" +
        "color:#1f2937}" +
        "#moto24-prb-skipped-banner .hd{display:flex;align-items:center;justify-content:space-between;" +
        "padding:10px 12px;background:#fde68a;border-radius:10px 10px 0 0;font-weight:600;color:#78350f}" +
        "#moto24-prb-skipped-banner .ct{font-size:12px;background:#b45309;color:#fff;border-radius:999px;" +
        "padding:2px 8px;margin-left:6px}" +
        "#moto24-prb-skipped-banner .x{cursor:pointer;border:0;background:transparent;font-size:18px;" +
        "color:#78350f;padding:0 4px;line-height:1}" +
        "#moto24-prb-skipped-banner ul{list-style:none;margin:0;padding:6px 0}" +
        "#moto24-prb-skipped-banner li{padding:0}" +
        "#moto24-prb-skipped-banner li button{display:flex;align-items:center;width:100%;text-align:left;" +
        "padding:8px 12px;background:transparent;border:0;font:inherit;color:#1f2937;cursor:pointer}" +
        "#moto24-prb-skipped-banner li button:hover{background:#fef3c7}" +
        "#moto24-prb-skipped-banner li button::before{content:'•';color:#b45309;margin-right:8px;font-weight:700}" +
        "#moto24-prb-skipped-banner .reason{color:#6b7280;font-size:11px;margin-left:6px}" +
        ".moto24-prb-flash{outline:3px solid #f59e0b!important;outline-offset:2px;transition:outline .2s}";
      document.head.appendChild(style);
    }

    const banner = document.createElement("div");
    banner.id = "moto24-prb-skipped-banner";
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "ช่องที่ต้องเลือกเอง");

    const header = document.createElement("div");
    header.className = "hd";
    header.innerHTML =
      "<span>⚠️ ต้องเลือกเอง<span class=\"ct\"></span></span>" +
      "<button class=\"x\" type=\"button\" aria-label=\"ปิด\">×</button>";
    header.querySelector(".ct").textContent = String(unique.length);
    header.querySelector(".x").addEventListener("click", () => banner.remove());
    banner.appendChild(header);

    const ul = document.createElement("ul");
    for (const item of unique) {
      const def = FIELDS[item.field];
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";

      const labelText = def ? def.label : item.field;
      const reasonText = bannerHintFor(item, payload);
      btn.innerHTML = "";
      btn.appendChild(document.createTextNode(labelText));
      if (reasonText) {
        const r = document.createElement("span");
        r.className = "reason";
        r.textContent = reasonText;
        btn.appendChild(r);
      }
      btn.addEventListener("click", () => focusField(def?.selector));
      li.appendChild(btn);
      ul.appendChild(li);
    }
    banner.appendChild(ul);
    document.body.appendChild(banner);
  }

  // Per-field hint shown after the label in the banner. Plate-related rows
  // get a special treatment: when HMETER's registration_no is non-null, we
  // show the raw plate verbatim instead of "(ไม่มีข้อมูล)" — the resolver
  // had data, just couldn't fully map it. Reserves "(ไม่มีข้อมูล)" for the
  // truly-empty case where registration_no itself was null.
  function bannerHintFor(item, payload) {
    const PLATE_FIELDS = new Set([
      "licenseAValue",
      "licenseBValue",
      "carChangwatCode",
    ]);
    if (PLATE_FIELDS.has(item.field) && payload.registrationNo) {
      return " - (" + payload.registrationNo + ")";
    }
    return friendlyReason(item.reason);
  }

  function friendlyReason(reason) {
    if (!reason) return "";
    if (reason === "no_data") return "(ไม่มีข้อมูล)";
    if (reason === "selector_missing") return "(ไม่พบช่อง)";
    if (reason === "skipped_dependency") return "(รอช่องก่อนหน้า)";
    if (reason === "value_did_not_take") return "(เลือกไม่สำเร็จ)";
    if (reason === "wiped_by_later_field") return "(ถูกล้างทับ)";
    if (reason.startsWith("lookup_timeout:")) {
      // Format: lookup_timeout:<waitedMs>ms:<targetName>
      // Single reason for both "RVP cascade slow" and "RVP cascade returned
      // a list that doesn't contain the target" — we can't distinguish them
      // safely. The DevTools console.warn from selectByTextStable carries the
      // diagnostic info (full option list at timeout).
      const rest = reason.slice("lookup_timeout:".length);
      const [waited, name] = rest.split(":");
      return "(ไม่พบใน RVP หลังรอ " + waited + ": " + name + ")";
    }
    return "(" + reason + ")";
  }

  function focusField(selector) {
    if (!selector) return;
    const el = document.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // For Select2-wrapped selects, the underlying <select> is display:none
    // and can't take focus. Flash the visible Select2 container instead.
    let flashTarget = el;
    if (el.classList.contains("select2-hidden-accessible")) {
      const s2 = document.querySelector("#select2-" + el.id + "-container");
      if (s2) flashTarget = s2.closest(".select2-container") || s2;
    }
    flashTarget.classList.add("moto24-prb-flash");
    if (typeof el.focus === "function" && !el.classList.contains("select2-hidden-accessible")) {
      try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    }
    setTimeout(() => flashTarget.classList.remove("moto24-prb-flash"), 1800);
  }

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
      // Let RVP's default-province amphur load settle first, so its late
      // response can't clobber our province change (see waitForChildStable).
      await waitForChildStable("#Amphur", 5000);
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
    // #Changwat was set once above; RVP's GetAmphur AJAX reloads #Amphur for
    // this province (~0.5–2s) — just poll until ท่าศาลา&co. land. 8s budget
    // covers a cold-tab load. (Do NOT re-fire #Changwat while polling — that
    // restarts the in-flight AJAX and the list never settles.)
    const amphurResult = await selectByTextStable("#Amphur", amphurName, 8000);
    if (amphurResult.kind !== "found") {
      skipped.push(
        { field: "amphur", reason: `lookup_timeout:${amphurResult.waitedMs}ms:${amphurName}` },
        { field: "tumbol", reason: "skipped_dependency" },
      );
      return;
    }
    filled.push("amphur");

    if (!tumbolName) {
      skipped.push({ field: "tumbol", reason: "no_data" });
      return;
    }
    // Committing the amphur above fired #Amphur's change → RVP loads its tambon
    // list; poll until tumbolName lands.
    const tumbolResult = await selectByTextStable("#Tumbol", tumbolName, 8000);
    if (tumbolResult.kind !== "found") {
      skipped.push({
        field: "tumbol",
        reason: `lookup_timeout:${tumbolResult.waitedMs}ms:${tumbolName}`,
      });
      return;
    }
    filled.push("tumbol");
  }

  async function fillPlateRow() {
    const lt = payload.licenseTypeValue;
    if (lt !== "1" && lt !== "2") return; // null / unexpected — leave RVP defaults alone

    // 1) Set #chkCarNo — gates everything downstream
    try {
      const chkEl = document.querySelector("#chkCarNo");
      if (!chkEl) {
        skipped.push({ field: "licenseTypeValue", reason: "selector_missing" });
        return;
      }
      setSelectViaJQuery(chkEl, lt);
      if (chkEl.value !== lt) {
        skipped.push({ field: "licenseTypeValue", value: lt, reason: "value_did_not_take" });
        return;
      }
      filled.push("licenseTypeValue");
      filledExpected.set("licenseTypeValue", { selector: "#chkCarNo", expected: lt });
    } catch (e) {
      skipped.push({ field: "licenseTypeValue", reason: String(e?.message || e) });
      return;
    }

    // New MC (LicenseType="2") → RVP auto-fills LicenseA="ป้ายแดง" + LicenseB=" "
    // and locks them readOnly. Officer never picks A/B/Changwat — silently skip.
    if (lt === "2") return;

    // Used MC (LicenseType="1") — attempt A/B/Changwat with full reporting.
    fillPlateField("licenseAValue", "#LicenseA", setText);
    fillPlateField("licenseBValue", "#LicenseB", setText);
    fillPlateField("carChangwatCode", "#CarChangwat", setSelectViaJQuery);
  }

  function fillPlateField(key, selector, setter) {
    try {
      if (payload[key] == null) {
        skipped.push({ field: key, reason: "no_data" });
        return;
      }
      const el = document.querySelector(selector);
      if (!el) {
        skipped.push({ field: key, reason: "selector_missing" });
        return;
      }
      // Defensive: if RVP locked the field (shouldn't happen for LicenseType=1
      // on A/B/Changwat) just skip rather than fight.
      if (el.readOnly) return;
      setter(el, payload[key]);
      if (el.value !== String(payload[key])) {
        skipped.push({ field: key, value: String(payload[key]), reason: "value_did_not_take" });
        return;
      }
      filled.push(key);
      filledExpected.set(key, { selector, expected: el.value });
    } catch (e) {
      skipped.push({ field: key, reason: String(e?.message || e) });
    }
  }

  async function fillNAddressCascade() {
    const { nChangwatCode, nAmphurName, nTumbolName } = payload;

    if (!nChangwatCode) {
      skipped.push(
        { field: "nChangwat", reason: "no_data" },
        { field: "nAmphur",   reason: "skipped_dependency" },
        { field: "nTumbol",   reason: "skipped_dependency" },
      );
      return;
    }
    try {
      const cw = document.querySelector("#NChangwat");
      if (!cw) {
        skipped.push(
          { field: "nChangwat", reason: "selector_missing" },
          { field: "nAmphur",   reason: "skipped_dependency" },
          { field: "nTumbol",   reason: "skipped_dependency" },
        );
        return;
      }
      // Same default-load settle gate as the current-address block.
      await waitForChildStable("#NAmphur", 5000);
      setSelectViaJQuery(cw, nChangwatCode);
      filled.push("nChangwat");
    } catch (e) {
      skipped.push(
        { field: "nChangwat", reason: String(e?.message || e) },
        { field: "nAmphur",   reason: "skipped_dependency" },
        { field: "nTumbol",   reason: "skipped_dependency" },
      );
      return;
    }

    if (!nAmphurName) {
      skipped.push(
        { field: "nAmphur", reason: "no_data" },
        { field: "nTumbol", reason: "skipped_dependency" },
      );
      return;
    }
    const nAmphurResult = await selectByTextStable("#NAmphur", nAmphurName, 8000);
    if (nAmphurResult.kind !== "found") {
      skipped.push(
        { field: "nAmphur", reason: `lookup_timeout:${nAmphurResult.waitedMs}ms:${nAmphurName}` },
        { field: "nTumbol", reason: "skipped_dependency" },
      );
      return;
    }
    filled.push("nAmphur");

    if (!nTumbolName) {
      skipped.push({ field: "nTumbol", reason: "no_data" });
      return;
    }
    const nTumbolResult = await selectByTextStable("#NTumbol", nTumbolName, 8000);
    if (nTumbolResult.kind !== "found") {
      skipped.push({
        field: "nTumbol",
        reason: `lookup_timeout:${nTumbolResult.waitedMs}ms:${nTumbolName}`,
      });
      return;
    }
    filled.push("nTumbol");
  }
}

// Expose for service worker. Note: chrome.scripting.executeScript({func})
// does not need this global binding (the function is passed directly),
// but having it available makes the file importable for unit testing or
// manual inspection from DevTools.
// eslint-disable-next-line no-unused-vars
globalThis.runPRBFlow = runPRBFlow;
