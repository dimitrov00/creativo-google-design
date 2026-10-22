/**
 * The zone the nightly SCHEDULES fire on — a deploy-time option of
 * `onSchedule({ timeZone })`, the one zone literal the functions keep
 * (Phase 4a 4A-11; flatten-spec OQ-2, still open: its home).
 *
 * Cloud Scheduler needs it as a static string before any document exists,
 * so it cannot be read from a location. It is never a shop's clock: every
 * pipeline a schedule runs reads the default location's `timeZone` itself
 * (Law 7.2, F-4). Read by `main.ts`' three `onSchedule` options only.
 */
export const CRON_TIME_ZONE = 'Europe/Sofia';
