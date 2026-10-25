import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  RecurrenceEnd,
  RecurrenceEndRule,
  RecurrenceFrequency,
  RecurrencePattern,
  RecurrenceRule,
  RepeatPreset,
} from '@core/components';
import {
  DraftPersonKey,
  DurationMinutes,
  LocalDate,
  TrackMinute,
  Weekday,
} from '@core/primitives';
import {
  deepFreeze,
  draftPersonKey,
  endMinute,
  localDate,
  minute,
  trackMinute,
  unwrapOk,
} from '@core/testing';
import { RecurrenceSystem } from './recurrence.system';
import { VisitDraftSystem } from './visit-draft.system';

/*
 * COPIED and re-targeted:
 * - every case of libs/features/staff/dashboard/src/lib/block-editor/
 *   block-repeat.spec.ts (8) — `CalendarDay` → `LocalDate`, the legacy rule
 *   class → the `RecurrenceRule` struct (`with` → `RecurrenceRule.create`,
 *   weekday names → ISO numbers, `{ frequency }` → `{ kind }`), the series
 *   → `RecurrenceSystem.series`;
 * - the walk-in labels (5, one a property; from the dashboard spec deleted
 *   in pass B) — the first-seen list of `{ personId, label }`;
 * - the catalogue delta (from the dashboard spec deleted in pass B) — the
 *   `−5 мин` wording is the dashboard's `shared/catalog-tag.words.ts`, so
 *   these cases read the signed delta.
 * Plus the span and placeholder rules of the visit editor's draft
 * (`staff-visit-editor.ts` `spanOf`/`seedDraft`/`adoptPlaceholderLegs`),
 * properties and the purity case.
 *
 * Flatten pass (Law 6/7): days are `LocalDate`s, the rule is the FLAT
 * `RecurrenceRule` (`recurrenceFrequency`, `recurrenceInterval`,
 * `recurrenceEnd` at its root), the presets SCREAMING, every minute figure a
 * `DurationMinutes` / `MinuteDelta` brand and the draft's frame
 * `MinuteOfDay` → `EndMinute`.
 *
 * Pass C, ported as values (S-23, S-24, E-14, E-15, E-18, Y-19):
 * - the grain and its snaps — the editor's and the block editor's `snap`,
 *   the dashboard's `nowSnapped` (staff-visit-editor.spec.ts :1903, :5730 —
 *   47 typed reads 45; staff-time-grid.spec.ts :851, :1582);
 * - the block editor's typed pair (`commitStart`/`commitEnd`,
 *   staff-block-editor.spec.ts :183);
 * - the visit sheet's span and its two override rules — the frame
 *   (`onFrameDraft`, against the raw leg sum floored at one grain) and the
 *   typed figure (`setDuration`, against the raw leg sum, `0` with no legs)
 *   (staff-visit-editor.spec.ts :976 — 75 typed over 45 of legs pins 75;
 *   :1737 — a drag keeps 45; :5721 — 95 pins 95);
 * - a typed end (`commitEnd`, staff-visit-editor.spec.ts :6431 — 10:00 to
 *   11:30 is 90, to 00:15 is the next day's 855);
 * - whose a person key is (`accountIdOf` / `isAccount`; staff-visit-editor
 *   .spec.ts :5850, :5987, :7476; staff-dashboard.spec.ts :6149, :6219).
 */

const S = VisitDraftSystem;

/* ── block-repeat.spec.ts ─────────────────────────────────────────────── */

const day = (key: string): LocalDate => localDate(key);
/** A positive minute figure literal. */
const d = (raw: number): DurationMinutes => unwrapOk(DurationMinutes.of(raw));

function keys(
  start: LocalDate,
  rule: RecurrenceRule | null,
): readonly string[] {
  if (rule === null) return [start];
  return unwrapOk(RecurrenceSystem.series(start, rule)).localDates;
}

function endKey(end: RecurrenceEndRule): string {
  return end.recurrenceEnd === RecurrenceEnd.Until
    ? end.untilLocalDate
    : `×${end.occurrenceCount}`;
}

