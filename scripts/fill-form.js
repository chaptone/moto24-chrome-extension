// fill-form.js — fills 5 fields on the dummy พรบ form page.
//
// Two robustness tricks because the form page is a Next.js client component
// reached via soft navigation:
//   1. Wait for the first input to exist (inputs mount after React finishes
//      rendering, which can be after tabs.onUpdated fires status=complete).
//   2. Poll a second time after filling — if React unmounts+remounts the tree
//      during hydration, our initial fill gets wiped, so we re-apply.

(async () => {
  const { prbData: data } = await chrome.storage.session.get("prbData");
  if (!data) return "no-data";

  const mapping = {
    chassisNumber: data.chassisNumber,
    engineNumber: data.engineNumber,
    productMakeDesc: data.productMakeDesc,
    productModelDesc: data.productModelDesc,
    customerName: data.customerName,
  };

  function setInputValue(el, value) {
    // Use the native setter so React re-renders correctly.
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillAll() {
    let filled = 0;
    for (const [name, value] of Object.entries(mapping)) {
      const input = document.querySelector(`input[name="${name}"]`);
      if (input && value != null && input.value !== String(value)) {
        setInputValue(input, String(value));
        filled++;
      }
    }
    return filled;
  }

  // Wait up to 2s for the first input to appear (handles late-mount after
  // client-side navigation).
  let ready = false;
  for (let i = 0; i < 20; i++) {
    if (document.querySelector('input[name="chassisNumber"]')) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) return "no-inputs";

  // First fill pass.
  const firstPass = fillAll();

  // React may re-hydrate or re-render and reset uncontrolled inputs within
  // a few hundred ms. Re-apply after 400ms to catch that case — fillAll
  // skips inputs whose value is already correct, so this is a no-op if
  // nothing changed.
  await new Promise((r) => setTimeout(r, 400));
  const secondPass = fillAll();

  return `filled:${firstPass}+${secondPass}`;
})();
