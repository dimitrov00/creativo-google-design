export * from './lib/ids';
export * from './lib/ids.errors';

export * from './lib/interval';
export * from './lib/calendar-day';
export * from './lib/calendar-day.errors';
export * from './lib/booking-contact';
export * from './lib/booking-contact.errors';
export * from './lib/seat-label';
export * from './lib/seat-label.errors';
export * from './lib/time-slot';
export * from './lib/time-slot.errors';

// ── Roster / schedule ────────────────────────────────────────────────────
// `working-hours.ts` was DELETED here: it held one range per weekday, so it
// could not express a lunch break or a split shift, it had no effective
// dating, and nothing in the product ever constructed it. `WeeklyPattern` +
// `StaffScheduleHistory` replace it.
export * from './lib/weekday';
export * from './lib/local-time-of-day';
export * from './lib/local-time-of-day.errors';
export * from './lib/shift-segment';
export * from './lib/shift-segment.errors';
export * from './lib/weekly-pattern';
export * from './lib/staff-schedule';
export * from './lib/staff-schedule.errors';
export * from './lib/schedule-exception';
export * from './lib/schedule-exception.errors';
export * from './lib/roster-window';
export * from './lib/booking-policy';
export * from './lib/booking-policy.errors';
export * from './lib/availability';

// ── Flexible "when" — days, and the spans within them ────────────────────
export * from './lib/day-windows';
export * from './lib/flexible-when';
export * from './lib/flexible-when.errors';
export * from './lib/waitlist-request';
export * from './lib/waitlist-request.errors';

// ── Occupancy / statistics ───────────────────────────────────────────────
export * from './lib/occupancy-reason';
export * from './lib/occupancy-class';
export * from './lib/occupancy-block';
export * from './lib/barber-day-totals';
export * from './lib/barber-day';
export * from './lib/barber-day.errors';

export * from './lib/seat';
export * from './lib/seat-outcome';
export * from './lib/barber-pref';
export * from './lib/booking-party';
export * from './lib/booking-party.errors';
export * from './lib/booking-cart';
export * from './lib/booking-cart.errors';

export * from './lib/appointment-status';
export * from './lib/appointment';
export * from './lib/appointment.errors';
