import { describe, expect, it } from 'vitest';
import { DayKey } from './day-key.data';
import { DayWindows } from './day-windows.data';
import { FlexibleWhen } from './flexible-when.data';
import { MinuteRange } from './minute-range.data';

const MAX = 7;
const day = (raw: string): DayKey => DayKey.of(raw);

function added(when: FlexibleWhen, raw: string): FlexibleWhen {
  const result = FlexibleWhen.withDay(when, day(raw), MAX);
  if (!result.ok) throw new Error('unexpected failure in fixture');
  return result.value;
}

describe('FlexibleWhen', () => {
  it('lists days chronologically, never in tap order', () => {
    let when = FlexibleWhen.empty();
    for (const key of ['2026-08-26', '2026-08-24', '2026-08-25']) {
      when = added(when, key);
    }
    expect(FlexibleWhen.dayKeys(when)).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
    ]);
    expect(FlexibleWhen.lastDayKey(when)).toBe('2026-08-26');
    expect(FlexibleWhen.lastDayKey(FlexibleWhen.empty())).toBeNull();
  });

  it('adds a day as "any time" — narrowing is a second, deliberate act', () => {
    const when = added(FlexibleWhen.empty(), '2026-08-26');
    const entry = FlexibleWhen.windowsFor(when, day('2026-08-26'));
    expect(entry !== null && DayWindows.isWholeDay(entry)).toBe(true);
    expect(FlexibleWhen.windowsFor(when, day('2026-08-27'))).toBeNull();
  });

  it('re-selecting a held day does NOT discard its windows', () => {
    const narrowed = FlexibleWhen.withWindows(
      added(FlexibleWhen.empty(), '2026-08-26'),
      DayWindows.of(day('2026-08-26'), [MinuteRange.of(480, 720)]),
    );
    const again = added(narrowed, '2026-08-26');
    expect(again).toBe(narrowed);
    expect(FlexibleWhen.windowsFor(again, day('2026-08-26'))?.windows).toEqual([
      MinuteRange.of(480, 720),
    ]);
  });

  it('refuses a day past the tenant cap', () => {
    let when = FlexibleWhen.empty();
    for (let index = 0; index < MAX; index++) {
      when = added(when, `2026-08-${10 + index}`);
    }
    expect(FlexibleWhen.withDay(when, day('2026-09-01'), MAX)).toEqual({
      ok: false,
      error: { code: 'scheduling.flexible_when.full', max: MAX },
    });
  });

  it('forgets a removed day’s windows — re-adding starts clean', () => {
    const narrowed = FlexibleWhen.withWindows(
      added(FlexibleWhen.empty(), '2026-08-26'),
      DayWindows.of(day('2026-08-26'), [MinuteRange.of(480, 720)]),
    );
    const removed = FlexibleWhen.withoutDay(narrowed, day('2026-08-26'));
    expect(FlexibleWhen.isEmpty(removed)).toBe(true);
    const readded = added(removed, '2026-08-26');
    const entry = FlexibleWhen.windowsFor(readded, day('2026-08-26'));
    expect(entry !== null && DayWindows.isWholeDay(entry)).toBe(true);
  });

  it('ignores windows for a day that is not selected, and removing an absent day', () => {
    const when = FlexibleWhen.withWindows(
      FlexibleWhen.empty(),
      DayWindows.of(day('2026-08-26'), [MinuteRange.of(480, 720)]),
    );
    expect(FlexibleWhen.isEmpty(when)).toBe(true);
    const one = added(FlexibleWhen.empty(), '2026-08-25');
    expect(FlexibleWhen.withoutDay(one, day('2026-08-26'))).toBe(one);
    expect(FlexibleWhen.has(one, day('2026-08-25'))).toBe(true);
  });

  it('of() keeps one entry per day — the later one — chronologically', () => {
    const when = FlexibleWhen.of([
      DayWindows.wholeDay(day('2026-08-26')),
      DayWindows.of(day('2026-08-25'), [MinuteRange.of(480, 720)]),
      DayWindows.of(day('2026-08-26'), [MinuteRange.of(900, 990)]),
    ]);
    expect(when).toEqual({
      days: [
        {
          dayKey: '2026-08-25',
          windows: [{ startMinutes: 480, endMinutes: 720 }],
        },
        {
          dayKey: '2026-08-26',
          windows: [{ startMinutes: 900, endMinutes: 990 }],
        },
      ],
    });
  });
});

describe('FlexibleWhen.is — the edge guard', () => {
  it('takes a stored declaration, verbatim', () => {
    const stored = {
      days: [
        { dayKey: '2026-08-25', windows: [] },
        {
          dayKey: '2026-08-26',
          windows: [
            { startMinutes: 480, endMinutes: 720 },
            { startMinutes: 900, endMinutes: 990 },
          ],
        },
      ],
    };
    expect(FlexibleWhen.is(stored)).toBe(true);
    expect(FlexibleWhen.is({ days: [] })).toBe(true);
  });

  it.each([
    null,
    {},
    { days: 'x' },
    { days: [{ dayKey: 'nope', windows: [] }] },
    {
      days: [
        { dayKey: '2026-08-26', windows: [] },
        { dayKey: '2026-08-25', windows: [] },
      ],
    },
    {
      days: [
        { dayKey: '2026-08-26', windows: [] },
        { dayKey: '2026-08-26', windows: [] },
      ],
    },
  ])('refuses %j', (raw) => {
    expect(FlexibleWhen.is(raw)).toBe(false);
  });
});
