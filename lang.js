// The language switch's manners (lang-switch, 2026-11-02): an addition only, the <details> menu works without it. As a native menu does,
// it closes when the visitor taps or clicks outside it, tabs past its last language, or presses Escape (focus back on the switch).
// Loaded by every page's switch (site_csp.ts langSwitch) from the site itself, so the pages' policy stays as it is.
(() => {
  const open = () => document.querySelector(".lang details[open]");
  document.addEventListener("click", (e) => {
    const d = open();
    if (d && !d.contains(e.target)) d.open = false;
  });
  document.addEventListener("keydown", (e) => {
    const d = open();
    if (e.key === "Escape" && d) { d.open = false; d.querySelector("summary").focus(); }
  });
  document.addEventListener("focusout", (e) => {
    const d = open();
    if (d && d.contains(e.target) && e.relatedTarget && !d.contains(e.relatedTarget)) d.open = false;
  });
})();