function withRule(
  rule: RecurrenceRule,
  patch: {
    readonly pattern?: RecurrencePattern;
    readonly interval?: number;
  },
): RecurrenceRule {
  return unwrapOk(
    RecurrenceRule.create(
      patch.pattern ?? RecurrenceRule.patternOf(rule),
      patch.interval ?? rule.recurrenceInterval,
      RecurrenceRule.endOf(rule),
    ),
  );
}

// 2026-09-24 is a Thursday.
const thursday = day('2026-09-24');

describe('the repeat page policy', () => {
  it('ends a series by default on a DATE — four weeks, half a year, four years', () => {
    expect(endKey(S.defaultEnd(RecurrenceFrequency.Daily, thursday))).toBe(
      '2026-10-22',
    );
    expect(endKey(S.defaultEnd(RecurrenceFrequency.Weekly, thursday))).toBe(
      '2026-10-22',
    );
    expect(endKey(S.defaultEnd(RecurrenceFrequency.Monthly, thursday))).toBe(
      '2027-03-24',
    );
    expect(endKey(S.defaultEnd(RecurrenceFrequency.Yearly, thursday))).toBe(
      '2030-09-24',
    );
    // The 31st has no 31st six months on: the month's last day instead.
    expect(
      endKey(S.defaultEnd(RecurrenceFrequency.Monthly, day('2026-08-31'))),
    ).toBe('2027-02-28');
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
      pattern: RecurrencePattern.weekly([Weekday.Mon]),
    });
    expect(S.presetOf(mondays, thursday)).toBeNull();
  });

  it('keeps the end a series had when the shortcut changes, unless it no longer fits', () => {
    const daily = S.ruleForPreset(RepeatPreset.Daily, thursday, null);
    const weekly = S.ruleForPreset(RepeatPreset.Weekly, thursday, daily);
    expect(weekly && endKey(weekly)).toBe('2026-10-22');
    // A yearly series four years long turned daily would be ~1,500 days:
    // past the cap, so the new frequency's own end is taken instead.
    const yearly = S.ruleForPreset(RepeatPreset.Yearly, thursday, null);
    const dailyAgain = S.ruleForPreset(RepeatPreset.Daily, thursday, yearly);
    expect(dailyAgain && endKey(dailyAgain)).toBe('2026-10-22');
  });

  it("starts «Персонализирано» at Google's own default, or keeps the rule there is", () => {
    const custom = S.ruleForCustom(thursday, null);
    expect(custom && RecurrenceRule.patternOf(custom)).toEqual({
      recurrenceFrequency: 'WEEKLY',
      recurrenceWeekdays: [Weekday.Thu],
    });
    const monthly = S.ruleForPreset(RepeatPreset.Monthly, thursday, null);
    expect(S.ruleForCustom(thursday, monthly)).toBe(monthly);
  });

  it("changes the frequency to the start's own days for it, keeping interval and end", () => {
    const weekly = S.ruleForPreset(RepeatPreset.Weekly, thursday, null);
    if (weekly === null) throw new Error('fixture');
    const every2 = withRule(weekly, { interval: 2 });
    const monthly = S.ruleForFrequency(
      every2,
      RecurrenceFrequency.Monthly,
      thursday,
    );
    expect(RecurrenceRule.patternOf(monthly)).toEqual({
      recurrenceFrequency: 'MONTHLY',
      monthlyAnchor: 'DATE',
      monthlyDate: 24,
    });
    expect(monthly.recurrenceInterval).toBe(2);
  });

  it('switches how it ends WITHOUT changing the days', () => {
    const weekly = S.ruleForPreset(RepeatPreset.Weekly, thursday, null);
    if (weekly === null) throw new Error('fixture');
    const counted = S.ruleForEndKind(weekly, RecurrenceEnd.Count, thursday);
    expect(RecurrenceRule.endOf(counted)).toEqual({
      recurrenceEnd: 'COUNT',
      occurrenceCount: 5,
    });
    expect(keys(thursday, counted)).toEqual(keys(thursday, weekly));
    const dated = S.ruleForEndKind(counted, RecurrenceEnd.Until, thursday);
    expect(endKey(dated)).toBe('2026-10-22');
    expect(keys(thursday, dated)).toEqual(keys(thursday, weekly));
  });

  it("follows the frame to another day: the start's weekday moves, an overtaken end moves on", () => {
    const weekly = S.ruleForPreset(RepeatPreset.Weekly, thursday, null);
    if (weekly === null) throw new Error('fixture');
    const friday = S.ruleForStart(weekly, thursday, day('2026-09-25'));
    expect(RecurrenceRule.patternOf(friday)).toEqual({
      recurrenceFrequency: 'WEEKLY',
      recurrenceWeekdays: [Weekday.Fri],
    });
    expect(endKey(friday)).toBe('2026-10-22');
    // Stepped past its own end: the end moves four weeks on from there.
    const later = S.ruleForStart(weekly, thursday, day('2026-11-05'));
    expect(endKey(later)).toBe('2026-12-03');
  });
});

