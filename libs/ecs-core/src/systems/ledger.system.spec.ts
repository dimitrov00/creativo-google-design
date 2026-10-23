import { describe, expect, it } from 'vitest';
import {
  AchievementOp,
  Actor,
  FreezeOp,
  GrantRefFields,
  JournalEffect,
  JournalEffectRecord,
  JournalFeed,
  JournalSourceRecord,
  JournalSystemJob,
  JournalVisibility,
  LabelCode,
  type LabelParam,
  LedgerLine,
  RedemptionOp,
  RewardOp,
  RewardRefFields,
  SystemSource,
  TierOp,
} from '@core/components';
import type { JournalEntry } from '@core/entities';
import {
  AchievementRuleId,
  AppointmentId,
  CorrelationId,
  CouponGrantId,
  CustomerId,
  JournalEntryId,
  RedemptionId,
  RewardId,
  StreakDefinitionId,
  TierId,
} from '@core/primitives';
import {
  FIXTURE_TIME_ZONE,
  deepFreeze,
  localDate,
  loyaltyAccountFixtures,
  utcMs,
} from '@core/testing';
import { LedgerSystem } from './ledger.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The `foldByEvent`, `wholeMonthsOf` and «the months» cases of
 * libs/features/staff/client-card/src/lib/ledger.presenter.spec.ts, COPIED
 * and re-targeted to the numbers they assert: the events, what each moved
 * and the balance it left, the months held whole, each month's events and
 * net. The rows' words stay with the presenter's spec. An entry is a
 * `clientJournal` row as the journal port answers it (zero inbound mapping,
 * Law 3): its effect's own fields, its label's `seriesId` / `level`, its
 * root `appointmentId`, its instant AND its shop day (T5) — so the month is
 * read off the day and no zone reaches the system.
 */

const CUSTOMER = CustomerId.of('cus_0123456789abcdef0123');

/** What an entry changed, and the balance once it was folded in (every row carries one). */
type Effect = {
  readonly record: JournalEffectRecord;
  readonly balanceAfter: number;
};

/** An entry's stamp: its instant and the shop day the boundary filed it under (Sofia). */
function stamped(iso: string): Pick<JournalEntry, 'utcEpochMs' | 'localDate'> {
  const utcEpochMs = utcMs(iso);
  return {
    utcEpochMs,
    localDate: ZonedTimeSystem.toLocal(utcEpochMs, FIXTURE_TIME_ZONE).localDate,
  };
}

/** The visit a correlation id names (`appt:{id}…`), as the fixtures stamp `appointmentId`. */
function visitOf(correlationId: string): AppointmentId | null {
  const [root, id] = correlationId.split(':');
  return root === 'appt' && id !== undefined && id !== ''
    ? AppointmentId.of(id)
    : null;
}

/** The copy key each effect's rows carry — the fold never reads it. */
const LABEL = {
  [JournalEffect.Points]: LabelCode.PointsRule,
  [JournalEffect.Achievement]: LabelCode.AchievementEarned,
  [JournalEffect.Tier]: LabelCode.TierChanged,
  [JournalEffect.Reward]: LabelCode.RewardGranted,
  [JournalEffect.Redemption]: LabelCode.RedemptionChanged,
} as const;

/** A `clientJournal` row as the feed reads one. */
function entry(
  seq: number,
  day: string,
  correlationId: string,
  effect: Effect,
  family: { readonly seriesId: string; readonly level: number } | null = null,
  reverses: string | null = null,
  appointmentId: AppointmentId | null = visitOf(correlationId),
): JournalEntry {
  const labelParams: LabelParam[] =
    family === null
      ? []
      : [
          { name: 'seriesId', value: family.seriesId },
          { name: 'level', value: family.level },
        ];
  const effectKind = effect.record.journalEffect;
  return {
    id: JournalEntryId.of(`e-${seq}`),
    customerId: CUSTOMER,
    seq,
    // 10:45 in Sofia: the day is the same on the shop's calendar.
    ...stamped(`${day}T07:45:00.000Z`),
    reverses: reverses === null ? null : JournalEntryId.of(reverses),
    correlationId: CorrelationId.of(correlationId),
    idempotencyKey: `key-${seq}`,
    journalVisibility: JournalVisibility.Client,
    labelCode:
      effectKind in LABEL
        ? LABEL[effectKind as keyof typeof LABEL]
        : LabelCode.PointsCorrection,
    labelParams,
    balanceAfter: effect.balanceAfter,
    appointmentId,
    ...Actor.system(SystemSource.Fixture),
    ...JournalSourceRecord.system(JournalSystemJob.Tier),
    ...effect.record,
  };
}

