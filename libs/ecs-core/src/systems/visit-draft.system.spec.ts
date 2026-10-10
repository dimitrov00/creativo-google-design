import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DayKey } from '../components/day-key.data';
import {
  Frequency,
  RecurrenceEndKind,
  RecurrenceRule,
} from '../components/recurrence-rule.data';
import { Weekday } from '../components/weekday.data';
import { deepFreeze, unwrapOk } from '../testing';
import { RecurrenceSystem } from './recurrence.system';
import { RepeatPreset, VisitDraftSystem } from './visit-draft.system';

/*
 * COPIED and re-targeted:
 * - every case of libs/features/staff/dashboard/src/lib/block-editor/
 *   block-repeat.spec.ts (8) — `CalendarDay` → `DayKey`, the legacy rule
 *   class → the `RecurrenceRule` struct (`with` → `RecurrenceRule.create`,
 *   weekday names → ISO numbers, `{ frequency }` → `{ kind }`), the series
 *   → `RecurrenceSystem.series`;
 * - every case of libs/features/staff/dashboard/src/lib/shared/
 *   walk-in-labels.spec.ts (5, one a property) — the legacy map → the
 *   first-seen list of `{ personId, label }`;
 * - every case of libs/features/staff/dashboard/src/lib/shared/
 *   catalog-delta.spec.ts (3) — accessors → structs; the `−5 мин` wording
 *   stays in the presenter, so the label assertions read the signed delta.
 * Plus the span and placeholder rules of the visit editor's draft
 * (`staff-visit-editor.ts` `spanOf`/`seedDraft`/`adoptPlaceholderLegs`),
 * properties and the purity case.
 */

const S = VisitDraftSystem;

/* ── block-repeat.spec.ts ─────────────────────────────────────────────── */

function day(key: string): DayKey {
  if (!DayKey.isValid(key)) throw new Error(`bad fixture ${key}`);
  return DayKey.of(key);
}

function keys(start: DayKey, rule: RecurrenceRule | null): readonly string[] {
  if (rule === null) return [start];
  return unwrapOk(RecurrenceSystem.series(start, rule)).dayKeys;
}

function endKey(end: RecurrenceRule.End): string {
  return end.kind === RecurrenceEndKind.Until ? end.dayKey : `×${end.count}`;
}

function withRule(
  rule: RecurrenceRule,
  patch: {
    readonly pattern?: RecurrenceRule.Pattern;
    readonly interval?: number;
  },
): RecurrenceRule {
  return unwrapOk(
    RecurrenceRule.create(
      patch.pattern ?? rule.pattern,
      patch.interval ?? rule.interval,
      rule.end,
    ),
  );
}

// 2026-09-24 is a Thursday.
const thursday = day('2026-09-24');