describe('the repeat page policy — identities and fallbacks', () => {
  const weekly = S.ruleForPreset(
    RepeatPreset.Weekly,
    thursday,
    null,
  ) as RecurrenceRule;

  it('hands back the same rule when nothing is asked to change', () => {
    expect(
      S.ruleForFrequency(weekly, RecurrenceFrequency.Weekly, thursday),
    ).toBe(weekly);
    expect(S.ruleForEndKind(weekly, RecurrenceEnd.Until, thursday)).toBe(
      weekly,
    );
  });

  it('counts ten when a series that cannot be walked turns to a count', () => {
    // An until before the start makes no series from it.
    const stale = unwrapOk(
      RecurrenceRule.create(
        RecurrenceRule.patternOf(weekly),
        1,
        RecurrenceEndRule.until(day('2026-09-01')),
      ),
    );
    expect(
      RecurrenceRule.endOf(
        S.ruleForEndKind(stale, RecurrenceEnd.Count, thursday),
      ),
    ).toEqual({ recurrenceEnd: 'COUNT', occurrenceCount: 10 });
    const counted = unwrapOk(
      RecurrenceRule.create(
        RecurrenceRule.patternOf(weekly),
        1,
        RecurrenceEndRule.count(3),
      ),
    );
    // From a count with no walkable series, the frequency's default date.
    expect(
      endKey(
        S.ruleForEndKind(
          unwrapOk(
            RecurrenceRule.create(
              RecurrencePattern.monthlyByDate(31),
              12,
              RecurrenceEndRule.count(3),
            ),
          ),
          RecurrenceEnd.Until,
          day('2026-02-01'),
        ),
      ),
    ).toBe('2026-08-01');
    expect(
      endKey(S.ruleForEndKind(counted, RecurrenceEnd.Until, thursday)),
    ).toBe('2026-10-08');
  });

  it('reads the five shortcuts in the page order, Monday to Friday as the working week', () => {
    expect(S.REPEAT_PRESETS).toEqual([
      'NEVER',
      'DAILY',
      'WEEKDAYS',
      'WEEKLY',
      'MONTHLY',
      'YEARLY',
    ]);
    expect(S.MONDAY_TO_FRIDAY).toEqual([1, 2, 3, 4, 5]);
  });
});

/* ── the walk-in labels ───────────────────────────────────────────────── */

const word = (number: number | null): string =>
  number === null ? 'Случаен клиент' : `Случаен клиент ${number}`;