const points = (delta: number, balanceAfter: number): Effect => ({
  record: JournalEffectRecord.points(delta),
  balanceAfter,
});

const tier = (balanceAfter: number): Effect => ({
  record: {
    journalEffect: JournalEffect.Tier,
    tierOp: TierOp.Changed,
    tierFrom: TierId.of('silver'),
    tierTo: TierId.of('gold'),
    tierUntil: null,
  },
  balanceAfter,
});

const achievement = (balanceAfter: number): Effect => ({
  record: {
    journalEffect: JournalEffect.Achievement,
    achievementRuleId: AchievementRuleId.of('rule-tenure-1'),
    achievementRuleVersion: 1,
    achievementAwardKey: 'award',
    achievementOp: AchievementOp.Granted,
  },
  balanceAfter,
});

const reward = (balanceAfter: number): Effect => ({
  record: {
    journalEffect: JournalEffect.Reward,
    rewardOp: RewardOp.Granted,
    ...RewardRefFields.couponGrant(CouponGrantId.of('grant-1')),
  },
  balanceAfter,
});

const redemption = (
  redemptionOp: RedemptionOp,
  redemptionCost: number,
  balanceAfter: number,
): Effect => ({
  record: {
    journalEffect: JournalEffect.Redemption,
    redemptionOp,
    redemptionId: RedemptionId.of('rdm-1'),
    redeemedRewardId: RewardId.of('reward-beard'),
    redemptionCost,
    ...GrantRefFields.none(),
  },
  balanceAfter,
});

/** One journal that holds every kind of §2.2.5, a reversal and the row it struck among them. */
const VISIT_FADE = entry(50, '2026-09-05', 'appt:appt-a', points(17, 361));
const VISIT_BEARD = entry(51, '2026-09-05', 'appt:appt-a', points(10, 371));
const TIER = entry(
  49,
  '2026-09-02',
  'tier:dev-client-1:gold:2026-09-02',
  tier(344),
);
const REDEEMED_POINTS = entry(45, '2026-06-20', 'rdm-1', points(-250, 94));
const REDEEMED = entry(
  46,
  '2026-06-20',
  'rdm-1',
  redemption(RedemptionOp.Redeemed, 250, 94),
);
const GRANTED = entry(
  44,
  '2026-05-16',
  'award:rule-every-10th-visit:dev-client-1:10',
  reward(344),
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
const LEVEL = entry(39, '2026-03-06', 'award:rule-tenure-1', achievement(314), {
  seriesId: 'series-tenure',
  level: 1,
});
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
  achievement(304),
  { seriesId: 'series-svc-fade', level: 2 },
);

