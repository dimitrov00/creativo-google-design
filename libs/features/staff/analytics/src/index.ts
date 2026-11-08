/**
 * `@creativo/features/staff/analytics`: the staff «Анализи» screen
 * (`/staff/analytics`, `docs/designs/staff-analytics.md`).
 *
 * What this barrel exports, and nothing else (ir-2-11): `StaffAnalyticsPage`
 * (`lib-staff-analytics`), the routed page `app.routes.ts` loads. The store,
 * the presenter, the words, the time bar and the drill-down page stay
 * private to the lib: the page provides and mounts them.
 */
export { StaffAnalyticsPage } from './lib/staff-analytics-page/staff-analytics.page';
