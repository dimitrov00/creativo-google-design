import { describe, expect, it } from 'vitest';
import { TimeSlot } from './time-slot';
import { InvalidTimeSlotRangeError } from './time-slot.errors';

const zone = 'Europe/Sofia';

describe('TimeSlot.create', () => {
  it('creates a valid slot', () => {
    const result = TimeSlot.create({
      startIso: '2026-06-01T10:00:00',
      endIso: '2026-06-01T10:30:00',
      zone,
    });
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects a slot where end is not after start', () => {
    const result = TimeSlot.create({
      startIso: '2026-06-01T10:30:00',
      endIso: '2026-06-01T10:00:00',
      zone,
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(InvalidTimeSlotRangeError);
    }
  });

  it('rejects an equal start and end', () => {
    const result = TimeSlot.create({
      startIso: '2026-06-01T10:00:00',
      endIso: '2026-06-01T10:00:00',
      zone,
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an invalid ISO string', () => {
    const result = TimeSlot.create({
      startIso: 'not-a-date',
      endIso: '2026-06-01T10:30:00',
      zone,
    });
    expect(result.isFailure()).toBe(true);
  });
});

describe('TimeSlot.overlaps / contains', () => {
  function slot(startIso: string, endIso: string): TimeSlot {
    const r = TimeSlot.create({ startIso, endIso, zone });
    if (r.isFailure()) throw new Error('bad fixture');
    return r.value;
  }

  it('detects overlapping slots', () => {
    const a = slot('2026-06-01T10:00:00', '2026-06-01T11:00:00');
    const b = slot('2026-06-01T10:30:00', '2026-06-01T11:30:00');
    expect(a.overlaps(b)).toBe(true);
  });

  it('detects non-overlapping slots', () => {
    const a = slot('2026-06-01T10:00:00', '2026-06-01T11:00:00');
    const b = slot('2026-06-01T11:00:00', '2026-06-01T12:00:00');
    expect(a.overlaps(b)).toBe(false);
  });

  it('contains a sub-interval', () => {
    const outer = slot('2026-06-01T10:00:00', '2026-06-01T12:00:00');
    const inner = slot('2026-06-01T10:30:00', '2026-06-01T11:00:00');
    expect(outer.contains(inner)).toBe(true);
    expect(inner.contains(outer)).toBe(false);
  });
});

describe('TimeSlot.calendarDayKey / isSameCalendarDayAs (blueprint §7.1)', () => {
  it('derives the calendar day only from ZonedDateTime accessors', () => {
    const slot1 = TimeSlot.create({
      startIso: '2026-06-01T23:45:00',
      endIso: '2026-06-01T23:59:00',
      zone,
    });
    if (slot1.isFailure()) throw new Error('bad fixture');
    expect(slot1.value.calendarDayKey()).toBe('2026-06-01');
  });

  it('same calendar day is detected regardless of the exact instant', () => {
    const morning = TimeSlot.create({
      startIso: '2026-06-01T08:00:00',
      endIso: '2026-06-01T08:30:00',
      zone,
    });
    const evening = TimeSlot.create({
      startIso: '2026-06-01T20:00:00',
      endIso: '2026-06-01T20:30:00',
      zone,
    });
    if (morning.isFailure() || evening.isFailure())
      throw new Error('bad fixture');
    expect(morning.value.isSameCalendarDayAs(evening.value)).toBe(true);
  });

  it('a different calendar day is detected', () => {
    const day1 = TimeSlot.create({
      startIso: '2026-06-01T23:45:00',
      endIso: '2026-06-01T23:59:00',
      zone,
    });
    const day2 = TimeSlot.create({
      startIso: '2026-06-02T00:05:00',
      endIso: '2026-06-02T00:30:00',
      zone,
    });
    if (day1.isFailure() || day2.isFailure()) throw new Error('bad fixture');
    expect(day1.value.isSameCalendarDayAs(day2.value)).toBe(false);
  });
});
