import { describe, expect, it } from 'vitest';
import { UtcEpochMs } from '@core/primitives';
import { utcMs } from '@core/testing';
import { relativeTime } from './relative-time';

/*
 * The relative phrase of the staff day's countdown (pass D, D-6.4): real
 * elapsed time between two instants (`UtcEpochMs`), worded by
 * `Intl.RelativeTimeFormat` — never a wall-clock difference. Clocks are
 * pinned; nothing reads the wall clock.
 */
describe('relativeTime', () => {
  const now = utcMs('2026-08-05T09:00:00+03:00');
  const minutesFrom = (minutes: number): UtcEpochMs =>
    UtcEpochMs.plusMs(now, minutes * 60_000);

  it('counts minutes up to an hour, ahead and behind', () => {
    expect(relativeTime(minutesFrom(40), now, 'en')).toBe('in 40 minutes');
    expect(relativeTime(minutesFrom(-20), now, 'en')).toBe('20 minutes ago');
    expect(relativeTime(minutesFrom(40), now, 'en', 'short')).toBe(
      'in 40 min.',
    );
  });

  it('never reads "in 0 minutes" — the current minute is "this minute"', () => {
    expect(relativeTime(now, now, 'en')).toBe('this minute');
  });

  it('moves to hours, then days, then weeks, then months', () => {
    expect(relativeTime(minutesFrom(61), now, 'en')).toBe('in 1 hour');
    expect(relativeTime(minutesFrom(24 * 60), now, 'en')).toBe('tomorrow');
    expect(relativeTime(minutesFrom(-24 * 60), now, 'en')).toBe('yesterday');
    expect(relativeTime(minutesFrom(8 * 24 * 60), now, 'en')).toBe('next week');
    expect(relativeTime(minutesFrom(45 * 24 * 60), now, 'en')).toBe(
      'next month',
    );
  });

  it('speaks the active language', () => {
    expect(relativeTime(minutesFrom(40), now, 'bg', 'short')).toBe(
      'след 40 мин',
    );
  });

  it('measures ELAPSED time across a DST change, not the wall clock', () => {
    // Sofia, 2026-10-25: 03:10 EEST and the second 03:10 EET are one
    // wall-clock reading and sixty real minutes apart.
    const firstPass = utcMs('2026-10-25T03:10:00+03:00');
    const secondPass = utcMs('2026-10-25T03:10:00+02:00');
    expect(relativeTime(secondPass, firstPass, 'en')).toBe('in 1 hour');
  });

  it('is pure: same input → same output', () => {
    const target = minutesFrom(40);
    expect(relativeTime(target, now, 'en')).toBe(
      relativeTime(target, now, 'en'),
    );
  });
});
