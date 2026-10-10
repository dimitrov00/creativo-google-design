import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../testing';
import { LedgerSystem, type LedgerEntryRef } from './ledger.system';

/*
 * The `foldByEvent`, `wholeMonthsOf` and «the months» cases of
 * libs/features/staff/client-card/src/lib/ledger.presenter.spec.ts, COPIED
 * (the presenter's spec keeps running against its shim) and re-targeted to
 * the numbers they assert: the events, what each moved and the balance it
 * left, the months held whole, each month's events and net. The rows'
 * words stay with the presenter's spec. An entry is the flat
 * `LedgerEntryRef` the feed folds (a label's `seriesId`/`level` and an
 * effect's figures lifted onto it); instants are epoch ms.
 */

const ZONE = 'Europe/Sofia';

type Effect =
  | {
      readonly kind: 'points';
      readonly delta: number;
      readonly balanceAfter: number;
    }
  | { readonly kind: 'achievement' | 'reward' | 'tier' }
  | {
      readonly kind: 'redemption';
      readonly op: 'redeemed' | 'reversed' | 'expired';
      readonly cost: number;
    };

/** A journal entry as the feed folds one. */
function entry(
  seq: number,
  day: string,
  correlationId: string,
  effect: Effect,
  family: { readonly seriesId: string; readonly level: number } | null = null,
  reverses: string | null = null,
): LedgerEntryRef {
  return {
    id: `e-${seq}`,
    seq,
    // 10:45 in Sofia: the day is the same on the shop's calendar.
    atMs: Date.parse(`${day}T07:45:00.000Z`),
    correlationId,
    reverses,
    seriesId: family?.seriesId ?? null,
    level: family?.level ?? null,
    kind: effect.kind,
    pointsDelta: effect.kind === 'points' ? effect.delta : null,
    balanceAfter: effect.kind === 'points' ? effect.balanceAfter : null,
    redemptionOp: effect.kind === 'redemption' ? effect.op : null,
    cost: effect.kind === 'redemption' ? effect.cost : null,
  };
}

const points = (delta: number, balanceAfter: number): Effect => ({
  kind: 'points',
  delta,
  balanceAfter,
});

/** One journal that holds every kind of §2.2.5, a reversal and the row it struck among them. */
const VISIT_FADE = entry(50, '2026-09-05', 'appt:appt-a', points(17, 361));
const VISIT_BEARD = entry(51, '2026-09-05', 'appt:appt-a', points(10, 371));
const TIER = entry(49, '2026-09-02', 'tier:dev-client-1:gold:2026-09-02', {
  kind: 'tier',
});
const REDEEMED_POINTS = entry(45, '2026-06-20', 'rdm-1', points(-250, 94));
const REDEEMED = entry(46, '2026-06-20', 'rdm-1', {
  kind: 'redemption',
  op: 'redeemed',
  cost: 250,
});
const GRANTED = entry(
  44,
  '2026-05-16',
  'award:rule-every-10th-visit:dev-client-1:10',
  { kind: 'reward' },
);
const GOODWILL = entry(43, '2026-04-18', 'adj-1', points(30, 344));
const REVERSAL = entry(
  42,
  '2026-04-05',
  'appt:appt-b',
  points(-17, 314),
  null,
  'e-41',
);
const REVERSED = entry(41, '2026-04-04', 'appt:appt-b', points(17, 331));
const LEVEL = entry(
  39,
  '2026-03-06',
  'award:rule-tenure-1',
  { kind: 'achievement' },
  { seriesId: 'series-tenure', level: 1 },
);
const LEVEL_POINTS = entry(
  40,
  '2026-03-06',
  'award:rule-tenure-1',
  points(50, 314),
  { seriesId: 'series-tenure', level: 1 },
);
const EXPIRED = entry(35, '2025-12-31', 'exp-2025', points(-40, 264));
const LEVEL_BARE = entry(
  30,
  '2025-09-24',
  'award:rule-fade-2',
  { kind: 'achievement' },
  { seriesId: 'series-svc-fade', level: 2 },
);

const JOURNAL: readonly LedgerEntryRef[] = [
  VISIT_BEARD,
  VISIT_FADE,
  TIER,
  REDEEMED,
  REDEEMED_POINTS,
  GRANTED,
  GOODWILL,
  REVERSAL,
  REVERSED,
  LEVEL_POINTS,
  LEVEL,
  EXPIRED,
  LEVEL_BARE,
];

