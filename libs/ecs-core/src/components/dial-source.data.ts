/**
 * DS — where the number the client card dials comes from, the field
 * `dialSource` (Law 6): `ACCOUNT` the registered account's own E.164,
 * `SEAT` the seat's digits as the edge stripped them.
 * `PhoneSystem.dialable`'s answer (Law 10.2); the presenter words it.
 */
export const DialSource = {
  /** The account's own number — a registered account always holds one. */
  Account: 'ACCOUNT',
  /** The seat's number, for a guest without an account. */
  Seat: 'SEAT',
} as const;
export type DialSource = (typeof DialSource)[keyof typeof DialSource];
