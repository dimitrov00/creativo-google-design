import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { BookingStatus, Tag } from '@core/primitives';
import {
  SCHEDULE_STATUSES,
  ScheduleStatusFilter,
} from './schedule-status-filter';

const KEY = 'staff-schedule-hidden-statuses';

function fresh(): ScheduleStatusFilter {
  TestBed.resetTestingModule();
  return TestBed.inject(ScheduleStatusFilter);
}

describe('ScheduleStatusFilter', () => {
  afterEach(() => localStorage.clear());

  it('lists every booking state once, live first', () => {
    expect([...SCHEDULE_STATUSES].sort()).toEqual(
      [...Tag.values(BookingStatus)].sort(),
    );
    expect(SCHEDULE_STATUSES[0]).toBe(BookingStatus.Confirmed);
  });

  it('draws everything until a state is hidden, and says when it filters', () => {
    const filter = fresh();
    expect(filter.hidden()).toEqual([]);
    expect(filter.filtering()).toBe(false);

    filter.toggle(BookingStatus.Cancelled);
    expect(filter.isShown(BookingStatus.Cancelled)).toBe(false);
    expect(filter.isShown(BookingStatus.Confirmed)).toBe(true);
    expect(filter.filtering()).toBe(true);

    filter.toggle(BookingStatus.Cancelled);
    expect(filter.filtering()).toBe(false);
  });

  it('keeps the choice on the device, and drops what it cannot read', () => {
    fresh().toggle(BookingStatus.NoShow);
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual([
      BookingStatus.NoShow,
    ]);
    expect(fresh().hidden()).toEqual([BookingStatus.NoShow]);

    localStorage.setItem(KEY, JSON.stringify(['NO_SHOW', 'GONE', 7]));
    expect(fresh().hidden()).toEqual([BookingStatus.NoShow]);
    localStorage.setItem(KEY, '{not json');
    expect(fresh().hidden()).toEqual([]);
  });

  it('hides blocked time on its own switch, kept on the device, and says it filters', () => {
    const filter = fresh();
    expect(filter.blocksShown()).toBe(true);
    filter.toggleBlocks();
    expect(filter.blocksShown()).toBe(false);
    expect(filter.filtering()).toBe(true);
    expect(fresh().blocksShown()).toBe(false);
  });

  it('draws free time only when asked — showing more is not a filter', () => {
    const filter = fresh();
    expect(filter.freeTimeShown()).toBe(false);
    filter.toggleFreeTime();
    expect(filter.freeTimeShown()).toBe(true);
    expect(filter.filtering()).toBe(false);
    expect(fresh().freeTimeShown()).toBe(true);
  });

  it('shows everything again in one act, blocked time included', () => {
    const filter = fresh();
    filter.toggle(BookingStatus.NoShow);
    filter.toggle(BookingStatus.Cancelled);
    filter.toggleBlocks();
    filter.toggleFreeTime();
    filter.showAll();
    expect(filter.hidden()).toEqual([]);
    expect(filter.blocksShown()).toBe(true);
    // Back to the defaults: free time is off again.
    expect(filter.freeTimeShown()).toBe(false);
    expect(fresh().hidden()).toEqual([]);
    expect(fresh().blocksShown()).toBe(true);
  });
});