/** The legacy map, read off the first-seen list. */
function walkInLabels(
  unlabelled: readonly string[],
  taken: readonly string[],
  words: (number: number | null) => string,
): ReadonlyMap<string, string> {
  return new Map(
    S.walkInLabels(
      unlabelled.map((raw) => draftPersonKey(raw)),
      taken,
      words,
    ).map((entry) => [entry.personId, entry.label] as const),
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

/* ── the catalogue delta ──────────────────────────────────────────────── */

describe('the catalogue delta', () => {
  it('sums the catalogue, and lets a retired service stand at its booked length', () => {
    const seats = [
      { catalog: d(45), booked: d(30) },
      { catalog: null, booked: d(20) },
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

  it('tags only a visit that runs off the catalogue, and only when the catalogue can say', () => {
    expect(S.minutesDelta(d(45), d(50))).toBe(-5);
    expect(S.minutesDelta(d(60), d(45))).toBe(15);
    expect(S.minutesDelta(d(45), d(45))).toBeNull();
    expect(S.minutesDelta(d(45), null)).toBeNull();
  });
});

/* ── the draft's span and placeholder seats ───────────────────────────── */

describe("the visit draft's span and placeholder seats", () => {
  const legs = [{ durationMinutes: d(30) }, { durationMinutes: d(15) }];

  it('spans its override, else its legs, else half an hour for a visit with no service yet', () => {
    expect(S.span(null, legs)).toBe(45);
    expect(S.span(d(60), legs)).toBe(60);
    expect(S.span(null, [])).toBe(30);
    expect(S.legMinutes([])).toBe(S.DEFAULT_SPAN_MINUTES);
  });

  it('pins an override only when the booked span never was the legs’ own', () => {
    expect(S.durationOverrideOf(minute(600), endMinute(645), legs)).toBeNull();
    expect(S.durationOverrideOf(minute(600), endMinute(660), legs)).toBe(60);
    // A visit with no service drawn at its default half hour pins nothing.
    expect(S.durationOverrideOf(minute(600), endMinute(630), [])).toBeNull();
  });

  it('measures a seeded frame on the track — past the closing midnight too, never refused', () => {
    const track = trackMinute;
    // A new visit opened at 23:57 snaps to 24:00 and spans the default half hour.
    expect(S.durationOverrideOf(track(1440), track(1470), [])).toBeNull();
    // 23:35–00:20 is the legs' own 45 minutes; 23:35–00:35 pins its hour.
    expect(S.durationOverrideOf(track(1415), track(1460), legs)).toBeNull();
    expect(S.durationOverrideOf(track(1415), track(1475), legs)).toBe(60);
    // A span with no length pins nothing, wherever it sits.
    expect(S.durationOverrideOf(track(1440), track(1440), legs)).toBeNull();
    expect(S.durationOverrideOf(track(1470), track(1440), legs)).toBeNull();
  });

  it('hands the placeholder seats to the first person to join, and no one else', () => {
    const drafted = [
      { clientId: draftPersonKey('primary'), durationMinutes: d(30) },
      { clientId: draftPersonKey('u-anna'), durationMinutes: d(15) },
    ];
    expect(
      S.adoptPlaceholderLegs(0, drafted, draftPersonKey('u-ivan')),
    ).toEqual([
      { clientId: 'u-ivan', durationMinutes: 30 },
      { clientId: 'u-anna', durationMinutes: 15 },
    ]);
    // Somebody is already seated: the legs come back as given.
    expect(S.adoptPlaceholderLegs(1, drafted, draftPersonKey('u-ivan'))).toBe(
      drafted,
    );
  });
});

/* ── pass C: the grain, the typed pair, the span rules, the person keys ── */

describe('the grain', () => {
  it('is five minutes', () => {
    expect(S.GRAIN_MINUTES).toBe(5);
  });

  it('snaps to the nearer mark — a half rounds up, 1439 lands on 1440', () => {
    expect(S.snap(minute(0))).toBe(0);
    expect(S.snap(minute(2))).toBe(0);
    expect(S.snap(minute(4))).toBe(5);
    expect(S.snap(minute(5))).toBe(5);
    expect(S.snap(minute(47))).toBe(45);
    expect(S.snap(minute(48))).toBe(50);
    // The closing midnight — a track minute no `MinuteOfDay` holds (R-6).
    expect(S.snap(minute(1437))).toBe(1435);
    expect(S.snap(minute(1438))).toBe(1440);
    expect(S.snap(minute(1439))).toBe(1440);
  });

  it('snaps UP for a start at the next tick', () => {
    expect(S.snapUp(minute(0))).toBe(0);
    expect(S.snapUp(minute(1))).toBe(5);
    expect(S.snapUp(minute(4))).toBe(5);
    expect(S.snapUp(minute(5))).toBe(5);
    expect(S.snapUp(minute(601))).toBe(605);
    expect(S.snapUp(minute(1435))).toBe(1435);
    expect(S.snapUp(minute(1436))).toBe(1440);
    expect(S.snapUp(minute(1439))).toBe(1440);
  });

  it('lands every clock minute on a grain mark within half a grain (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1439 }), (raw) => {
        const near = S.snap(minute(raw));
        const up = S.snapUp(minute(raw));
        expect(near % 5).toBe(0);
        expect(Math.abs(near - raw)).toBeLessThanOrEqual(2.5);
        expect(up % 5).toBe(0);
        expect(up).toBeGreaterThanOrEqual(raw);
        expect(up - raw).toBeLessThan(5);
        expect(near).toBeGreaterThanOrEqual(0);
        expect(near).toBeLessThanOrEqual(1440);
        expect(up).toBeLessThanOrEqual(1440);
      }),
    );
  });
});

describe('the grain and the person key, branded (pass D)', () => {
  it('answers a snapped mark as a TrackMinute — the closing midnight included, never refused', () => {
    const near: TrackMinute = S.snap(minute(1439));
    const up: TrackMinute = S.snapUp(minute(1436));
    expect(near).toBe(1440);
    expect(up).toBe(1440);
    expect(TrackMinute.toStart(near).ok).toBe(false);
    expect(TrackMinute.toEnd(near).ok).toBe(true);
  });

  it('names the placeholder by its draft key (whose a key is: `DraftPersonKey.accountOf`, ids.primitive.spec.ts)', () => {
    expect(S.PLACEHOLDER_CLIENT_ID).toBe(DraftPersonKey.PLACEHOLDER);
  });
});

describe('the grain’s floor', () => {
  it('floors a drawn span at one grain, never snapping it', () => {
    expect(S.floorSpan(0)).toBe(5);
    expect(S.floorSpan(2)).toBe(5);
    expect(S.floorSpan(3)).toBe(5);
    expect(S.floorSpan(5)).toBe(5);
    expect(S.floorSpan(7)).toBe(7);
    expect(S.floorSpan(-15)).toBe(5);
    // A frame that crossed midnight on the track axis keeps its length.
    expect(S.floorSpan(1455 - 1405)).toBe(50);
  });

  it('believes a typed duration: snapped to the grain, then floored', () => {
    expect(S.typedSpan(0)).toBe(5);
    expect(S.typedSpan(2)).toBe(5);
    expect(S.typedSpan(3)).toBe(5);
    expect(S.typedSpan(5)).toBe(5);
    expect(S.typedSpan(7)).toBe(5);
    expect(S.typedSpan(7.5)).toBe(10);
    expect(S.typedSpan(8)).toBe(10);
    expect(S.typedSpan(-7)).toBe(5);
    expect(S.typedSpan(-30)).toBe(5);
    expect(S.typedSpan(47)).toBe(45);
    expect(S.typedSpan(2000)).toBe(2000);
  });

  it('a typed duration is the snap alone from three minutes up (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 5000 }), (raw) => {
        expect(S.typedSpan(raw)).toBe(Math.round(raw / 5) * 5);
      }),
    );
  });

  it('is what the span rules floor with', () => {
    expect(S.editorSpan(null, [{ durationMinutes: d(3) }])).toBe(
      S.floorSpan(3),
    );
    expect(S.spanToEnd(minute(600), minute(601))).toBe(S.typedSpan(1));
  });

  it('is pure: same input → same output', () => {
    expect(S.floorSpan(3)).toBe(S.floorSpan(3));
    expect(S.typedSpan(7.5)).toBe(S.typedSpan(7.5));
  });
});

