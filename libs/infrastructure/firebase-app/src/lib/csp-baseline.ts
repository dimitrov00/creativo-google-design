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
