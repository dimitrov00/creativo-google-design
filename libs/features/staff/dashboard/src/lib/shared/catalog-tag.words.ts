import type { MinuteDelta } from '@core/primitives';

/*
 * THE TAG's words — how far a visit runs from the catalogue's length,
 * shared by the frame's block, the agenda's card and the sheet's readout
 * (owner, 2026-09-10: "the events here should look a lot like the ones in
 * the frame … the ±x min if extended or subtracted").
 *
 * The arithmetic is `VisitDraftSystem.catalogMinutesOf` and
 * `VisitDraftSystem.minutesDelta` in `@core/systems`; these functions only
 * word the signed figure the system hands back (Law 10), in the
 * catalogue's own minutes pattern the caller supplies.
 */

/**
 * `−10 мин` / `+15 мин` — a signed distance from a catalogue length. A true
 * minus, never a hyphen: the figure is typography, not code.
 */
export function minutesDeltaWords(
  delta: MinuteDelta,
  minutesLabel: (minutes: number) => string,
): string {
  return `${delta < 0 ? '−' : '+'}${minutesLabel(Math.abs(delta))}`;
}

/**
 * The tag itself: nothing when the system found no distance — the visit
 * runs exactly as the catalogue says, or the catalogue cannot say.
 */
export function catalogTagWords(
  delta: MinuteDelta | null,
  minutesLabel: (minutes: number) => string,
): string | null {
  return delta === null ? null : minutesDeltaWords(delta, minutesLabel);
}