describe('the block editor’s typed pair', () => {
  const pair = (startMinute: number, endMinute: number) => ({
    startMinute: trackMinute(startMinute),
    endMinute: trackMinute(endMinute),
  });

  it('a typed start is snapped and keeps its later end', () => {
    expect(S.typedStart(pair(600, 720), minute(632))).toEqual(pair(630, 720));
  });

  it('a typed start past the end pushes the end one grain out', () => {
    expect(S.typedStart(pair(600, 660), minute(700))).toEqual(pair(700, 705));
    expect(S.typedStart(pair(600, 660), minute(659))).toEqual(pair(660, 665));
  });

  it('a typed start at the day’s close snaps to midnight and pushes the end past it — track minutes, never clamped (R-6)', () => {
    expect(S.typedStart(pair(600, 660), minute(1439))).toEqual(
      pair(1440, 1445),
    );
    expect(S.typedStart(pair(600, 1440), minute(1438))).toEqual(
      pair(1440, 1445),
    );
    expect(S.typedStart(pair(600, 1440), minute(1430))).toEqual(
      pair(1430, 1440),
    );
  });

  it('a typed end is snapped and keeps its earlier start', () => {
    expect(S.typedEnd(pair(600, 660), minute(718))).toEqual(pair(600, 720));
    expect(S.typedEnd(pair(600, 660), minute(1439))).toEqual(pair(600, 1440));
  });

  it('a typed end before the start pulls the start one grain back, never before 0', () => {
    expect(S.typedEnd(pair(600, 660), minute(540))).toEqual(pair(535, 540));
    expect(S.typedEnd(pair(600, 660), minute(2))).toEqual(pair(0, 0));
    expect(S.typedEnd(pair(30, 60), minute(3))).toEqual(pair(0, 5));
  });

  it('always leaves at least one grain between the two, the day’s floor aside (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1435 }),
        fc.integer({ min: 5, max: 1440 }),
        fc.integer({ min: 0, max: 1439 }),
        (start, length, typed) => {
          const range = pair(start, Math.min(1440, start + length));
          const started = S.typedStart(range, minute(typed));
          expect(
            started.endMinute - started.startMinute,
          ).toBeGreaterThanOrEqual(5);
          const ended = S.typedEnd(range, minute(typed));
          expect(ended.startMinute).toBeGreaterThanOrEqual(0);
          if (ended.endMinute >= 5) {
            expect(ended.endMinute - ended.startMinute).toBeGreaterThanOrEqual(
              5,
            );
          }
        },
      ),
    );
  });
});

