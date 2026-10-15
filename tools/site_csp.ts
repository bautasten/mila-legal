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