describe('the repeat page policy', () => {
  it('ends a series by default on a DATE — four weeks, half a year, four years', () => {
    expect(endKey(S.defaultEnd(Frequency.Daily, thursday))).toBe('2026-10-22');
    expect(endKey(S.defaultEnd(Frequency.Weekly, thursday))).toBe('2026-10-22');
    expect(endKey(S.defaultEnd(Frequency.Monthly, thursday))).toBe(
      '2027-03-24',
    );
    expect(endKey(S.defaultEnd(Frequency.Yearly, thursday))).toBe('2030-09-24');
    // The 31st has no 31st six months on: the month's last day instead.
    expect(endKey(S.defaultEnd(Frequency.Monthly, day('2026-08-31')))).toBe(
      '2027-02-28',
    );
  });

  it('turns every shortcut into its rule from the start — and reads it back', () => {
    for (const preset of [
      RepeatPreset.Daily,
      RepeatPreset.Weekdays,
      RepeatPreset.Weekly,
      RepeatPreset.Monthly,
      RepeatPreset.Yearly,
    ] as const) {
      const rule = S.ruleForPreset(preset, thursday, null);
      expect(S.presetOf(rule, thursday)).toBe(preset);
    }
    expect(S.ruleForPreset(RepeatPreset.Never, thursday, null)).toBeNull();
    expect(S.presetOf(null, thursday)).toBe(RepeatPreset.Never);
    // «Всяка седмица» from a Thursday is Thursdays, for four weeks.
    expect(
      keys(thursday, S.ruleForPreset(RepeatPreset.Weekly, thursday, null)),
    ).toEqual([
      '2026-09-24',
      '2026-10-01',
      '2026-10-08',
      '2026-10-15',
      '2026-10-22',
    ]);
    // «Делнични дни» skips the weekend.
    expect(
      keys(
        thursday,
        S.ruleForPreset(RepeatPreset.Weekdays, thursday, null),
      ).slice(0, 4),
    ).toEqual(['2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29']);
  });

  it('is no shortcut once shaped: another day, another interval', () => {
    const weekly = S.ruleForPreset(RepeatPreset.Weekly, thursday, null);
    if (weekly === null) throw new Error('fixture');
    const fortnightly = withRule(weekly, { interval: 2 });
    expect(S.presetOf(fortnightly, thursday)).toBeNull();
    const mondays = withRule(weekly, {
      pattern: { kind: Frequency.Weekly, weekdays: [Weekday.Mon] },
    });
    expect(S.presetOf(mondays, thursday)).toBeNull();
  });

  it('keeps the end a series had when the shortcut changes, unless it no longer fits', () => {
    const daily = S.ruleForPreset(RepeatPreset.Daily, thursday, null);
    const weekly = S.ruleForPreset(RepeatPreset.Weekly, thursday, daily);
    expect(weekly && endKey(weekly.end)).toBe('2026-10-22');
    // A yearly series four years long turned daily would be ~1,500 days:
    // past the cap, so the new frequency's own end is taken instead.
    const yearly = S.ruleForPreset(RepeatPreset.Yearly, thursday, null);
    const dailyAgain = S.ruleForPreset(RepeatPreset.Daily, thursday, yearly);
    expect(dailyAgain && endKey(dailyAgain.end)).toBe('2026-10-22');
  });

  it("starts «Персонализирано» at Google's own default, or keeps the rule there is", () => {
    const custom = S.ruleForCustom(thursday, null);
    expect(custom?.pattern).toEqual({
      kind: Frequency.Weekly,
      weekdays: [Weekday.Thu],
    });
    const monthly = S.ruleForPreset(RepeatPreset.Monthly, thursday, null);
    expect(S.ruleForCustom(thursday, monthly)).toBe(monthly);
  });

  it("changes the frequency to the start's own days for it, keeping interval and end", () => {
    const weekly = S.ruleForPreset(RepeatPreset.Weekly, thursday, null);
    if (weekly === null) throw new Error('fixture');
    const every2 = withRule(weekly, { interval: 2 });
    const monthly = S.ruleForFrequency(every2, Frequency.Monthly, thursday);
    expect(monthly.pattern).toEqual({
      kind: Frequency.Monthly,
      day: { kind: 'date', date: 24 },
    });
    expect(monthly.interval).toBe(2);
  });

  it('switches how it ends WITHOUT changing the days', () => {
    const weekly = S.ruleForPreset(RepeatPreset.Weekly, thursday, null);
    if (weekly === null) throw new Error('fixture');
    const counted = S.ruleForEndKind(weekly, RecurrenceEndKind.Count, thursday);
    expect(counted.end).toEqual({ kind: 'count', count: 5 });
    expect(keys(thursday, counted)).toEqual(keys(thursday, weekly));
    const dated = S.ruleForEndKind(counted, RecurrenceEndKind.Until, thursday);
    expect(endKey(dated.end)).toBe('2026-10-22');
    expect(keys(thursday, dated)).toEqual(keys(thursday, weekly));
  });

  it("follows the frame to another day: the start's weekday moves, an overtaken end moves on", () => {
    const weekly = S.ruleForPreset(RepeatPreset.Weekly, thursday, null);
    if (weekly === null) throw new Error('fixture');
    const friday = S.ruleForStart(weekly, thursday, day('2026-09-25'));
    expect(friday.pattern).toEqual({
      kind: Frequency.Weekly,
      weekdays: [Weekday.Fri],
    });
    expect(endKey(friday.end)).toBe('2026-10-22');
    // Stepped past its own end: the end moves four weeks on from there.
    const later = S.ruleForStart(weekly, thursday, day('2026-11-05'));
    expect(endKey(later.end)).toBe('2026-12-03');
  });
});

