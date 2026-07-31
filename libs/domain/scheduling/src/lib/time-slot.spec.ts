import { describe, expect, it } from 'vitest';
import { ZonedDateTime } from '@creativo/domain/kernel';
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

describe('TimeSlot.of / fromDuration — building from instants', () => {
  const zone = 'Europe/Sofia';

  function at(iso: string): ZonedDateTime {
    const result = ZonedDateTime.fromISO(iso, zone);
    if (result.isFailure()) throw new Error('bad fixture');
    return result.value;
  }

  it('builds from two instants and rejects a non-positive range', () => {
    expect(
      TimeSlot.of(at('2026-07-29T10:00'), at('2026-07-29T10:30')).isSuccess(),
    ).toBe(true);
    expect(
      TimeSlot.of(at('2026-07-29T10:00'), at('2026-07-29T10:00')).isFailure(),
    ).toBe(true);
    expect(
      TimeSlot.of(at('2026-07-29T10:30'), at('2026-07-29T10:00')).isFailure(),
    ).toBe(true);
  });

  it('fromDuration measures EXACT minutes, even across a spring-forward', () => {
    // Sofia skips 03:00–03:59 on 2026-03-29. A 45-minute service starting at
    // 02:30 therefore ENDS at 04:15 on the wall clock — 105 clock-minutes
    // later, but exactly 45 minutes of actual chair time, which is what was
    // sold. Adding wall-clock minutes instead would have ended it at 03:15,
    // a time that does not exist.
    const result = TimeSlot.fromDuration(at('2026-03-29T02:30'), 45);
    if (result.isFailure()) throw new Error('bad fixture');
    expect(result.value.durationMinutes()).toBe(45);
    expect(result.value.end.hour).toBe(4);
    expect(result.value.end.minute).toBe(15);
  });

  it('a slot NOT crossing the transition is unaffected', () => {
    const result = TimeSlot.fromDuration(at('2026-03-29T01:30'), 45);
    if (result.isFailure()) throw new Error('bad fixture');
    expect(result.value.end.hour).toBe(2);
    expect(result.value.end.minute).toBe(15);
  });

  it('abutting slots do NOT overlap — the half-open rule that lets one barber take both', () => {
    const first = TimeSlot.fromDuration(at('2026-07-29T10:00'), 45);
    const second = TimeSlot.fromDuration(at('2026-07-29T10:45'), 30);
    if (first.isFailure() || second.isFailure()) throw new Error('bad fixture');

    expect(first.value.overlaps(second.value)).toBe(false);
    expect(first.value.abuts(second.value)).toBe(true);
    expect(second.value.abuts(first.value)).toBe(true);
  });

  it('exposes epoch bounds for interval algebra', () => {
    const slot = TimeSlot.fromDuration(at('2026-07-29T10:00'), 30);
    if (slot.isFailure()) throw new Error('bad fixture');
    expect(slot.value.endMs - slot.value.startMs).toBe(30 * 60_000);
  });

  it('calendarDayKey is the local day, not a UTC one', () => {
    // 00:30 Sofia is still 21:30 UTC the previous day — the §7.1 bug.
    const slot = TimeSlot.fromDuration(at('2026-07-29T00:30'), 30);
    if (slot.isFailure()) throw new Error('bad fixture');
    expect(slot.value.calendarDayKey()).toBe('2026-07-29');
  });
});
