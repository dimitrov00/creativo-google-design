import { describe, expect, it } from 'vitest';
import { deepFreeze, localDate, minute } from '@core/testing';
import { WallTime } from './wall-time.data';

describe('WallTime.toLocalIso — the datetime-local wire text (a text join, no zone)', () => {
  it('joins the shop day and the zero-padded 24-hour HH:MM with a T', () => {
    expect(
      WallTime.toLocalIso(WallTime.of(localDate('2026-03-29'), minute(210))),
    ).toBe('2026-03-29T03:30');
    expect(
      WallTime.toLocalIso(WallTime.of(localDate('2026-10-25'), minute(0))),
    ).toBe('2026-10-25T00:00');
    expect(
      WallTime.toLocalIso(WallTime.of(localDate('2026-12-31'), minute(1439))),
    ).toBe('2026-12-31T23:59');
    expect(
      WallTime.toLocalIso(WallTime.of(localDate('2026-01-05'), minute(545))),
    ).toBe('2026-01-05T09:05');
  });

  it('spells what the two hand joins it replaces spelled (`translate-coded-error`, `admin-programs`)', () => {
    const pad2 = (value: number): string => String(value).padStart(2, '0');
    for (let at = 0; at < 1440; at += 7) {
      const day = localDate('2026-03-29');
      expect(WallTime.toLocalIso(WallTime.of(day, minute(at)))).toBe(
        `${day}T${pad2(Math.floor(at / 60))}:${pad2(at % 60)}`,
      );
    }
  });

  it('reads a struct carrying `localDate` and `minute` as it is — a DST-gap refusal passes straight in', () => {
    const refusal = {
      errorCode: 'DST_GAP_INVALID_TIME',
      localDate: localDate('2026-03-29'),
      minute: minute(210),
      timeZone: 'Europe/Sofia',
    };
    expect(WallTime.toLocalIso(refusal)).toBe('2026-03-29T03:30');
  });

  it('is pure: same input → same output, input untouched', () => {
    const time = deepFreeze(WallTime.of(localDate('2026-03-29'), minute(210)));
    expect(WallTime.toLocalIso(time)).toBe(WallTime.toLocalIso(time));
    expect(time).toEqual({ localDate: '2026-03-29', minute: 210 });
  });
});