const foldByEvent = LedgerSystem.fold;
const wholeMonthsOf = (entries: readonly LedgerEntryRef[], whole: boolean) =>
  LedgerSystem.wholeMonths(entries, whole, ZONE);

describe('LedgerSystem.fold (`foldByEvent`)', () => {
  it('folds the entries of one event into one, newest first, whatever order they arrive in', () => {
    const events = foldByEvent([...JOURNAL].reverse(), true);
    expect(events.map((event) => event.id)).toEqual([
      'e-51',
      'e-49',
      'e-46',
      'e-44',
      'e-43',
      'e-42',
      'e-41',
      'e-40',
      'e-35',
      'e-30',
    ]);
    expect(events[0]?.entries.map((row) => row.id)).toEqual(['e-51', 'e-50']);
    expect(events[0]?.atMs).toEqual(VISIT_BEARD.atMs);
  });

  it('sums what an event moved and keeps the balance its newest point row left', () => {
    const [visit, tier, redemption] = foldByEvent(JOURNAL, true);
    expect(visit).toMatchObject({ delta: 27, balanceAfter: 371 });
    // No points moved: no amount, no balance.
    expect(tier).toMatchObject({ delta: null, balanceAfter: null });
    expect(redemption).toMatchObject({ delta: -250, balanceAfter: 94 });
  });

  it('folds a visit’s seats under either spelling of its id', () => {
    const seats = [
      entry(2, '2026-07-13', 'appt:appt-c:seat:s2', points(10, 307)),
      entry(1, '2026-07-13', 'appt:appt-c:seat:s1', points(17, 297)),
    ];
    expect(foldByEvent(seats, true)).toEqual([
      {
        id: 'e-2',
        atMs: seats[0]?.atMs,
        entries: seats,
        delta: 27,
        balanceAfter: 307,
      },
    ]);
  });

  it('keeps a level an event of its own where its bonus rode the visit’s id', () => {
    // The first round's journals file a level's points under the visit
    // that earned it: the visit stays a visit, the level a level.
    const day = [
      entry(8, '2025-06-04', 'appt:appt-d:seat:s1', points(20, 135), {
        seriesId: 'series-visits',
        level: 2,
      }),
      entry(7, '2025-06-04', 'appt:appt-d:seat:s1', points(17, 115)),
    ];
    expect(
      foldByEvent(day, true).map((event) => [event.id, event.delta]),
    ).toEqual([
      ['e-8', 20],
      ['e-7', 17],
    ]);
  });

  it('says what a redemption cost when its point row was not read (the pill «Награди»)', () => {
    expect(foldByEvent([REDEEMED], true)).toEqual([
      {
        id: 'e-46',
        atMs: REDEEMED.atMs,
        entries: [REDEEMED],
        delta: -250,
        balanceAfter: null,
      },
    ]);
    const back = entry(47, '2026-06-21', 'rdm-1-back', {
      kind: 'redemption',
      op: 'reversed',
      cost: 250,
    });
    expect(foldByEvent([back], true)[0]?.delta).toBe(250);
    const lapsed = entry(48, '2026-09-20', 'rdm-1-lapsed', {
      kind: 'redemption',
      op: 'expired',
      cost: 250,
    });
    // The points were spent when it was taken: nothing moves a second time.
    expect(foldByEvent([lapsed], true)[0]?.delta).toBeNull();
  });

  it('never folds a row that compensates another, nor the row it struck, into their visit', () => {
    const other = entry(40.5, '2026-04-04', 'appt:appt-b', points(10, 341));
    const events = foldByEvent([REVERSAL, REVERSED, other], true);
    expect(events.map((event) => [event.id, event.delta])).toEqual([
      ['e-42', -17],
      ['e-41', 17],
      ['e-40.5', 10],
    ]);
  });

  it('holds the oldest event back while a page is left, and shows it once the end confirms it', () => {
    expect(foldByEvent(JOURNAL, false).map((event) => event.id)).toEqual(
      foldByEvent(JOURNAL, true)
        .map((event) => event.id)
        .slice(0, -1),
    );
    // A page never reads as empty while it holds a row.
    expect(foldByEvent([VISIT_FADE], false).map((event) => event.id)).toEqual([
      'e-50',
    ]);
    expect(foldByEvent([], false)).toEqual([]);
  });
});

