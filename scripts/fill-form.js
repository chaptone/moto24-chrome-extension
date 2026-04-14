// fill-form.js — fills 5 fields on the dummy พรบ form page.

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

  let filled = 0;
  for (const [name, value] of Object.entries(mapping)) {
    const input = document.querySelector(`[name="${name}"]`);
    if (input && value != null) {
      setInputValue(input, String(value));
      filled++;
    }
  }
  return `filled:${filled}`;
})();
