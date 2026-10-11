import { BarberId } from '@core/primitives';
import { BarberToneSystem } from '@core/systems';

/**
 * WHOSE CHAIR — identity as colour, the last channel the schedule was missing.
 *
 * ### Why colour, and why only here
 * The calendar grids column by barber, so position already says who and hue
 * was free to mean "this is a booking" (`staff-time-grid.state.css`, "Status
 * is FORM, never hue"). The agenda has no columns: one clock-ordered run mixes
 * every chair, and the only things saying who were a name and a photo — both
 * of which must be READ. Colour is the one channel that survives peripheral
 * vision, so a rail lets the eye group a chair's whole day while scrolling
 * without parsing a word.
 *
 * It is a THIRD channel, never a sole one. The barber's name and face stay on
 * the card, which is what keeps this inside HIG's "don't rely on colour alone"
 * rule rather than in breach of it.
 *
 * ### Why these five
 * This product is deliberately near-monochrome with one sanctioned accent
 * (#f26b22). Every tone here is capped at OKLCH chroma .08–.12 — 43-67% of
 * the accent's .184 — so a mark reads as identity and never as a second
 * brand. None enters the accent's warm Lab sector, so no barber can be
 * mistaken for "next", "live" or the now line, which are the accent's alone.
 *
 * A blue at full brand chroma was rejected outright: it is a relative of the
 * retired brand blue, and handing it to slot 0 would put the killed colour on
 * the first barber of every shop. Slate replaces it at a third of the chroma.
 *
 * Lightness is deliberately NOT the separator between slots — that channel
 * belongs to the past hatch, and two facts must not compete for one signal.
 *
 * Contrast: identity never renders text or a glyph, so the rule relied on is
 * SC 1.4.11 (3:1, non-text). Every tone clears 5.5:1 against its theme's card
 * surface anyway — headroom, not licence to tint type with it.
 */
export const BARBER_TONE_COUNT = BarberToneSystem.TONE_COUNT;

/**
 * Assign every barber in a roster a tone, resolving collisions.
 *
 * Phase 2 shim: the hash, the probe and the ascending-id walk are
 * `BarberToneSystem.assignBarberTones` in `@core/systems`, which answers
 * parallel to the roster; this keeps the legacy map keyed by id for its
 * callers. The system takes `BarberId` brands (Law 7); the roster's raw ids
 * are document ids, so they become brands by construction (`BarberId.of`).
 */
export function assignBarberTones(
  barberIds: readonly string[],
): ReadonlyMap<string, number> {
  return toToneMap(
    barberIds,
    BarberToneSystem.assignBarberTones(barberIds.map((id) => BarberId.of(id))),
  );
}

/** The system's parallel answer → the legacy map (a repeated id keeps one entry). */
function toToneMap(
  barberIds: readonly string[],
  tones: readonly number[],
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const id of [...barberIds].sort()) {
    map.set(id, tones[barberIds.indexOf(id)] as number);
  }
  return map;
}