describe('LedgerSystem.wholeMonths (`wholeMonthsOf`)', () => {
  it('holds every month whole once nothing older is left', () => {
    expect(
      [...wholeMonthsOf([VISIT_FADE, TIER, REDEEMED], true)].sort(),
    ).toEqual(['2026-06', '2026-09']);
  });

  it('leaves the oldest month in doubt while a page is left', () => {
    expect([...wholeMonthsOf([VISIT_FADE, TIER, REDEEMED], false)]).toEqual([
      '2026-09',
    ]);
    expect([...wholeMonthsOf([VISIT_FADE], false)]).toEqual([]);
    expect([...wholeMonthsOf([], true)]).toEqual([]);
  });
});

describe('LedgerSystem.months (`activityGroups`: the months)', () => {
  const months = (
    entries: readonly LedgerEntryRef[],
    whole: boolean,
    limit: number | null = null,
  ) =>
    LedgerSystem.months(
      foldByEvent(entries, whole),
      limit,
      wholeMonthsOf(entries, whole),
      ZONE,
    );

  it('groups by the shop’s month, newest first, with each month’s net', () => {
    const groups = months(JOURNAL, true);
    expect(groups.map((group) => [group.key, group.net])).toEqual([
      ['2026-09', 27],
      ['2026-06', -250],
      // A reward received moved no points: the month has nothing to net.
      ['2026-05', null],
      // +30, the visit and its reversal: they cancel out.
      ['2026-04', 30],
      ['2026-03', 50],
      ['2025-12', -40],
      ['2025-09', null],
    ]);
    expect(groups[0]?.events.map((event) => event.id)).toEqual([
      'e-51',
      'e-49',
    ]);
    expect(groups[3]?.events.map((event) => event.id)).toEqual([
      'e-43',
      'e-42',
      'e-41',
    ]);
  });

  it('files an instant under the month it falls in on the shop’s calendar', () => {
    // 22:30 UTC on 31 August is 1:30 on 1 September in Sofia.
    const late = {
      ...VISIT_FADE,
      atMs: Date.parse('2026-08-31T22:30:00.000Z'),
    };
    expect(months([late], true)[0]?.key).toBe('2026-09');
    expect(LedgerSystem.monthOf(late.atMs, 'Not/AZone')).toBeNull();
  });

  it('prints no net for a month the page boundary may have cut', () => {
    const groups = months(JOURNAL, false);
    // The oldest event is held back, and with it its month.
    expect(groups.map((group) => group.key)).not.toContain('2025-09');
    expect(groups.at(-1)).toMatchObject({ key: '2025-12', net: -40 });
    const cut = months([VISIT_BEARD, VISIT_FADE, TIER, REDEEMED], false);
    expect(cut.map((group) => [group.key, group.net])).toEqual([
      ['2026-09', 27],
    ]);
  });

  it('shows the newest events only under a limit, and no net over a month the limit cut', () => {
    const groups = months(JOURNAL, true, 5);
    expect(
      groups.flatMap((group) => group.events).map((event) => event.id),
    ).toEqual(['e-51', 'e-49', 'e-46', 'e-44', 'e-43']);
    expect(groups.map((group) => [group.key, group.net])).toEqual([
      ['2026-09', 27],
      ['2026-06', -250],
      ['2026-05', null],
      // April holds two rows more than the five show.
      ['2026-04', null],
    ]);
    expect(months(JOURNAL, true, 0)).toEqual([]);
  });
});

describe('LedgerSystem.leading', () => {
  it('words an event by its highest-ranked effect, the redemption over its points', () => {
    const [, , redemption, , , , , level] = foldByEvent(JOURNAL, true);
    expect(redemption && LedgerSystem.leading(redemption)?.id).toBe('e-46');
    expect(level && LedgerSystem.leading(level)?.id).toBe('e-39');
    expect(
      LedgerSystem.leading({
        id: 'x',
        atMs: 0,
        entries: [],
        delta: null,
        balanceAfter: null,
      }),
    ).toBeNull();
  });
});

describe('LedgerSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const journal = deepFreeze([...JOURNAL]);
    const run = () => {
      const events = LedgerSystem.fold(journal, true);
      return [
        events,
        LedgerSystem.wholeMonths(journal, true, ZONE),
        LedgerSystem.months(events, 5, ['2026-09'], ZONE),
      ];
    };
    expect(run()).toEqual(run());
  });
});
