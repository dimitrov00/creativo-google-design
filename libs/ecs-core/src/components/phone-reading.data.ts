/**
 * How a typed number was read — the field `phoneReadingKind`, the ONLY source
 * of these strings. `INTERNATIONAL` is a number whose country code is settled
 * (typed with `+` or `00`, led by the shop's code, or a trunk `0` the shop's
 * code replaced); `BARE` is a run of digits that may or may not carry the
 * code; `NONE` is too little to be a number yet.
 */
export const PhoneReadingKind = {
  International: 'INTERNATIONAL',
  Bare: 'BARE',
  None: 'NONE',
} as const;
export type PhoneReadingKind =
  (typeof PhoneReadingKind)[keyof typeof PhoneReadingKind];

/**
 * A typed number, read into the digit runs a stored number is searched by
 * (`PhoneSystem.searchDigitsOf`). `INTERNATIONAL` holds one candidate; `BARE`
 * holds two, `[code + run, run]`; `NONE` holds none. Every candidate is digits
 * alone, international, no `+`.
 */
export type PhoneReading = {
  readonly phoneReadingKind: PhoneReadingKind;
  readonly phoneReadingCandidates: readonly string[];
};
