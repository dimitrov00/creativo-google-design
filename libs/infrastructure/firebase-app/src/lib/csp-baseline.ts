/**
 * THE MEASURED REPORT-ONLY BASELINE (owner rulings OR-30, OR-31) — the three
 * Trusted Types sinks MapLibre GL trips on every map render (measured on
 * maplibre-gl 6.16 under the Hosting report-only policy), as the browser
 * writes each one's `sample`: the tile worker it starts from its self-hosted
 * module (`MAPLIBRE_WORKER_PATH` in `@creativo/ui/controls`; a `blob:` URL
 * until v6), and the attribution control's `DOMParser` and `innerHTML`. Enforcing
 * Trusted Types waits on exactly these (owner rulings, Deferred #3: the DS
 * map's attribution footnote and a worker policy).
 *
 * ONE list, read by both ends: the page's issue reporter drops a report-only
 * Trusted Types violation that matches it (`cspViolationIssue` — known noise
 * on the landing and `/book` would spend the shared issue throttle and keep
 * the `client_issue_count` alert lit), and the CSP smoke
 * (`apps/web/e2e/csp/csp-smoke.spec.ts`) tolerates it only when the script
 * that tripped it is the MapLibre chunk. Nothing in this file imports
 * anything, so the smoke's Node side reads it as plain data — through its
 * own entry point (`@creativo/infrastructure/firebase-app/csp-baseline`,
 * `src/csp-baseline.ts`), since the library's barrel loads Angular, which
 * Playwright's Node runner cannot.
 */
export const MAPLIBRE_REPORT_ONLY_SINKS: readonly RegExp[] = [
  /^Worker constructor\|\/maplibre-gl-worker\.mjs\?/,
  /^DOMParser parseFromString\|/,
  /^Element innerHTML\|/,
];

/**
 * THE reCAPTCHA ENTERPRISE REPORT-ONLY SINKS (security hardening S-RU-28,
 * S-L-22) — UNMEASURED: derived from the SDK source and the Trusted Types
 * sample format (`<sink>|<first 40 characters of the value>`), not from a
 * browser. With a site key the page injects
 * `https://www.google.com/recaptcha/enterprise.js` by assigning a script's
 * `src` (`app-check.provider.ts`, and the SDK's own loader the same way),
 * and reCAPTCHA loads its code from `www.gstatic.com/recaptcha/` — each a
 * `require-trusted-types-for 'script'` report on every page load. The
 * page's issue reporter drops a report-only Trusted Types violation that
 * matches (`cspViolationIssue`); a wrong pattern simply drops nothing
 * (fail-visible). The owner's staging smoke measures both directives and
 * corrects this list before the production key (§2.A.6 step 2). The CSP
 * smoke never loads reCAPTCHA (it runs the emulator path), so it does not
 * read this list. Enforcing Trusted Types waits on these too (Deferred #3).
 */
export const RECAPTCHA_REPORT_ONLY_SINKS: readonly RegExp[] = [
  /^HTMLScriptElement src\|https:\/\/www\.google\.com\/recaptcha\//,
  /^HTMLScriptElement src\|https:\/\/www\.gstatic\.com\/recaptcha\//,
];

/**
 * THE reCAPTCHA ENTERPRISE REPORT-ONLY POLICIES (S-RU-28, S-L-22) —
 * UNMEASURED: the Trusted Types policy names reCAPTCHA's Closure code is
 * expected to create (`goog#html`), which the report-only `trusted-types
 * angular angular#bundler` directive reports under `trusted-types` (the
 * sample is the policy name). Dropped by the page's issue reporter like
 * {@link RECAPTCHA_REPORT_ONLY_SINKS}; measured and corrected by the same
 * staging smoke.
 */
export const RECAPTCHA_REPORT_ONLY_POLICIES: readonly string[] = ['goog#html'];
