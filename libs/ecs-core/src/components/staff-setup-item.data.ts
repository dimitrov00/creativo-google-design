/**
 * The setup items of a barber record (team onboarding D5,
 * `docs/designs/team-onboarding.md`) — the ONLY source of these strings,
 * named after the field that carries one (`staffSetupItem`). The first
 * five are what bookings need before the record can go live; the rest are
 * optional profile details the newcomer's setup card asks for.
 */
export const StaffSetupItem = {
  Name: 'NAME',
  StartDay: 'START_DAY',
  Shops: 'SHOPS',
  Services: 'SERVICES',
  Hours: 'HOURS',
  Photo: 'PHOTO',
  Title: 'TITLE',
  Bio: 'BIO',
  Instagram: 'INSTAGRAM',
  Experience: 'EXPERIENCE',
} as const;
export type StaffSetupItem =
  (typeof StaffSetupItem)[keyof typeof StaffSetupItem];
