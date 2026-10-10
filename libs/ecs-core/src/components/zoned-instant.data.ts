/**
 * An instant and the IANA zone it is read in — `{ epochMs, zone }`.
 *
 * The instant is the truth (interval algebra runs on `epochMs`); the zone is
 * one field beside it, so an appointment or an exception survives a tenant
 * changing its zone. All zone math — wall clocks, day keys, DST — lives in
 * `ZonedTimeSystem`; this companion only compares.
 */
export type ZonedInstant = {
  readonly epochMs: number;
  readonly zone: string;
};

export const ZonedInstant = {
  of(epochMs: number, zone: string): ZonedInstant {
    return { epochMs, zone };
  },

  /**
   * The same INSTANT — the zone it is read in does not matter, exactly as
   * the kernel's `ZonedDateTime.equals` compared instants.
   */
  equals(a: ZonedInstant, b: ZonedInstant): boolean {
    return a.epochMs === b.epochMs;
  },

  /**
   * `a` happens strictly before `b`. By instant, never by rendering: during
   * the autumn fall-back `03:30+03:00` is earlier than `03:30+02:00` although
   * the strings sort the other way.
   */
  before(a: ZonedInstant, b: ZonedInstant): boolean {
    return a.epochMs < b.epochMs;
  },
} as const;
