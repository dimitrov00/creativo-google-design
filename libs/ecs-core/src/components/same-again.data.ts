import type { BarberId, ServiceId } from '@core/primitives';

/**
 * How ONE seat of a past visit books again in today's public catalogue —
 * the discriminator `seatRebook` (`SameAgainSystem.reachOf`; the client's
 * «Пак същото», owner ruling Q6 of the role-aware homes brief, 2026-11-25).
 */
export const SeatRebook = {
  /** Its service, its variant and its barber, as they were. */
  Kept: 'KEPT',
  /**
   * The service is still offered, but its barber is off the public list or
   * no longer performs it: booked again with no barber chosen.
   */
  AnyBarber: 'ANY_BARBER',
  /** The service, or the variant chosen within it, is no longer offered: left out. */
  Gone: 'GONE',
} as const;
export type SeatRebook = (typeof SeatRebook)[keyof typeof SeatRebook];

/**
 * What «the same again» can book of a visit — the discriminator
 * `sameAgainReach` of {@link SameAgain}.
 */
export const SameAgainReach = {
  /** Every seat as it was. */
  Same: 'SAME',
  /** Something is booked differently: a barber is left open, or a service left out. */
  Changed: 'CHANGED',
  /** Nothing of the visit is offered any more. */
  None: 'NONE',
} as const;
export type SameAgainReach =
  (typeof SameAgainReach)[keyof typeof SameAgainReach];

/**
 * A past visit read against today's public catalogue: how each seat books
 * again, and the barbers and services that changed. The card on `/account`
 * words it; the booking flow's pre-fill rebuilds the basket from the same
 * answer, so the promise and the basket never disagree.
 */
export type SameAgain = {
  readonly sameAgainReach: SameAgainReach;
  /** One per seat, in the visit's seat order. */
  readonly seatRebooks: readonly SeatRebook[];
  /** The barbers of the `ANY_BARBER` seats, each once, in seat order. */
  readonly awayBarberIds: readonly BarberId[];
  /** The services of the `GONE` seats, each once, in seat order. */
  readonly goneServiceIds: readonly ServiceId[];
};
