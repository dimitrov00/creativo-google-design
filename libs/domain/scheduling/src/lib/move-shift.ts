/*
 * LEGACY INSTANT FORM (ECS migration, flatten pass). THE SHIFT — where a
 * client move puts a seat it CARRIES — is `MoveSystem.carriedOffsetMinutes` /
 * `MoveSystem.carriedStartMinutes` in the core, which now run on the shop's
 * WALL CLOCK of the one day a visit sits on (T1, F-6): a `MinuteOfDay` in, a
 * `MinuteDelta` out, `null` once the kept distance would leave that day.
 *
 * These two keep the legacy INSTANT signatures their callers still hold (the
 * web booking draft's `offsetMinutes`, `booking-draft.ts`) and the instant
 * arithmetic their property specs pin across days and years — a domain the
 * wall-clock system no longer has, and one the G-1-gated `UtcEpochMs.plus*`
 * may not serve (placement math, T2). The formula is the one the core held
 * before the pass: the offset in WHOLE minutes, rounded once, added back on
 * the instant. On one shop day with no DST boundary in between, the two
 * agree minute for minute. The booking-flow flip retires them.
 */

const MS_PER_MINUTE = 60_000;

/**
 * Minutes from the move anchor to a carried seat's start — what a move
 * keeps. Negative when the carried seat starts first.
 */
export function carriedOffsetMinutes(
  seatStartMs: number,
  anchorMs: number,
): number {
  return Math.round((seatStartMs - anchorMs) / MS_PER_MINUTE);
}

/**
 * Where a carried seat starts once the cart's earliest seat starts at
 * `cartEarliestMs` — its kept offset from there.
 */
export function carriedStartMs(
  cartEarliestMs: number,
  offsetMinutes: number,
): number {
  return cartEarliestMs + offsetMinutes * MS_PER_MINUTE;
}
