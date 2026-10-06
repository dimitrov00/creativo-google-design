/**
 * THE SHIFT — where a client move puts a seat it CARRIES.
 *
 * A client move rebuilds only the seats the booker's cart can name
 * (`Seat.isMovableByBooker`); everybody else on the visit — a companion the
 * shop seated — is carried along. A carried seat keeps its DISTANCE from the
 * visit's move anchor (`Appointment.moveAnchor`, the earliest seat the cart
 * stands in for), and lands that far from wherever the cart's earliest seat
 * lands now. Side by side stays side by side, straight after stays straight
 * after, and a DST boundary between the old day and the new one changes
 * nothing about either: the arithmetic is on instants.
 *
 * ONE implementation, three readers, because three copies of it once
 * existed: the server writes the carried seat where this says
 * (`RescheduleBookingUseCase`), the availability engine keeps that chair
 * free before it offers a start (`AvailabilityRider`), and the review step
 * shows the minute (`placeRiders`). If any of them measured differently the
 * grid would offer a time the server refuses, or the card would show a
 * minute the server does not write.
 *
 * The offset is WHOLE minutes: it is persisted with a move's draft and
 * carried to the engine as `AvailabilityRider.offsetMinutes`, and a stored
 * seat starts on a minute. Rounding happens once, here, so no reader can
 * round differently.
 */

/**
 * Minutes from the move anchor to a carried seat's start — what a move
 * keeps. Negative when the carried seat starts first.
 */
export function carriedOffsetMinutes(
  seatStartMs: number,
  anchorMs: number,
): number {
  return Math.round((seatStartMs - anchorMs) / 60_000);
}

/**
 * Where a carried seat starts once the cart's earliest seat starts at
 * `cartEarliestMs` — its kept offset from there.
 */
export function carriedStartMs(
  cartEarliestMs: number,
  offsetMinutes: number,
): number {
  return cartEarliestMs + offsetMinutes * 60_000;
}
