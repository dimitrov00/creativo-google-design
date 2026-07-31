import { describe, expect, it } from 'vitest';
import { WeeklyPattern } from './weekly-pattern';

describe('WeeklyPattern', () => {
  it('holds SEVERAL ranges on one weekday — the lunch break the old model could not express', () => {
    const result = WeeklyPattern.create({
      byWeekday: {
        tuesday: [
          { start: '09:00', end: '13:00', locationId: 'loc-center' },
          { start: '14:00', end: '18:00', locationId: 'loc-center' },
        ],
      },
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.segmentsOn('tuesday')).toHaveLength(2);
      expect(result.value.segmentsOn('tuesday')[0]?.range.toString()).toBe(
        '09:00–13:00',
      );
    }
  });

  it('sorts ranges regardless of authoring order', () => {
    const result = WeeklyPattern.create({
      byWeekday: {
        tuesday: [
          { start: '14:00', end: '18:00', locationId: 'loc-center' },
          { start: '09:00', end: '13:00', locationId: 'loc-center' },
        ],
      },
    });
    if (result.isFailure()) throw new Error('bad fixture');
    expect(
      result.value
        .segmentsOn('tuesday')
        .map((segment) => segment.range.toString()),
    ).toEqual(['09:00–13:00', '14:00–18:00']);
  });

  it('REJECTS overlapping ranges rather than merging them', () => {
    // Merging would hide an authoring mistake while quietly changing what the
    // barber is rostered for.
    const result = WeeklyPattern.create({
      byWeekday: {
        tuesday: [
          { start: '09:00', end: '14:00', locationId: 'loc-center' },
          { start: '13:00', end: '18:00', locationId: 'loc-center' },
        ],
      },
    });
    expect(result.isFailure()).toBe(true);
  });

  it('accepts ranges that merely touch — half-open, so they abut', () => {
    const result = WeeklyPattern.create({
      byWeekday: {
        tuesday: [
          { start: '09:00', end: '13:00', locationId: 'loc-center' },
          { start: '13:00', end: '18:00', locationId: 'loc-center' },
        ],
      },
    });
    expect(result.isSuccess()).toBe(true);
  });

  it('treats an absent or empty weekday as not worked', () => {
    const result = WeeklyPattern.create({
      byWeekday: {
        tuesday: [{ start: '09:00', end: '18:00', locationId: 'loc-center' }],
        wednesday: [],
      },
    });
    if (result.isFailure()) throw new Error('bad fixture');
    expect(result.value.worksOn('tuesday')).toBe(true);
    expect(result.value.worksOn('wednesday')).toBe(false);
    expect(result.value.worksOn('sunday')).toBe(false);
  });

  it('rejects a malformed or backwards range', () => {
    expect(
      WeeklyPattern.create({
        byWeekday: {
          monday: [{ start: '9:00', end: '18:00', locationId: 'loc-center' }],
        },
      }).isFailure(),
    ).toBe(true);
    expect(
      WeeklyPattern.create({
        byWeekday: {
          monday: [{ start: '18:00', end: '09:00', locationId: 'loc-center' }],
        },
      }).isFailure(),
    ).toBe(true);
    expect(
      WeeklyPattern.create({
        byWeekday: {
          monday: [{ start: '09:00', end: '09:00', locationId: 'loc-center' }],
        },
      }).isFailure(),
    ).toBe(true);
  });

  it('sums a nominal week and round-trips through props', () => {
    const result = WeeklyPattern.create({
      byWeekday: {
        monday: [
          { start: '09:00', end: '13:00', locationId: 'loc-center' },
          { start: '14:00', end: '18:00', locationId: 'loc-center' },
        ],
        saturday: [{ start: '10:00', end: '14:00', locationId: 'loc-center' }],
      },
    });
    if (result.isFailure()) throw new Error('bad fixture');
    expect(result.value.weeklyMinutes()).toBe((4 + 4 + 4) * 60);

    const round = WeeklyPattern.create(result.value.toProps());
    if (round.isFailure()) throw new Error('bad round trip');
    expect(round.value.toProps()).toEqual(result.value.toProps());
  });

  it('an empty pattern works no days', () => {
    expect(WeeklyPattern.empty().weeklyMinutes()).toBe(0);
    expect(WeeklyPattern.empty().worksOn('monday')).toBe(false);
  });
});

describe('WeeklyPattern — a segment without a valid shop', () => {
  it('rejects a segment with no location', () => {
    // Fail-closed: a segment nobody can attribute to a shop cannot be clipped
    // to any hours, so treating it as valid would offer unbounded time.
    expect(
      WeeklyPattern.create({
        byWeekday: {
          monday: [{ start: '09:00', end: '18:00', locationId: '' }],
        },
      }).isFailure(),
    ).toBe(true);
  });
});