const JOURNAL: readonly JournalEntry[] = [
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
const wholeMonthsOf = (entries: readonly JournalEntry[], whole: boolean) =>
  LedgerSystem.wholeMonths(entries, whole);

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
    expect(events[0]?.utcEpochMs).toEqual(VISIT_BEARD.utcEpochMs);
    expect(events[0]?.localDate).toEqual(VISIT_BEARD.localDate);
  });

  it('sums what an event moved and keeps the balance its newest point row left', () => {
    const [visit, tierEvent, redeemed] = foldByEvent(JOURNAL, true);
    expect(visit).toMatchObject({ delta: 27, balanceAfter: 371 });
    // No points moved: no amount, no balance — whatever balance the row carries.
    expect(tierEvent).toMatchObject({ delta: null, balanceAfter: null });
    expect(redeemed).toMatchObject({ delta: -250, balanceAfter: 94 });
  });

  it('folds a visit’s seats under either spelling of its id', () => {
    const seats = [
      entry(2, '2026-07-13', 'appt:appt-c:seat:s2', points(10, 307)),
      entry(1, '2026-07-13', 'appt:appt-c:seat:s1', points(17, 297)),
    ];
    expect(foldByEvent(seats, true)).toEqual([
      {
        id: 'e-2',
        utcEpochMs: seats[0]?.utcEpochMs,
        localDate: seats[0]?.localDate,
        entries: seats,
        delta: 27,
        balanceAfter: 307,
      },
    ]);
  });

  it('folds a visit by the entry’s own appointment, never by parsing its correlation id', () => {
    const visit = AppointmentId.of('appt-e');
    const seats = [
      entry(4, '2026-07-14', 'seat-2-of-e', points(10, 50), null, null, visit),
      entry(3, '2026-07-14', 'seat-1-of-e', points(17, 40), null, null, visit),
    ];
    expect(
      foldByEvent(seats, true).map((event) => [event.id, event.delta]),
    ).toEqual([['e-4', 27]]);
    // A correlation id that spells a visit names none the entry does not.
    const unlinked = [
      entry(
        6,
        '2026-07-15',
        'appt:appt-g:seat:s2',
        points(10, 70),
        null,
        null,
        null,
      ),
      entry(
        5,
        '2026-07-15',
        'appt:appt-g:seat:s1',
        points(10, 60),
        null,
        null,
        null,
      ),
    ];
    expect(foldByEvent(unlinked, true)).toHaveLength(2);
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
        utcEpochMs: REDEEMED.utcEpochMs,
        localDate: REDEEMED.localDate,
        entries: [REDEEMED],
        delta: -250,
        balanceAfter: null,
      },
    ]);
    const back = entry(
      47,
      '2026-06-21',
      'rdm-1-back',
      redemption(RedemptionOp.Reversed, 250, 344),
    );
    expect(foldByEvent([back], true)[0]?.delta).toBe(250);
    const lapsed = entry(
      48,
      '2026-09-20',
      'rdm-1-lapsed',
      redemption(RedemptionOp.Expired, 250, 344),
    );
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

describe('LedgerSystem.levelOf', () => {
  it('reads a level’s family and number off the label, as stored', () => {
    expect(LedgerSystem.levelOf(LEVEL)).toEqual({
      badgeSeriesId: 'series-tenure',
      level: 1,
    });
    expect(LedgerSystem.levelOf(VISIT_FADE)).toEqual({
      badgeSeriesId: null,
      level: null,
    });
  });

  it('names no family for blank or numeric text, and no level for a fraction or text', () => {
    const label = (params: readonly LabelParam[]) => ({ labelParams: params });
    expect(
      LedgerSystem.levelOf(
        label([
          { name: 'seriesId', value: '  ' },
          { name: 'level', value: 1.5 },
        ]),
      ),
    ).toEqual({ badgeSeriesId: null, level: null });
    expect(
      LedgerSystem.levelOf(
        label([
          { name: 'seriesId', value: 7 },
          { name: 'level', value: '2' },
        ]),
      ),
    ).toEqual({ badgeSeriesId: null, level: null });
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
    entries: readonly JournalEntry[],
    whole: boolean,
    limit: number | null = null,
  ) =>
    LedgerSystem.months(
      foldByEvent(entries, whole),
      limit,
      wholeMonthsOf(entries, whole),
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
    // 22:30 UTC on 31 August is 1:30 on 1 September in Sofia: the boundary
    // files the entry under that day, and the month is read off the day.
    const late: JournalEntry = {
      ...VISIT_FADE,
      ...stamped('2026-08-31T22:30:00.000Z'),
    };
    expect(late.localDate).toBe('2026-09-01');
    expect(months([late], true)[0]?.key).toBe('2026-09');
    expect(LedgerSystem.monthOf(localDate('2026-09-01'))).toBe('2026-09');
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
    const [, , redeemed, , , , , level] = foldByEvent(JOURNAL, true);
    expect(redeemed && LedgerSystem.leading(redeemed)?.id).toBe('e-46');
    expect(level && LedgerSystem.leading(level)?.id).toBe('e-39');
    expect(
      LedgerSystem.leading({
        id: JournalEntryId.of('x'),
        ...stamped('1970-01-01T00:00:00.000Z'),
        entries: [],
        delta: null,
        balanceAfter: null,
      }),
    ).toBeNull();
  });
});

