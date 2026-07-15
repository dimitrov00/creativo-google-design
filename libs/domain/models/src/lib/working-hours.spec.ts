import { describe, expect, it } from 'vitest';
import { WorkingHours } from './working-hours';

describe('WorkingHours.create', () => {
  it('accepts a valid partial week', () => {
    const result = WorkingHours.create({
      monday: { start: '09:00', end: '18:00' },
      friday: { start: '09:00', end: '15:00' },
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.rangeFor('monday')?.start).toBe('09:00');
      expect(result.value.rangeFor('tuesday')).toBeNull();
    }
  });

  it('accepts an empty week', () => {
    expect(WorkingHours.create({}).isSuccess()).toBe(true);
  });

  it('rejects a malformed time', () => {
    const result = WorkingHours.create({
      monday: { start: '9am', end: '18:00' },
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects end <= start for a day', () => {
    const result = WorkingHours.create({
      monday: { start: '18:00', end: '09:00' },
    });
    expect(result.isFailure()).toBe(true);
  });

  it('round-trips via toEntries()', () => {
    const props = { monday: { start: '09:00', end: '18:00' } };
    const result = WorkingHours.create(props);
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(result.value.toEntries()).toEqual(props);
  });
});
