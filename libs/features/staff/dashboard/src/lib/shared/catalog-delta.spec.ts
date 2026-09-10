import { describe, expect, it } from 'vitest';
import {
  catalogMinutesOf,
  catalogTagOf,
  minutesDeltaLabel,
} from './catalog-delta';

const label = (minutes: number) => `${minutes} мин`;

describe('the catalogue delta', () => {
  it('sums the catalogue, and lets a retired service stand at its booked length', () => {
    const seats = [
      { catalog: 45, booked: 30 },
      { catalog: null, booked: 20 },
    ];
    expect(
      catalogMinutesOf(
        seats,
        (seat) => seat.catalog,
        (seat) => seat.booked,
      ),
    ).toBe(65);
    expect(
      catalogMinutesOf(
        [],
        () => 10,
        () => 10,
      ),
    ).toBeNull();
  });

  it('writes the distance with a true minus, never a hyphen', () => {
    expect(minutesDeltaLabel(-5, label)).toBe('−5 мин');
    expect(minutesDeltaLabel(15, label)).toBe('+15 мин');
  });

  it('tags only a visit that runs off the catalogue, and only when the catalogue can say', () => {
    expect(catalogTagOf(45, 50, label)).toBe('−5 мин');
    expect(catalogTagOf(60, 45, label)).toBe('+15 мин');
    expect(catalogTagOf(45, 45, label)).toBeNull();
    expect(catalogTagOf(45, null, label)).toBeNull();
  });
});
