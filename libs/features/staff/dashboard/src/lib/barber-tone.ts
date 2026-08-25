/**
 * WHOSE CHAIR — identity as colour, the last channel the schedule was missing.
 *
 * ### Why colour, and why only here
 * The calendar grids column by barber, so position already says who and hue
 * was free to mean "this is a booking" (`staff-time-grid.css`, "Status is
 * FORM, never hue"). The agenda has no columns: one clock-ordered run mixes
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
export const BARBER_TONE_COUNT = 5;

/**
 * A stable string id → one of the five slots.
 *
 * FNV-1a because it is short, dependency-free and stable across processes —
 * the same barber gets the same tone on every device and after every rename,
 * which a `sortOrder`-derived index would not survive.
 */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    // The FNV prime, via shifts: `Math.imul` keeps it in 32 bits without
    // the float rounding a plain multiply would introduce.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Assign every barber in a roster a tone, resolving collisions.
 *
 * A bare hash collides 72% of the time at five slots and four barbers, which
 * would put two chairs in one colour on most days — the one outcome this
 * feature exists to prevent. So the hash picks a PREFERENCE and a
 * deterministic probe settles the rest.
 *
 * The roster is iterated by ascending id, not by roster order, so a barber's
 * tone does not shift because a colleague was hired, renamed or re-sorted —
 * it can only shift if someone whose id sorts earlier joins and wants the
 * same slot. Beyond five chairs tones repeat by necessity; the name and the
 * face are still there, which is why repetition degrades rather than breaks.
 *
 * No schema change: `Barber` carries no colour field and does not need one.
 * An owner-chosen override can land later as an additive optional index.
 */
export function assignBarberTones(
  barberIds: readonly string[],
): ReadonlyMap<string, number> {
  const taken = new Set<number>();
  const tones = new Map<string, number>();
  for (const id of [...barberIds].sort()) {
    const preferred = fnv1a(id) % BARBER_TONE_COUNT;
    let slot = preferred;
    for (let step = 0; step < BARBER_TONE_COUNT; step++) {
      const candidate = (preferred + step) % BARBER_TONE_COUNT;
      if (!taken.has(candidate)) {
        slot = candidate;
        break;
      }
    }
    taken.add(slot);
    tones.set(id, slot);
  }
  return tones;
}
