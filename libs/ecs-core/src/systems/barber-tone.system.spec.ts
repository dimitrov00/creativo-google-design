import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BarberId } from '@core/primitives';
import { deepFreeze } from '@core/testing';
import { BarberToneSystem } from './barber-tone.system';

/*
 * The five cases of `assignBarberTones`
 * (libs/features/staff/dashboard/src/lib/barber-tone.spec.ts), COPIED and
 * re-targeted: the legacy map keyed by id becomes the array parallel to the
 * roster, so `tones.get(id)` reads `tones[ids.indexOf(id)]`. Plus the purity
 * case and properties over the probe. Ids are `BarberId` brands (Law 7);
 * the text the hash reads is unchanged.
 */

const S = BarberToneSystem;
const BARBER_TONE_COUNT = S.TONE_COUNT;

/** Raw roster ids as the brand the system takes. */
const barbers = (ids: readonly string[]): readonly BarberId[] =>
  ids.map((id) => BarberId.of(id));

/** The legacy map, read off the parallel answer. */
function tonesById(ids: readonly string[]): ReadonlyMap<string, number> {
  const tones = S.assignBarberTones(barbers(ids));
  const map = new Map<string, number>();
  ids.forEach((id, index) => map.set(id, tones.at(index) as number));
  return map;
}

describe('assignBarberTones', () => {
  it('never gives two chairs the same tone while slots remain', () => {
    // A bare hash collides most of the time at five slots and four barbers,
    // which is the one outcome this feature exists to prevent.
    for (const size of [2, 3, 4, 5]) {
      const ids = Array.from({ length: size }, (_, i) => `barber-${i}`);
      const tones = [...tonesById(ids).values()];
      expect(new Set(tones).size).toBe(size);
    }
  });

  it('is stable across calls and independent of roster order', () => {
    // A barber's colour must not change because the roster was re-sorted.
    const forward = tonesById(['ivan', 'niko', 'stefan']);
    const backward = tonesById(['stefan', 'ivan', 'niko']);
    for (const id of ['ivan', 'niko', 'stefan']) {
      expect(backward.get(id)).toBe(forward.get(id));
    }
  });

  it('keeps an incumbent when a colleague sorting LATER is hired', () => {
    // The roster is walked by ascending id precisely so a hire cannot
    // reshuffle the people already there.
    const before = tonesById(['aaa', 'bbb']);
    const after = tonesById(['aaa', 'bbb', 'zzz']);
    expect(after.get('aaa')).toBe(before.get('aaa'));
    expect(after.get('bbb')).toBe(before.get('bbb'));
  });

  it('always answers with a slot in range, however large the shop', () => {
    // Past five chairs tones must repeat — the name and the face are still
    // there, so repetition degrades rather than breaks.
    const ids = Array.from({ length: 12 }, (_, i) => `b${i}`);
    for (const tone of tonesById(ids).values()) {
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(BARBER_TONE_COUNT);
    }
  });

  it('gives the same id the same tone whatever else is present', () => {
    expect(tonesById(['solo']).get('solo')).toBe(
      tonesById(['solo']).get('solo'),
    );
  });
});

describe('BarberToneSystem — the hash and the parallel answer', () => {
  it('hashes with FNV-1a over 32 bits — the published test vectors', () => {
    expect(S.fnv1a('')).toBe(0x811c9dc5);
    expect(S.fnv1a('a')).toBe(0xe40c292c);
    expect(S.fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('answers a lone barber with the slot their hash prefers', () => {
    expect(S.assignBarberTones(barbers(['solo']))).toEqual([
      S.toneOf(BarberId.of('solo')),
    ]);
  });

  it('answers in roster order, one tone per id, and nothing for nobody', () => {
    expect(S.assignBarberTones([])).toEqual([]);
    const ids = barbers(['stefan', 'ivan', 'niko']);
    expect(S.assignBarberTones(ids)).toHaveLength(3);
  });

  it('reads one slot for an id listed twice — the one its last visit took', () => {
    const tones = S.assignBarberTones(barbers(['ivan', 'ivan']));
    expect(tones[0]).toBe(tones[1]);
  });

  it('gives distinct ids distinct tones up to five, and never leaves the ring (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
          maxLength: 9,
        }),
        (ids) => {
          const tones = S.assignBarberTones(barbers(ids));
          expect(tones).toHaveLength(ids.length);
          for (const tone of tones) {
            expect(tone).toBeGreaterThanOrEqual(0);
            expect(tone).toBeLessThan(S.TONE_COUNT);
          }
          if (ids.length <= S.TONE_COUNT) {
            expect(new Set(tones).size).toBe(ids.length);
          }
        },
      ),
    );
  });

  it('does not depend on roster order (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
          maxLength: 9,
        }),
        (ids) => {
          const forward = tonesById(ids);
          const backward = tonesById([...ids].reverse());
          for (const id of ids) expect(backward.get(id)).toBe(forward.get(id));
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const ids = deepFreeze(
      barbers(['stefan', 'ivan', 'niko', 'aaa', 'zzz', 'b1']),
    );
    const once = S.assignBarberTones(ids);
    const twice = S.assignBarberTones(ids);
    expect(twice).toEqual(once);
    expect(ids).toEqual(['stefan', 'ivan', 'niko', 'aaa', 'zzz', 'b1']);
  });
});
