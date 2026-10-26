/*
 * `@creativo/infrastructure/firebase-app/csp-baseline` — the measured CSP
 * report-only baseline alone, an entry point that loads nothing else: the
 * CSP smoke's Node side reads it (`apps/web/e2e/csp/csp-smoke.spec.ts`),
 * and the library's own barrel loads Angular. The page's issue reporter
 * reads the same list (`lib/reporting-error-handler.ts`).
 */
export * from './lib/csp-baseline';
