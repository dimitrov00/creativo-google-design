import { describe, expect, it } from 'vitest';
import { WorkingHours, WorkingHoursRange } from './working-hours';
import {
  InvalidTimeOfDayError,
  InvalidWorkingHoursRangeError,
} from './working-hours.errors';

describe('WorkingHoursRange.create', () => {
  it('accepts a valid HH:mm range', () => {
    const result = WorkingHoursRange.create('monday', {
      start: '09:00',
      end: '18:00',
    });
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects a malformed start time', () => {
    const result = WorkingHoursRange.create('monday', {
      start: '9:00',
      end: '18:00',
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(InvalidTimeOfDayError);
    }
  });

  it('rejects a malformed end time', () => {
    const result = WorkingHoursRange.create('monday', {
      start: '09:00',
      end: '25:00',
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects end not after start', () => {
    const result = WorkingHoursRange.create('monday', {
      start: '18:00',
      end: '09:00',
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(InvalidWorkingHoursRangeError);
    }
  });
});

describe('WorkingHours.create', () => {
  it('creates a schedule from a partial weekday map', () => {
    const result = WorkingHours.create({
      monday: { start: '09:00', end: '18:00' },
      saturday: { start: '10:00', end: '14:00' },
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.rangeFor('monday')).not.toBeNull();
      expect(result.value.rangeFor('sunday')).toBeNull();
    }
  });

  it('collects errors across multiple invalid days', () => {
    const result = WorkingHours.create({
      monday: { start: '9:00', end: '18:00' },
      tuesday: { start: '18:00', end: '09:00' },
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toHaveLength(2);
    }
  });

  it('round-trips via toEntries()', () => {
    const entries = { monday: { start: '09:00', end: '18:00' } };
    const result = WorkingHours.create(entries);
    if (result.isFailure()) throw new Error('bad fixture');
    expect(result.value.toEntries()).toEqual(entries);
  });

  it('an empty schedule is valid (every day closed)', () => {
    const result = WorkingHours.create({});
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.rangeFor('monday')).toBeNull();
    }
  });
});
