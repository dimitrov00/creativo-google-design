import { describe, expect, it } from 'vitest';
import { BarberId, LocalDate } from '@core/primitives';
import { unwrapOk } from '@core/testing';
import { analyticsEntryQueryOf } from './analytics-entry';

const DAY = unwrapOk(LocalDate.parse('2026-08-05'));
const IVAN = BarberId.of('ivan');

describe('analyticsEntryQueryOf', () => {
  it('a reader of the shop’s viewing one chair opens that barber’s day', () => {
    expect(analyticsEntryQueryOf(true, IVAN, DAY)).toEqual({
      span: 'DAY',
      from: DAY,
      barber: IVAN,
    });
  });

  it('a reader of the shop’s viewing every chair opens the shop (no barber)', () => {
    expect(analyticsEntryQueryOf(true, null, DAY)).toEqual({
      span: 'DAY',
      from: DAY,
    });
  });

  it('a reader of their own opens their own, whatever chair the book shows', () => {
    expect(analyticsEntryQueryOf(false, IVAN, DAY)).toEqual({
      span: 'DAY',
      from: DAY,
    });
    expect(analyticsEntryQueryOf(false, null, DAY)).toEqual({
      span: 'DAY',
      from: DAY,
    });
  });
});