describe('the repeat page policy — identities and fallbacks', () => {
  const weekly = S.ruleForPreset(
    RepeatPreset.Weekly,
    thursday,
    null,
  ) as RecurrenceRule;

  it('hands back the same rule when nothing is asked to change', () => {
    expect(S.ruleForFrequency(weekly, Frequency.Weekly, thursday)).toBe(weekly);
    expect(S.ruleForEndKind(weekly, RecurrenceEndKind.Until, thursday)).toBe(
      weekly,
    );
  });

  it('counts ten when a series that cannot be walked turns to a count', () => {
    // An until before the start makes no series from it.
    const stale = unwrapOk(
      RecurrenceRule.create(weekly.pattern, 1, {
        kind: RecurrenceEndKind.Until,
        dayKey: day('2026-09-01'),
      }),
    );
    expect(
      S.ruleForEndKind(stale, RecurrenceEndKind.Count, thursday).end,
    ).toEqual({ kind: 'count', count: 10 });
    const counted = unwrapOk(
      RecurrenceRule.create(weekly.pattern, 1, {
        kind: RecurrenceEndKind.Count,
        count: 3,
      }),
    );
    // From a count with no walkable series, the frequency's default date.
    expect(
      endKey(
        S.ruleForEndKind(
          unwrapOk(
            RecurrenceRule.create(
              { kind: Frequency.Monthly, day: { kind: 'date', date: 31 } },
              12,
              { kind: RecurrenceEndKind.Count, count: 3 },
            ),
          ),
          RecurrenceEndKind.Until,
          day('2026-02-01'),
        ).end,
      ),
    ).toBe('2026-08-01');
    expect(
      endKey(S.ruleForEndKind(counted, RecurrenceEndKind.Until, thursday).end),
    ).toBe('2026-10-08');
  });

  it('reads the five shortcuts in the page order, Monday to Friday as the working week', () => {
    expect(S.REPEAT_PRESETS).toEqual([
      'never',
      'daily',
      'weekdays',
      'weekly',
      'monthly',
      'yearly',
    ]);
    expect(S.MONDAY_TO_FRIDAY).toEqual([1, 2, 3, 4, 5]);
  });
});

/* ── walk-in-labels.spec.ts ───────────────────────────────────────────── */

const word = (number: number | null): string =>
  number === null ? 'Случаен клиент' : `Случаен клиент ${number}`;

/** The legacy map, read off the first-seen list. */
function walkInLabels(
  unlabelled: readonly string[],
  taken: readonly string[],
  words: (number: number | null) => string,
): ReadonlyMap<string, string> {
  return new Map(
    S.walkInLabels(unlabelled, taken, words).map(
      (entry) => [entry.personId, entry.label] as const,
    ),
  );
}

describe('walkInLabels — no two strangers on one visit share a name', () => {
  it('keeps the plain word for the first and numbers the rest', () => {
    expect([
      ...walkInLabels(['primary', 'guest-b', 'guest-c'], [], word),
    ]).toEqual([
      ['primary', 'Случаен клиент'],
      ['guest-b', 'Случаен клиент 2'],
      ['guest-c', 'Случаен клиент 3'],
    ]);
  });

  it('names one person once, however many services they have', () => {
    expect([
      ...walkInLabels(['primary', 'primary', 'guest-b', 'primary'], [], word),
    ]).toEqual([
      ['primary', 'Случаен клиент'],
      ['guest-b', 'Случаен клиент 2'],
    ]);
  });

  it('skips every label the visit already holds', () => {
    // The chair's own stranger is already «Случаен клиент», and somebody
    // was named «Случаен клиент 2» by hand: the newcomer is the third.
    expect(
      walkInLabels(
        ['guest-new'],
        ['Мартин', 'Случаен клиент', 'Случаен клиент 2'],
        word,
      ).get('guest-new'),
    ).toBe('Случаен клиент 3');
  });

  it('never gives two people one label, nor a label already taken', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), {
          maxLength: 12,
        }),
        fc.array(
          fc.oneof(
            fc.constant('Случаен клиент'),
            fc.integer({ min: 2, max: 15 }).map((n) => word(n)),
            fc.string({ maxLength: 8 }),
          ),
          { maxLength: 10 },
        ),
        (people, taken) => {
          const labels = [...walkInLabels(people, taken, word).values()];
          expect(labels).toHaveLength(people.length);
          expect(new Set(labels).size).toBe(labels.length);
          for (const label of labels) expect(taken).not.toContain(label);
        },
      ),
    );
  });

  it('ends even when the catalogue words every number alike', () => {
    const flat = (number: number | null) =>
      number === null ? 'walk-in' : 'walk-in #';
    const labels = walkInLabels(['a', 'b', 'c'], ['walk-in'], flat);
    expect(labels.size).toBe(3);
  });
});

/* ── catalog-delta.spec.ts ────────────────────────────────────────────── */

