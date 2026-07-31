import { describe, expect, it } from 'vitest';
import { CalendarDay } from './calendar-day';
import { StaffScheduleHistory, StaffScheduleVersion } from './staff-schedule';
import { WeeklyPattern } from './weekly-pattern';

const zone = 'Europe/Sofia';

function day(key: string): CalendarDay {
  const result = CalendarDay.create(key, zone);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function pattern(
  hours: readonly [string, string],
  at = 'loc-center',
): WeeklyPattern {
  const segment = { start: hours[0], end: hours[1], locationId: at };
  const result = WeeklyPattern.create({
    byWeekday: {
      monday: [segment],
      tuesday: [segment],
      wednesday: [segment],
      thursday: [segment],
      friday: [segment],
    },
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

describe('StaffScheduleHistory.versionFor', () => {
  it('finds the version in force, and nothing before the first one began', () => {
    const history = StaffScheduleHistory.startingWith(
      pattern(['09:00', '18:00']),
      day('2026-07-01'),
    );
    expect(history.versionFor(day('2026-07-29'))).not.toBeNull();
    expect(history.versionFor(day('2026-06-30'))).toBeNull();
  });

  it('an open-ended version covers every later day', () => {
    const history = StaffScheduleHistory.startingWith(
      pattern(['09:00', '18:00']),
      day('2026-07-01'),
    );
    expect(history.versionFor(day('2030-01-01'))).not.toBeNull();
  });
});

describe('StaffScheduleHistory.amend — the guarantee that history stays stable', () => {
  it('closes the old version the day before the new one starts', () => {
    const history = StaffScheduleHistory.startingWith(
      pattern(['09:00', '18:00']),
      day('2026-07-01'),
    );
    const amended = history.amend(
      pattern(['10:00', '19:00']),
      day('2026-08-03'),
    );
    if (amended.isFailure()) throw new Error('bad fixture');

    const versions = amended.value.all();
    expect(versions).toHaveLength(2);
    expect(versions[0]?.effectiveTo?.key()).toBe('2026-08-02');
    expect(versions[1]?.effectiveFrom.key()).toBe('2026-08-03');
    expect(versions[1]?.seq).toBe(1);
    expect(versions[1]?.isOpenEnded()).toBe(true);
  });

  it('leaves the OLD pattern answering for old days — the whole reason for versioning', () => {
    // If amending rewrote the pattern in place, every utilisation figure for
    // July would silently divide by the new hours.
    const history = StaffScheduleHistory.startingWith(
      pattern(['09:00', '18:00']),
      day('2026-07-01'),
    );
    const amended = history.amend(
      pattern(['10:00', '19:00']),
      day('2026-08-03'),
    );
    if (amended.isFailure()) throw new Error('bad fixture');

    const july = amended.value.versionFor(day('2026-07-15'));
    const august = amended.value.versionFor(day('2026-08-10'));
    expect(july?.pattern.segmentsOn('wednesday')[0]?.start.toString()).toBe(
      '09:00',
    );
    expect(august?.pattern.segmentsOn('monday')[0]?.start.toString()).toBe(
      '10:00',
    );
  });

  it('REFUSES a retroactive amendment', () => {
    // A "correction" reaching backwards is the silent restatement this type
    // exists to prevent — real past corrections are ScheduleExceptions.
    const history = StaffScheduleHistory.startingWith(
      pattern(['09:00', '18:00']),
      day('2026-07-01'),
    );
    const result = history.amend(
      pattern(['10:00', '19:00']),
      day('2026-06-15'),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe(
        'scheduling.staff_schedule.retroactive_amendment',
      );
    }
  });

  it('refuses an amendment effective the same day the current version began', () => {
    const history = StaffScheduleHistory.startingWith(
      pattern(['09:00', '18:00']),
      day('2026-07-01'),
    );
    expect(
      history.amend(pattern(['10:00', '19:00']), day('2026-07-01')).isFailure(),
    ).toBe(true);
  });

  it('chains several amendments, each answering for its own period', () => {
    const first = StaffScheduleHistory.startingWith(
      pattern(['09:00', '18:00']),
      day('2026-01-01'),
    );
    const second = first.amend(pattern(['10:00', '19:00']), day('2026-04-01'));
    if (second.isFailure()) throw new Error('bad fixture');
    const third = second.value.amend(
      pattern(['08:00', '16:00']),
      day('2026-07-01'),
    );
    if (third.isFailure()) throw new Error('bad fixture');

    expect(third.value.all()).toHaveLength(3);
    const at = (key: string) =>
      third.value
        .versionFor(day(key))
        ?.pattern.segmentsOn('thursday')[0]
        ?.start.toString();
    expect(at('2026-02-01')).toBe('09:00');
    expect(at('2026-05-01')).toBe('10:00');
    expect(at('2026-08-01')).toBe('08:00');
  });
});

describe('StaffScheduleHistory.create', () => {
  it('rejects overlapping versions — exactly one pattern per day', () => {
    const result = StaffScheduleHistory.create([
      StaffScheduleVersion.of({
        seq: 0,
        effectiveFrom: day('2026-01-01'),
        effectiveTo: day('2026-06-30'),
        pattern: pattern(['09:00', '18:00']),
      }),
      StaffScheduleVersion.of({
        seq: 1,
        effectiveFrom: day('2026-06-01'),
        effectiveTo: null,
        pattern: pattern(['10:00', '19:00']),
      }),
    ]);
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an open-ended version followed by another', () => {
    const result = StaffScheduleHistory.create([
      StaffScheduleVersion.of({
        seq: 0,
        effectiveFrom: day('2026-01-01'),
        effectiveTo: null,
        pattern: pattern(['09:00', '18:00']),
      }),
      StaffScheduleVersion.of({
        seq: 1,
        effectiveFrom: day('2026-07-01'),
        effectiveTo: null,
        pattern: pattern(['10:00', '19:00']),
      }),
    ]);
    expect(result.isFailure()).toBe(true);
  });

  it('accepts adjacent, non-overlapping versions in any input order', () => {
    const later = StaffScheduleVersion.of({
      seq: 1,
      effectiveFrom: day('2026-07-01'),
      effectiveTo: null,
      pattern: pattern(['10:00', '19:00']),
    });
    const earlier = StaffScheduleVersion.of({
      seq: 0,
      effectiveFrom: day('2026-01-01'),
      effectiveTo: day('2026-06-30'),
      pattern: pattern(['09:00', '18:00']),
    });
    const result = StaffScheduleHistory.create([later, earlier]);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.all()[0]?.seq).toBe(0);
    }
  });
});
