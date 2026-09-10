/**
 * THE TAG's arithmetic — how far a visit runs from the catalogue's length —
 * shared by the frame's block and the agenda's card (owner, 2026-09-10:
 * "the events here should look a lot like the ones in the frame … the
 * ±x min if extended or subtracted").
 */

/**
 * The catalogue's minutes for a run of seats. A seat the catalogue no
 * longer knows falls back to its own booked terms — the length it was sold
 * for — so a retired service reads as running exactly as sold rather than
 * as unmeasurable. `null` for no seats at all.
 */
export function catalogMinutesOf<S>(
  seats: readonly S[],
  catalogMinutes: (seat: S) => number | null,
  bookedMinutes: (seat: S) => number,
): number | null {
  if (seats.length === 0) return null;
  return seats.reduce(
    (sum, seat) => sum + (catalogMinutes(seat) ?? bookedMinutes(seat)),
    0,
  );
}

/**
 * `−10 мин` / `+15 мин` — a signed distance from a catalogue length. A true
 * minus, never a hyphen: the figure is typography, not code.
 */
export function minutesDeltaLabel(
  delta: number,
  minutesLabel: (minutes: number) => string,
): string {
  return `${delta < 0 ? '−' : '+'}${minutesLabel(Math.abs(delta))}`;
}

/**
 * The tag itself: nothing when the visit runs exactly as the catalogue
 * says, and nothing when the catalogue cannot say.
 */
export function catalogTagOf(
  spanMinutes: number,
  catalogMinutes: number | null,
  minutesLabel: (minutes: number) => string,
): string | null {
  if (catalogMinutes === null) return null;
  const delta = spanMinutes - catalogMinutes;
  return delta === 0 ? null : minutesDeltaLabel(delta, minutesLabel);
}
