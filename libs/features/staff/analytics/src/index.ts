/**
 * `@creativo/features/staff/analytics`: the staff «Анализи» screen
 * (`/staff/analytics`, `docs/designs/staff-analytics.md`).
 *
 * What this barrel exports, and nothing else (ir-2-11): `StaffAnalyticsPage`
 * (`lib-staff-analytics`), the home `app.routes.ts` loads at
 * `/staff/analytics`, and `AnalyticsCardPage` (`lib-analytics-card-page`), a
 * card's own screen at `/staff/analytics/:card`. The store,
 * the presenter, the words, the time bar and the drill-down page stay
 * private to the lib: the page provides and mounts them.
 */
export { StaffAnalyticsPage } from './lib/staff-analytics-page/staff-analytics.page';
export { AnalyticsCardPage } from './lib/staff-analytics-page/analytics-card.page';