describe('the visit sheet’s span and its two override rules', () => {
  const legs = [{ durationMinutes: d(30) }, { durationMinutes: d(15) }];

  it('draws its override, else its legs, else half an hour — never under one grain', () => {
    expect(S.editorSpan(null, legs)).toBe(45);
    expect(S.editorSpan(d(75), legs)).toBe(75);
    expect(S.editorSpan(null, [])).toBe(30);
    expect(S.editorSpan(null, [{ durationMinutes: d(3) }])).toBe(5);
    // An override is drawn as pinned, under the grain or not.
    expect(S.editorSpan(d(3), legs)).toBe(3);
  });

  it('a frame pins nothing at the legs’ own span, and pins any other', () => {
    // :1737 — a drag that keeps the 45 minutes pins nothing.
    expect(S.overrideFor(d(45), legs)).toBeNull();
    expect(S.overrideFor(d(60), legs)).toBe(60);
  });

  it('a frame at the floor pins nothing when the legs are under it', () => {
    expect(S.overrideFor(d(5), [{ durationMinutes: d(3) }])).toBeNull();
    expect(S.overrideFor(d(3), [{ durationMinutes: d(3) }])).toBe(3);
  });

  it('a frame of five on a draft with no legs pins nothing — max(0, 5)', () => {
    expect(S.overrideFor(d(5), [])).toBeNull();
    // Half an hour is the DRAWN default with no legs, never the frame's floor.
    expect(S.overrideFor(d(30), [])).toBe(30);
  });

  it('a typed figure pins nothing at the legs’ raw sum, and pins any other', () => {
    expect(S.typedOverrideFor(d(45), legs)).toBeNull();
    // :976 — 75 typed over 45 of legs; :5721 — 95.
    expect(S.typedOverrideFor(d(75), legs)).toBe(75);
    expect(S.typedOverrideFor(d(95), legs)).toBe(95);
  });

  it('a typed five on a draft with no legs is pinned — the raw sum is 0', () => {
    expect(S.typedOverrideFor(d(5), [])).toBe(5);
    expect(S.typedOverrideFor(d(30), [])).toBe(30);
  });

  it('the two rules part only where the floor or the empty draft does (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 120 }), { maxLength: 4 }),
        fc.integer({ min: 1, max: 600 }),
        (minutes, raw) => {
          const drafted = minutes.map((m) => ({ durationMinutes: d(m) }));
          const sum = minutes.reduce((total, m) => total + m, 0);
          const span = d(raw);
          expect(S.typedOverrideFor(span, drafted)).toBe(
            raw === sum ? null : raw,
          );
          expect(S.overrideFor(span, drafted)).toBe(
            raw === Math.max(sum, 5) ? null : raw,
          );
        },
      ),
    );
  });
});