/*
 * The decisions of `activityGroups`' rows and `ledgerPageVm`'s nets in
 * ledger.presenter.spec.ts, re-stated as tags and booleans: which rows are
 * struck, what each row is about (the presenter's `draftOf`/`pointsDraft`
 * branches, one tag each, with the level's `paid`/`revoked`), the welcome
 * bonus, and the pills under which a month nets. The words, glyphs and
 * lines stay with the presenter's spec.
 */

/** A row of the journal with another copy key (this spec's `entry` labels by effect). */
const labelled = (row: JournalEntry, labelCode: LabelCode): JournalEntry => ({
  ...row,
  labelCode,
});

/** A redemption that lapsed unused, and one taken back. */
const LAPSED = entry(
  48,
  '2026-09-20',
  'rdm-1-lapsed',
  redemption(RedemptionOp.Expired, 250, 344),
);
const BACK = entry(
  47,
  '2026-06-21',
  'rdm-1-back',
  redemption(RedemptionOp.Reversed, 250, 344),
);

/** What the row of the event `id` is about, read off its leading entry. */
function lineAt(entries: readonly JournalEntry[], id: string) {
  const event = foldByEvent(entries, true).find((e) => e.id === id);
  const leading = event === undefined ? null : LedgerSystem.leading(event);
  return event === undefined || leading === null
    ? null
    : LedgerSystem.lineOf(event, leading);
}

describe('LedgerSystem.voided and isStruck (ledger.presenter.spec.ts the struck rows)', () => {
  it('holds the ids the loaded rows compensate', () => {
    expect([...LedgerSystem.voided(JOURNAL)]).toEqual(['e-41']);
    expect([...LedgerSystem.voided([VISIT_FADE, TIER])]).toEqual([]);
    // A reversal whose row is not loaded still names it.
    expect([...LedgerSystem.voided([REVERSAL])]).toEqual(['e-41']);
  });

  it('strikes the row a reversal takes back, never the reversal itself', () => {
    const voided = LedgerSystem.voided(JOURNAL);
    const struck = foldByEvent(JOURNAL, true)
      .filter((event) => LedgerSystem.isStruck(event, voided))
      .map((event) => event.id);
    expect(struck).toEqual(['e-41']);
  });

  it('strikes an event when ANY of its entries was taken back', () => {
    const voided = LedgerSystem.voided([REVERSAL]);
    expect(
      LedgerSystem.isStruck({ entries: [VISIT_BEARD, REVERSED] }, voided),
    ).toBe(true);
    expect(
      LedgerSystem.isStruck({ entries: [VISIT_BEARD, VISIT_FADE] }, voided),
    ).toBe(false);
    expect(LedgerSystem.isStruck({ entries: [] }, voided)).toBe(false);
  });
});

describe('LedgerLine', () => {
  it('pins the row tags', () => {
    expect(Object.values(LedgerLine)).toEqual([
      'REVERSAL',
      'REDEMPTION_SPENT',
      'REDEMPTION_EXPIRED',
      'REWARD_GRANTED',
      'REWARD_REVOKED',
      'TIER',
      'LEVEL',
      'VISIT_EARNED',
      'POINTS_REDEEMED',
      'GOODWILL',
      'SERVICE_ISSUE',
      'POINTS_EXPIRED',
      'DEBT_CLEARED',
      'CORRECTION',
    ]);
  });
});

