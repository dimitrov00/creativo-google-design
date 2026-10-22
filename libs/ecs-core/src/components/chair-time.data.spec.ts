import { describe, expect, it } from 'vitest';
import { ChairTime } from './chair-time.data';

/*
 * The restore guard of a chair a moved visit hands back — the booking
 * store's `isChairTime` cases («never restores a move with a malformed
 * chair», «… whose chair names no barber»), lifted onto the component and
 * the wall clock (Phase 4a 4A-9: minutes on the move's day, never instants).
 */
describe('ChairTime.is — a chair the grid can hand back', () => {
  it('takes a named barber and a forward span of the day', () => {
    expect(
      ChairTime.is({ barberId: 'petar', startMinutes: 600, endMinutes: 660 }),
    ).toBe(true);
    expect(
      ChairTime.is({ barberId: 'petar', startMinutes: 1380, endMinutes: 1440 }),
    ).toBe(true);
  });

  it('turns away a chair that ends before it starts', () => {
    expect(
      ChairTime.is({ barberId: 'ivan', startMinutes: 660, endMinutes: 600 }),
    ).toBe(false);
    expect(
      ChairTime.is({ barberId: 'ivan', startMinutes: 600, endMinutes: 600 }),
    ).toBe(false);
  });

  it('turns away a chair that names no barber — the release would silently shrink', () => {
    expect(
      ChairTime.is({ barberId: '', startMinutes: 600, endMinutes: 660 }),
    ).toBe(false);
  });

  it('turns away minutes off the day and the old instant shape', () => {
    expect(
      ChairTime.is({ barberId: 'ivan', startMinutes: -5, endMinutes: 60 }),
    ).toBe(false);
    expect(
      ChairTime.is({ barberId: 'ivan', startMinutes: 600, endMinutes: 1441 }),
    ).toBe(false);
    expect(
      ChairTime.is({ barberId: 'ivan', startMs: 1_000, endMs: 2_000 }),
    ).toBe(false);
    expect(ChairTime.is(null)).toBe(false);
  });
});