describe('a typed end', () => {
  it('is the span from the start, snapped', () => {
    // :6431 — start 10:00, end typed 11:30.
    expect(S.spanToEnd(minute(600), minute(690))).toBe(90);
    expect(S.spanToEnd(minute(600), minute(692))).toBe(90);
    expect(S.spanToEnd(minute(600), minute(693))).toBe(95);
  });

  it('runs into the next day when typed at or before the start', () => {
    // :6431 — start 10:00, end typed 00:15 → 14 h 15 min.
    expect(S.spanToEnd(minute(600), minute(15))).toBe(855);
    expect(S.spanToEnd(minute(1405), minute(15))).toBe(50);
    // The start's own minute is a whole day, never an empty visit.
    expect(S.spanToEnd(minute(600), minute(600))).toBe(1440);
  });

  it('is floored at one grain', () => {
    expect(S.spanToEnd(minute(600), minute(601))).toBe(5);
    expect(S.spanToEnd(minute(600), minute(602))).toBe(5);
    expect(S.spanToEnd(minute(0), minute(1439))).toBe(1440);
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
      { clientId: draftPersonKey('primary'), durationMinutes: d(30) },
      { clientId: draftPersonKey('u-anna'), durationMinutes: d(15) },
    ]);
    expect(S.adoptPlaceholderLegs(0, legs, draftPersonKey('u-ivan'))).toEqual(
      S.adoptPlaceholderLegs(0, legs, draftPersonKey('u-ivan')),
    );
    expect(legs[0]?.clientId).toBe('primary');

    const taken = deepFreeze(['Случаен клиент']);
    const people = [draftPersonKey('a'), draftPersonKey('b')];
    expect(S.walkInLabels(people, taken, word)).toEqual(
      S.walkInLabels(people, taken, word),
    );
  });

  it('pass C is pure: same input → same output, inputs untouched', () => {
    const legs = deepFreeze([
      { durationMinutes: d(30) },
      { durationMinutes: d(15) },
    ]);
    expect(S.editorSpan(null, legs)).toBe(S.editorSpan(null, legs));
    expect(S.overrideFor(d(60), legs)).toBe(S.overrideFor(d(60), legs));
    expect(S.typedOverrideFor(d(60), legs)).toBe(
      S.typedOverrideFor(d(60), legs),
    );
    expect(legs).toEqual([{ durationMinutes: 30 }, { durationMinutes: 15 }]);

    const range = deepFreeze({
      startMinute: trackMinute(600),
      endMinute: trackMinute(660),
    });
    expect(S.typedStart(range, minute(700))).toEqual(
      S.typedStart(range, minute(700)),
    );
    expect(S.typedEnd(range, minute(540))).toEqual(
      S.typedEnd(range, minute(540)),
    );
    expect(range).toEqual({ startMinute: 600, endMinute: 660 });

    expect(S.spanToEnd(minute(600), minute(15))).toBe(
      S.spanToEnd(minute(600), minute(15)),
    );
    expect(S.snap(minute(47))).toBe(S.snap(minute(47)));
    expect(S.snapUp(minute(47))).toBe(S.snapUp(minute(47)));
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
          const start = LocalDate.addDays(thursday, offset);
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
