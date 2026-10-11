import type { BarberId } from '../primitives/ids.primitive';

/** How many identity tones a shop's chairs are drawn in (`barber-tone.ts:35`). */
const TONE_COUNT = 5;

/** FNV-1a's 32-bit offset basis and prime. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * BarberToneSystem — WHOSE CHAIR, as one of five identity tones
 * (`libs/features/staff/dashboard/src/lib/barber-tone.ts`). Numbers only: a
 * tone is an index `0…TONE_COUNT − 1`, and the CSS token it names is picked
 * in the template.
 *
 * A bare hash collides most of the time at five slots and four barbers, so
 * the hash picks a PREFERENCE and a deterministic probe settles the rest. The
 * roster is walked by ascending id, never by roster order, so a barber's
 * tone does not shift because a colleague was hired, renamed or re-sorted —
 * only someone whose id sorts earlier joining and wanting the same slot can
 * move it. Past five chairs tones repeat by necessity.
 */
export const BarberToneSystem = {
  TONE_COUNT,

  /**
   * FNV-1a over the id's UTF-16 code units — short, dependency-free and
   * stable across processes, so the same barber gets the same tone on every
   * device. `Math.imul` keeps the prime multiply inside 32 bits.
   */
  fnv1a(value: string): number {
    let hash = FNV_OFFSET_BASIS;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return hash >>> 0;
  },

  /** The slot an id prefers before collisions are settled. */
  toneOf(barberId: BarberId): number {
    return BarberToneSystem.fnv1a(barberId) % TONE_COUNT;
  },

  /**
   * Every barber's tone, parallel to `barberIds` (the i-th answer is the
   * i-th id's). Ids are visited in ascending code-unit order; each takes its
   * preferred slot, or the next free one round the ring, or — when every
   * slot is taken — its preference again. An id listed twice is visited
   * twice, and both of its positions read the slot its LAST visit took (the
   * legacy map's last write).
   */
  assignBarberTones(barberIds: readonly BarberId[]): readonly number[] {
    const sorted = [...barberIds].sort();
    const taken: boolean[] = [];
    for (let slot = 0; slot < TONE_COUNT; slot++) taken.push(false);
    const toneById = new Map<BarberId, number>();
    for (let i = 0; i < sorted.length; i++) {
      const id = sorted[i] as BarberId;
      const preferred = BarberToneSystem.toneOf(id);
      let slot = preferred;
      for (let step = 0; step < TONE_COUNT; step++) {
        const candidate = (preferred + step) % TONE_COUNT;
        if (!taken[candidate]) {
          slot = candidate;
          break;
        }
      }
      taken[slot] = true;
      toneById.set(id, slot);
    }
    const out: number[] = [];
    for (let i = 0; i < barberIds.length; i++) {
      out.push(toneById.get(barberIds[i] as BarberId) as number);
    }
    return out;
  },
} as const;
