import { DurationMinutes, VisitDraftSystem, defect } from '@creativo/ecs-core';

/**
 * THE TAG's arithmetic — how far a visit runs from the catalogue's length —
 * shared by the frame's block and the agenda's card (owner, 2026-09-10:
 * "the events here should look a lot like the ones in the frame … the
 * ±x min if extended or subtracted").
 *
 * Phase 2 shim: the arithmetic is `VisitDraftSystem.catalogMinutesOf` and
 * `VisitDraftSystem.minutesDelta` in `@creativo/ecs-core`; the `−10 мин`
 * wording stays here, in the presenter layer.
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
  return VisitDraftSystem.catalogMinutesOf(
    seats.map((seat) => {
      const catalog = catalogMinutes(seat);
      return {
        catalogMinutes: catalog === null ? null : minutesOf(catalog),
        bookedMinutes: minutesOf(bookedMinutes(seat)),
      };
    }),
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
  const delta = VisitDraftSystem.minutesDelta(
    minutesOf(spanMinutes),
    catalogMinutes === null ? null : minutesOf(catalogMinutes),
  );
  return delta === null ? null : minutesDeltaLabel(delta, minutesLabel);
}

/**
 * A legacy minute figure → the system's `DurationMinutes` (flatten pass,
 * Law 7). A service, a seat and a visit always last a positive whole number
 * of minutes (the catalogue refuses anything else), so a figure that is not
 * one is a broken invariant, never an input.
 */
function minutesOf(raw: number): DurationMinutes {
  const minutes = DurationMinutes.of(raw);
  if (!minutes.ok) defect(`not a positive whole number of minutes: ${raw}`);
  return minutes.value;
}
