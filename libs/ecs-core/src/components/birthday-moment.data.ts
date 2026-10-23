/**
 * BD — which birthday the client card says, the field `birthdayMoment`
 * (Law 6): `TODAY` the solid band, `UPCOMING` the quiet notice of a
 * birthday within the week. `AgeSystem.birthdayMoment`'s answer (Law 10.2);
 * the card's display model binds and re-exports it, values unchanged.
 */
export const BirthdayMoment = {
  /** Today is the birthday: the band, and the gift under it when one is held. */
  Today: 'TODAY',
  /** The birthday falls within the week to come: one quiet line. */
  Upcoming: 'UPCOMING',
} as const;
export type BirthdayMoment =
  (typeof BirthdayMoment)[keyof typeof BirthdayMoment];