describe('the catalogue delta', () => {
  it('sums the catalogue, and lets a retired service stand at its booked length', () => {
    const seats = [
      { catalog: 45, booked: 30 },
      { catalog: null, booked: 20 },
    ];
    expect(
      S.catalogMinutesOf(
        seats.map((seat) => ({
          catalogMinutes: seat.catalog,
          bookedMinutes: seat.booked,
        })),
      ),
    ).toBe(65);
    expect(S.catalogMinutesOf([])).toBeNull();
  });

  it('writes the distance with a true minus, never a hyphen', () => {
    // The wording is the presenter's; the system hands it the signed figure.
    expect(S.minutesDelta(45, 50)).toBe(-5);
    expect(S.minutesDelta(60, 45)).toBe(15);
  });

  it('tags only a visit that runs off the catalogue, and only when the catalogue can say', () => {
    expect(S.minutesDelta(45, 50)).toBe(-5);
    expect(S.minutesDelta(60, 45)).toBe(15);
    expect(S.minutesDelta(45, 45)).toBeNull();
    expect(S.minutesDelta(45, null)).toBeNull();
  });
});

/* ── the draft's span and placeholder seats ───────────────────────────── */

describe("the visit draft's span and placeholder seats", () => {
  const legs = [{ minutes: 30 }, { minutes: 15 }];

  it('spans its override, else its legs, else half an hour for a visit with no service yet', () => {
    expect(S.span(null, legs)).toBe(45);
    expect(S.span(60, legs)).toBe(60);
    expect(S.span(null, [])).toBe(30);
    expect(S.legMinutes([])).toBe(S.DEFAULT_SPAN_MINUTES);
  });

  it('pins an override only when the booked span never was the legs’ own', () => {
    expect(S.durationOverrideOf(600, 645, legs)).toBeNull();
    expect(S.durationOverrideOf(600, 660, legs)).toBe(60);
    // A visit with no service drawn at its default half hour pins nothing.
    expect(S.durationOverrideOf(600, 630, [])).toBeNull();
  });

  it('hands the placeholder seats to the first person to join, and no one else', () => {
    const drafted = [
      { clientId: 'primary', minutes: 30 },
      { clientId: 'u-anna', minutes: 15 },
    ];
    expect(S.adoptPlaceholderLegs(0, drafted, 'u-ivan')).toEqual([
      { clientId: 'u-ivan', minutes: 30 },
      { clientId: 'u-anna', minutes: 15 },
    ]);
    // Somebody is already seated: the legs come back as given.
    expect(S.adoptPlaceholderLegs(1, drafted, 'u-ivan')).toBe(drafted);
  });
});

describe('VisitDraftSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const weekly = deepFreeze(
      S.ruleForPreset(RepeatPreset.Weekly, thursday, null) as RecurrenceRule,
    );
    const once = S.ruleForStart(weekly, thursday, day('2026-11-05'));
    const twice = S.ruleForStart(weekly, thursday, day('2026-11-05'));
    expect(twice).toEqual(once);
    expect(S.presetOf(weekly, thursday)).toBe(RepeatPreset.Weekly);

    const legs = deepFreeze([
      { clientId: 'primary', minutes: 30 },
      { clientId: 'u-anna', minutes: 15 },
    ]);
    expect(S.adoptPlaceholderLegs(0, legs, 'u-ivan')).toEqual(
      S.adoptPlaceholderLegs(0, legs, 'u-ivan'),
    );
    expect(legs[0]?.clientId).toBe('primary');

    const taken = deepFreeze(['Случаен клиент']);
    expect(S.walkInLabels(['a', 'b'], taken, word)).toEqual(
      S.walkInLabels(['a', 'b'], taken, word),
    );
  });

  it('reads back every shortcut it makes, from any start (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3650 }),
        fc.constantFrom(
          RepeatPreset.Daily,
          RepeatPreset.Weekdays,
          RepeatPreset.Weekly,
          RepeatPreset.Monthly,
          RepeatPreset.Yearly,
        ),
        (offset, preset) => {
          const start = DayKey.fromEpochDay(
            DayKey.toEpochDay(thursday) + offset,
          );
          const rule = S.ruleForPreset(preset, start, null);
          expect(rule).not.toBeNull();
          const read = S.presetOf(rule, start);
          // «weekdays» from a weekend start is no weekday shortcut, but it is
          // still read back as the shortcut it was made from.
          expect(read).toBe(preset);
        },
      ),
    );
  });
});
