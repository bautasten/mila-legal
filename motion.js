// The site's motion (redesign 2026-11), an addition only: every page is complete without it. Loaded by a plain script tag,
// the last thing in every page's body.
// With reduced motion or Save-Data it loads nothing. Otherwise it brings in the self-hosted GSAP + ScrollTrigger (vendor/, licences in
// vendor/LICENSES.txt) and, with a fine pointer only, Lenis as the one smooth-scroll engine (touch keeps native scrolling).
// What moves: the hero's phones drift apart a little with the scroll; headings below the first screen rise word by word (their words
// are aria-hidden, the unsplit text stays for screen readers and comes back when the rise is done); text and cards rise in order; a race
// page draws its elevation profile and course line as they come into view; hub race lists rise in small batches (never on an index
// with its filter, where the list changes under the triggers). Nothing loops; printing, keyboard focus and turning reduced motion on
// all show everything at once.
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  if (reduce.matches || navigator.connection?.saveData) return;
  const base = document.currentScript.src.replace(/motion\.js(\?.*)?$/, "vendor/");
  const fine = matchMedia("(pointer: fine)").matches;
  const files = ["gsap.min.js", "ScrollTrigger.min.js", ...(fine ? ["lenis.min.js"] : [])];
  // after the page has loaded and the browser is idle, so the libraries never compete with what the first screen needs (FCP, LCP)
  const load = () => {
    let left = files.length;
    for (const f of files) {
      const s = document.createElement("script");
      s.src = base + f; s.async = false;
      s.onload = () => { if (--left === 0) start(); };
      document.head.append(s);
    }
  };
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(load, { timeout: 1500 }) : setTimeout(load, 200));
  if (document.readyState === "complete") idle(); else addEventListener("load", idle, { once: true });

  function start() {
    const { gsap, ScrollTrigger } = window;
    if (!gsap || !ScrollTrigger || reduce.matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ease = "power3.out", touched = new Set(), restore = [];
    const below = (el) => el.getBoundingClientRect().top > innerHeight * 0.92;
    const mark = (els) => { for (const e of els) touched.add(e); return els; };

    // one smooth-scroll engine, driven by GSAP's ticker so ScrollTrigger reads the same scroll
    let lenis = null;
    const tick = (t) => lenis.raf(t * 1000);
    if (fine && window.Lenis) {
      // sideways scrollers (race tables, the language strip on narrow windows) keep their own wheel
      lenis = new window.Lenis({ anchors: true, lerp: 0.12, prevent: (node) => !!node.closest?.(".tw, .lang") });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
    }

    // an index with its filter (form.filter): its month headings and race list stay still, since filtering moves them under the triggers
    const filtered = !!document.querySelector("form.filter");
    // headings: word by word, only plain-text ones below the first screen (never links or markup inside)
    for (const h of document.querySelectorAll("main h2, main .finale p")) {
      if (!below(h) || h.children.length || !h.textContent.trim() || (filtered && h.closest(".grp"))) continue;
      const text = h.textContent, esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      h.innerHTML = `<span class="sr">${esc(text)}</span><span aria-hidden="true">${text.trim().split(/\s+/).map((w) => `<span style="display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.08em;margin-bottom:-.08em"><span style="display:inline-block">${esc(w)}</span></span>`).join(" ")}</span>`;
      restore.push(() => { h.textContent = text; });
      gsap.from(h.querySelectorAll("[aria-hidden] span span"), { yPercent: 110, duration: 0.95, ease: "power4.out", stagger: 0.07,
        scrollTrigger: { trigger: h, start: "top 88%", once: true }, onComplete: () => { h.textContent = text; } });
    }

    // supporting copy and media after their heading; groups in a short stagger
    const rise = (sel, o = {}) => {
      const els = mark([...document.querySelectorAll(sel)].filter(below));
      if (!els.length) return;
      // o.still: cells of a hairline grid (.grid, .facts) only move, never fade, so the lines between them never show as a block
      gsap.set(els, o.still ? { y: o.y ?? 28 } : { opacity: 0, y: o.y ?? 28 });
      ScrollTrigger.batch(els, { start: "top 90%", once: true,
        onEnter: (b) => gsap.to(b, { ...(o.still ? {} : { opacity: 1 }), y: 0, duration: o.d ?? 0.9, ease, stagger: o.s ?? 0.08, overwrite: true, clearProps: "opacity,transform" }) });
    };
    rise("main section > .eyebrow, main section > .sub, main .feature .eyebrow, main .feature .sub, main .prose > p, main .ctabox, main .finale .ctas");
    rise("main .principles > div, main .guides > li, main .hubs > li", { s: 0.06 });
    rise("main .grid > .card", { y: 12, s: 0.06, still: true });
    rise("main .facts > div", { y: 12, s: 0.05, d: 0.7, still: true });
    if (!filtered) rise("main .list > li", { y: 16, s: 0.03, d: 0.6 });
    rise("main figure, main .tw, main .faq > *", { y: 24 });

    // the coach picture opens like a card being turned up
    for (const img of document.querySelectorAll("main .feature img")) {
      if (!below(img)) continue;
      mark([img]);
      gsap.fromTo(img, { clipPath: "inset(18% 10% 18% 10% round 18px)", scale: 1.06 }, { clipPath: "inset(0% 0% 0% 0% round 18px)", scale: 1, duration: 1.3, ease: "power3.inOut",
        scrollTrigger: { trigger: img, start: "top 85%", once: true }, clearProps: "clipPath,transform" });
    }

    // a race page: the profile draws itself from start to finish, then the area and the aid stations; the course line traces after it
    const draw = (path, fig, delay = 0) => {
      const len = path.getTotalLength?.();
      if (!len) return null;
      mark([path]);
      gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
      return gsap.to(path, { strokeDashoffset: 0, duration: Math.min(2.4, 1.2 + len / 1600), ease: "power2.inOut", delay,
        scrollTrigger: { trigger: fig, start: "top 82%", once: true }, onComplete: () => gsap.set(path, { clearProps: "strokeDasharray,strokeDashoffset" }) });
    };
    for (const fig of document.querySelectorAll("main .chart")) {
      if (!below(fig)) continue;   // already on screen: it stays as it is
      const pl = fig.querySelector(".pl"), rt = fig.querySelector(".rt");
      if (pl) {
        draw(pl, fig, 0.15);
        const extra = mark([...fig.querySelectorAll(".pf, .am, .aml")]);
        gsap.from(extra, { opacity: 0, duration: 0.8, stagger: 0.05, delay: 1.1, scrollTrigger: { trigger: fig, start: "top 82%", once: true }, clearProps: "opacity" });
      }
      if (rt) draw(rt, fig, 0.1);
    }

    // the hero's scroll: the phones part a little (wide screens only)
    const phones = document.querySelector(".phones");
    const mm = gsap.matchMedia();
    if (phones) mm.add("(min-width: 901px)", () => {
      const [a, b] = phones.querySelectorAll("img");
      const tl = gsap.timeline({ scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 0.6 } });
      if (a) tl.to(a, { y: -40, ease: "none" }, 0);
      if (b) tl.to(b, { y: 50, ease: "none" }, 0);
      // a fine pointer leans the phones a few pixels; it settles back when the pointer leaves or the window loses focus
      if (!fine || !a) return;
      const qx = gsap.quickTo(phones, "x", { duration: 0.8, ease }), qr = gsap.quickTo(phones, "rotation", { duration: 0.8, ease });
      const move = (e) => { const r = phones.getBoundingClientRect(), dx = (e.clientX - (r.left + r.width / 2)) / innerWidth; qx(dx * 18); qr(dx * 1.2); };
      const rest = () => { qx(0); qr(0); };
      const hero = document.querySelector(".hero");
      hero.addEventListener("pointermove", move); hero.addEventListener("pointerleave", rest); addEventListener("blur", rest);
      return () => { hero.removeEventListener("pointermove", move); hero.removeEventListener("pointerleave", rest); removeEventListener("blur", rest); gsap.set(phones, { clearProps: "x,rotation" }); };
    });

    // a race page's scene (drawn by scene.js, which adds .scened) drifts slower than the title in front of it
    const scene = document.querySelector(".race-hero[data-scene]");
    if (scene) mm.add("(min-width: 901px)", () => {
      gsap.to(scene, { "--sy": "70px", ease: "none", scrollTrigger: { trigger: scene, start: "top top", end: "bottom top", scrub: 0.6 } });
      return () => gsap.set(scene, { clearProps: "--sy" });
    });

    // keyboard focus never lands on something still waiting to rise: it shows at once
    const onFocus = (e) => {
      for (let el = e.target; el && el !== document.body; el = el.parentElement)
        if (touched.has(el) && getComputedStyle(el).opacity !== "1") gsap.to(el, { opacity: 1, y: 0, duration: 0.2, overwrite: true, clearProps: "opacity,transform" });
    };
    document.addEventListener("focusin", onFocus);

    // measurements follow the fonts and images
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
    for (const img of document.querySelectorAll("main img")) if (!img.complete) img.addEventListener("load", () => ScrollTrigger.refresh(), { once: true });
    // the filter on an index changes the page's height
    document.querySelector("form.filter")?.addEventListener("change", () => requestAnimationFrame(() => ScrollTrigger.refresh()));

    // everything to its final state: when reduced motion is turned on while the page is open (for good, no smooth scroll), and
    // before printing (the reveals only; the page goes on moving afterwards for what is still below)
    const finish = (all) => {
      if (all) { document.removeEventListener("focusin", onFocus); mm.revert(); for (const t of ScrollTrigger.getAll()) t.kill(); }
      gsap.killTweensOf([...touched]);
      for (const el of touched) gsap.set(el, { clearProps: "opacity,transform,clipPath,strokeDasharray,strokeDashoffset" });
      for (const r of restore) r();
      if (all && lenis) { gsap.ticker.remove(tick); lenis.destroy(); lenis = null; }
    };
    reduce.addEventListener("change", (e) => { if (e.matches) finish(true); }, { once: true });
    addEventListener("beforeprint", () => finish(false));
  }
})();
