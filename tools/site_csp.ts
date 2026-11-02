// The security policy every page on milacoach.app carries in its <head> (review round 24). GitHub Pages sends no headers of Mila's own, so
// the policy is a meta Content-Security-Policy: scripts only from the site itself or the page's own inline scripts by their SHA-256,
// nothing loaded from anywhere else, no plugins, no <base>, forms posting only to the site; and a meta referrer. A meta policy cannot carry
// frame-ancestors: the pages with an action (kompis, grupp, support) hide themselves when framed instead (marketing-site/frame.js).
// Real headers (frame-ancestors, nosniff) need a Cloudflare proxy in front of Pages: Patrik's later decision.
// Used by race_pages.ts (published with it as tools/site_csp.ts) and legal_site.ts; the hand-written pages in marketing-site/ carry the
// same policy, checked by tests/hardening24_test.ts.
import { createHash } from "node:crypto";

/** The support form's function: the only other origin a page talks to. */
export const SUPPORT_ORIGIN = "https://vfjofaniwtudzvadxpsd.supabase.co";
/** The policy without its script hashes. Styles may be inline (the pages' own <style> and style attributes; nothing a visitor writes). */
export const CSP_BASE = `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ${SUPPORT_ORIGIN}; object-src 'none'; base-uri 'none'; form-action 'self'`;
/** An inline script's source in a policy: its SHA-256, as browsers hash the text between <script> and </script>. */
export const scriptHash = (code: string) => `'sha256-${createHash("sha256").update(code, "utf8").digest("base64")}'`;
/** The policy for a page with these inline scripts (none: scripts from the site only). */
export function csp(inline: string[] = []): string {
  return CSP_BASE.replace("default-src 'self';", `default-src 'self'; script-src 'self'${inline.map((c) => " " + scriptHash(c)).join("")};`);
}
/** The <head> lines: the policy and the referrer rule (a visited site learns at most that the visitor came from milacoach.app). */
export function securityMeta(inline: string[] = [], referrer = "strict-origin-when-cross-origin"): string {
  return `<meta http-equiv="Content-Security-Policy" content="${csp(inline)}"><meta name="referrer" content="${referrer}">`;
}

// The language switch (lang-switch, 2026-11-02; Patrik: "det är lite konstigt att språket man visar försvinner"): every page's header
// shows the language it is in, and opening it lists every language the page has, each in its own name, the current one marked and not a
// link to itself. A <details> menu, so it works with no script under this policy (lang.js, from the site, only closes it on a tap
// outside or Escape, as a native menu does); one copy of the markup for the hand-written pages
// (checked against this by tests/lang_switch_test.ts), legal_site.ts and race_pages.ts. The order is the site's: sv en de nb da fi fr es.
/** Each language in its own name. */
export const LANG_NAMES: Record<string, string> = { sv: "Svenska", en: "English", de: "Deutsch", nb: "Norsk", da: "Dansk", fi: "Suomi", fr: "Français", es: "Español" };
/** The switch's name for screen readers (the nav landmark and the closed menu's prefix), per language. */
export const LANG_NAV: Record<string, string> = { sv: "Språk", en: "Language", de: "Sprache", nb: "Språk", da: "Sprog", fi: "Kieli", fr: "Langue", es: "Idioma" };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
/** The header's switch for a page in `lang`; `links` holds the address of the same page in each language it has, in the site's order;
 *  `script` the address of the site's lang.js, when the site has it (it only adds listeners, so it runs where it stands). */
export function langSwitch(lang: string, links: [string, string][], script?: string): string {
  const item = ([l, href]: [string, string]) => l === lang
    ? `<li><span aria-current="page" lang="${l}"><svg class="tick" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>${LANG_NAMES[l]}</span></li>`
    : `<li><a href="${esc(href)}" hreflang="${l}" lang="${l}">${LANG_NAMES[l]}</a></li>`;
  return `<nav class="lang" aria-label="${LANG_NAV[lang]}"><details><summary><svg class="globe" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5z"/></svg>`
    + `<span class="sr">${LANG_NAV[lang]}: </span>${LANG_NAMES[lang]}<svg class="chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m7 10 5 5 5-5"/></svg></summary>`
    + `<ul>${links.map(item).join("")}</ul></details></nav>${script ? `<script src="${esc(script)}"></script>` : ""}`;
}
