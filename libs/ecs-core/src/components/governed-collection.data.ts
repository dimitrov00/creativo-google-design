/**
 * Every collection the document-change trigger audits (audit-hardening
 * WS-3, RU-40) — the ONLY source of these strings, the plain tag field
 * `governedCollection` of a governed row and of the trigger's decoded
 * change. SCREAMING_SNAKE (RU-15, Law 1): a tag, never the path itself —
 * this dictionary sits in components and cannot read `Collections`
 * (entities, a higher tier, Law 8), so the tag → path map is
 * `GovernedChangeSystem.pathOf`, spec-checked against `Collections`
 * (`governed-collection.data.spec.ts`). Each value is its path upper-snaked.
 *
 * `Users` is a member so ONE handler serves all fourteen triggers; a users
 * write still becomes a `PROFILE_*` row (`ProfileChange`), never a
 * `GOVERNED_DOC_*` one — the other thirteen are
 * {@link GovernedDocCollection} (`governed-doc-collection.data.ts`).
 */
export const GovernedCollection = {
  Users: 'USERS',
  Settings: 'SETTINGS',
  Services: 'SERVICES',
  Barbers: 'BARBERS',
  Locations: 'LOCATIONS',
  BarberSchedules: 'BARBER_SCHEDULES',
  ScheduleExceptions: 'SCHEDULE_EXCEPTIONS',
  Coupons: 'COUPONS',
  Positions: 'POSITIONS',
  Courses: 'COURSES',
  Events: 'EVENTS',
  Customers: 'CUSTOMERS',
  AppointmentNotes: 'APPOINTMENT_NOTES',
  AppointmentPhotos: 'APPOINTMENT_PHOTOS',
} as const;
export type GovernedCollection =
  (typeof GovernedCollection)[keyof typeof GovernedCollection];