describe('LedgerSystem.lineOf (ledger.presenter.spec.ts `activityGroups`: a row by its kind)', () => {
  const plain = (ledgerLine: LedgerLine) => ({
    ledgerLine,
    paid: false,
    revoked: false,
  });

  it('reads a visit’s points as what the visit earned', () => {
    expect(lineAt(JOURNAL, 'e-51')).toEqual(plain(LedgerLine.VisitEarned));
    // The row a reversal struck is still the visit's: struck is `isStruck`.
    expect(lineAt(JOURNAL, 'e-41')).toEqual(plain(LedgerLine.VisitEarned));
  });

  it('reads a level by its family, paid when the event moved points', () => {
    expect(lineAt(JOURNAL, 'e-40')).toEqual({
      ledgerLine: LedgerLine.Level,
      paid: true,
      revoked: false,
    });
    expect(lineAt(JOURNAL, 'e-30')).toEqual(plain(LedgerLine.Level));
    const revoked: JournalEntry = {
      ...LEVEL_BARE,
      achievementOp: AchievementOp.Revoked,
    } as JournalEntry;
    expect(lineAt([revoked], 'e-30')).toEqual({
      ledgerLine: LedgerLine.Level,
      paid: false,
      revoked: true,
    });
    // A level's payout read without its achievement row (the pill «Точки»).
    expect(lineAt([LEVEL_POINTS], 'e-40')).toEqual({
      ledgerLine: LedgerLine.Level,
      paid: true,
      revoked: false,
    });
  });

  it('reads a redemption by what became of it: spent, lapsed, or taken back', () => {
    expect(lineAt(JOURNAL, 'e-46')).toEqual(plain(LedgerLine.RedemptionSpent));
    expect(lineAt([LAPSED], 'e-48')).toEqual(
      plain(LedgerLine.RedemptionExpired),
    );
    expect(lineAt([BACK], 'e-47')).toEqual(plain(LedgerLine.Reversal));
    // Its points read without the redemption row (the pill «Точки»).
    expect(
      lineAt([labelled(REDEEMED_POINTS, LabelCode.PointsRedeemed)], 'e-45'),
    ).toEqual(plain(LedgerLine.PointsRedeemed));
  });

  it('reads a reward received, and one taken back', () => {
    expect(lineAt(JOURNAL, 'e-44')).toEqual(plain(LedgerLine.RewardGranted));
    const revoked: JournalEntry = {
      ...GRANTED,
      rewardOp: RewardOp.Revoked,
    } as JournalEntry;
    expect(lineAt([revoked], 'e-44')).toEqual({
      ledgerLine: LedgerLine.RewardRevoked,
      paid: false,
      revoked: true,
    });
  });

  it('reads a tier change as the status', () => {
    expect(lineAt(JOURNAL, 'e-49')).toEqual(plain(LedgerLine.Tier));
  });

  it('reads the shop’s points by their source, anything unnamed as a correction', () => {
    const goodwill = labelled(GOODWILL, LabelCode.PointsGoodwill);
    expect(lineAt([goodwill], 'e-43')).toEqual(plain(LedgerLine.Goodwill));
    expect(
      lineAt([labelled(GOODWILL, LabelCode.PointsServiceIssue)], 'e-43'),
    ).toEqual(plain(LedgerLine.ServiceIssue));
    expect(
      lineAt([labelled(GOODWILL, LabelCode.PointsCorrection)], 'e-43'),
    ).toEqual(plain(LedgerLine.Correction));
    expect(
      lineAt([labelled(GOODWILL, LabelCode.PointsDebtCleared)], 'e-43'),
    ).toEqual(plain(LedgerLine.DebtCleared));
    expect(
      lineAt([labelled(EXPIRED, LabelCode.PointsExpired)], 'e-35'),
    ).toEqual(plain(LedgerLine.PointsExpired));
    // The rule's own points with no family are a visit's.
    expect(lineAt([GOODWILL], 'e-43')).toEqual(plain(LedgerLine.VisitEarned));
  });

  it('reads a reversal first, whatever its effect', () => {
    expect(lineAt(JOURNAL, 'e-42')).toEqual(plain(LedgerLine.Reversal));
    const taken: JournalEntry = { ...REDEEMED, reverses: REVERSED.id };
    expect(LedgerSystem.lineOf({ delta: -250 }, taken)).toEqual(
      plain(LedgerLine.Reversal),
    );
  });

  it('reads a row of an effect the feed does not show by its label', () => {
    const freeze = labelled(
      entry(60, '2026-09-10', 'freeze-1', {
        record: {
          journalEffect: JournalEffect.Freeze,
          streakId: StreakDefinitionId.of('cadence'),
          freezeOp: FreezeOp.Applied,
          freezeCount: 1,
          freezesBankedAfter: 0,
        },
        balanceAfter: 358,
      }),
      LabelCode.FreezeChanged,
    );
    expect(LedgerSystem.lineOf({ delta: null }, freeze)).toEqual(
      plain(LedgerLine.Correction),
    );
    expect(
      LedgerSystem.lineOf(
        { delta: null },
        labelled(freeze, LabelCode.PointsGoodwill),
      ),
    ).toEqual(plain(LedgerLine.Goodwill));
  });
});

