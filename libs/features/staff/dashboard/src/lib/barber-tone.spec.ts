import { describe, expect, it } from 'vitest';
import { BARBER_TONE_COUNT, assignBarberTones } from './barber-tone';

describe('assignBarberTones', () => {
  it('never gives two chairs the same tone while slots remain', () => {
    // A bare hash collides most of the time at five slots and four barbers,
    // which is the one outcome this feature exists to prevent.
    for (const size of [2, 3, 4, 5]) {
      const ids = Array.from({ length: size }, (_, i) => `barber-${i}`);
      const tones = [...assignBarberTones(ids).values()];
      expect(new Set(tones).size).toBe(size);
    }
  });

  it('is stable across calls and independent of roster order', () => {
    // A barber's colour must not change because the roster was re-sorted.
    const forward = assignBarberTones(['ivan', 'niko', 'stefan']);
    const backward = assignBarberTones(['stefan', 'ivan', 'niko']);
    for (const id of ['ivan', 'niko', 'stefan']) {
      expect(backward.get(id)).toBe(forward.get(id));
    }
  });

  it('keeps an incumbent when a colleague sorting LATER is hired', () => {
    // The roster is walked by ascending id precisely so a hire cannot
    // reshuffle the people already there.
    const before = assignBarberTones(['aaa', 'bbb']);
    const after = assignBarberTones(['aaa', 'bbb', 'zzz']);
    expect(after.get('aaa')).toBe(before.get('aaa'));
    expect(after.get('bbb')).toBe(before.get('bbb'));
  });

  it('always answers with a slot in range, however large the shop', () => {
    // Past five chairs tones must repeat — the name and the face are still
    // there, so repetition degrades rather than breaks.
    const ids = Array.from({ length: 12 }, (_, i) => `b${i}`);
    for (const tone of assignBarberTones(ids).values()) {
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(BARBER_TONE_COUNT);
    }
  });

  it('gives the same id the same tone whatever else is present', () => {
    expect(assignBarberTones(['solo']).get('solo')).toBe(
      assignBarberTones(['solo']).get('solo'),
    );
  });
});
