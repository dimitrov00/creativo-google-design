import { describe, expect, it } from 'vitest';
import { LocalDate } from '@core/primitives';
import { deepFreeze, unwrapOk } from '@core/testing';
import { BarberEmployment } from './barber-employment.data';

const day = (raw: string): LocalDate => unwrapOk(LocalDate.parse(raw));

describe('BarberEmployment.covers', () => {
  const open = deepFreeze<BarberEmployment>({
    barberStartsLocalDate: day('2026-12-01'),
    barberLastWorkingLocalDate: null,
  });
  const ending = deepFreeze<BarberEmployment>({
    barberStartsLocalDate: day('2026-12-01'),
    barberLastWorkingLocalDate: day('2026-12-31'),
  });

  it('starts on the start day, inclusive, and never ends while no last day is set', () => {
    expect(BarberEmployment.covers(open, day('2026-11-30'))).toBe(false);
    expect(BarberEmployment.covers(open, day('2026-12-01'))).toBe(true);
    expect(BarberEmployment.covers(open, day('2030-01-01'))).toBe(true);
  });

  it('ends on the last working day, inclusive', () => {
    expect(BarberEmployment.covers(ending, day('2026-12-31'))).toBe(true);
    expect(BarberEmployment.covers(ending, day('2027-01-01'))).toBe(false);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const once = BarberEmployment.covers(ending, day('2026-12-15'));
    expect(BarberEmployment.covers(ending, day('2026-12-15'))).toBe(once);
  });
});