describe('LedgerSystem.isWelcome (ledger.presenter.spec.ts the welcome bonus)', () => {
  it('names the welcome family once, as a brand', () => {
    expect(LedgerSystem.WELCOME_SERIES_ID).toBe('series-welcome');
  });

  it('knows the welcome bonus in Георги’s own journal, and no other level', () => {
    const journal = loyaltyAccountFixtures.georgi.clientJournal;
    const welcome = journal.filter((row) =>
      LedgerSystem.isWelcome(LedgerSystem.levelOf(row)),
    );
    expect(welcome.map((row) => row.seq)).toEqual([2]);
    expect(LedgerSystem.isWelcome(LedgerSystem.levelOf(LEVEL_POINTS))).toBe(
      false,
    );
    expect(LedgerSystem.isWelcome(LedgerSystem.levelOf(VISIT_FADE))).toBe(
      false,
    );
  });
});

describe('LedgerSystem.netsUnder (ledger.presenter.spec.ts the pills’ nets)', () => {
  it('nets a month under «Всички» and «Точки», and under no pill that reads other rows', () => {
    expect(LedgerSystem.netsUnder(JournalFeed.All)).toBe(true);
    expect(LedgerSystem.netsUnder(JournalFeed.Points)).toBe(true);
    expect(LedgerSystem.netsUnder(JournalFeed.Rewards)).toBe(false);
    expect(LedgerSystem.netsUnder(JournalFeed.Status)).toBe(false);
  });
});

describe('LedgerSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const journal = deepFreeze([...JOURNAL]);
    const run = () => {
      const events = LedgerSystem.fold(journal, true);
      const voided = LedgerSystem.voided(journal);
      return [
        events,
        LedgerSystem.wholeMonths(journal, true),
        LedgerSystem.months(events, 5, ['2026-09']),
        journal.map((row) => LedgerSystem.levelOf(row)),
        [...voided],
        events.map((event) => LedgerSystem.isStruck(event, voided)),
        events.map((event) =>
          LedgerSystem.lineOf(event, LedgerSystem.leading(event) ?? VISIT_FADE),
        ),
        journal.map((row) => LedgerSystem.isWelcome(LedgerSystem.levelOf(row))),
        LedgerSystem.netsUnder(JournalFeed.Points),
      ];
    };
    expect(run()).toEqual(run());
    expect(journal.map((row) => row.id)).toEqual(JOURNAL.map((row) => row.id));
  });
});
