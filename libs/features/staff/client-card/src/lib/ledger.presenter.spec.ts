import { describe, expect, it } from 'vitest';
import {
  AchievementOp,
  Actor,
  GrantRefFields,
  JournalEffect,
  JournalEffectRecord,
  JournalFeed,
  JournalSourceRecord,
  JournalSystemJob,
  JournalVisibility,
  type LabelCode,
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
  JournalEntryId,
  RedemptionId,
  RewardId,
  TierId,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import { utcMs } from '@core/testing';
import {
  type ActivityRowVm,
  CardLoadState,
  type LinePart,
} from './client-pages.vm';
import {
  type ActivityInput,
  LEDGER_PAGE_READ,
  type LedgerPageInput,
  activityGroups,
  foldByEvent,
  ledgerPageVm,
  wholeMonthsOf,
} from './ledger.presenter';
import {
  GEORGI_CUSTOMER_ID,
  GEORGI_LOYALTY,
  SHOP_TIME_ZONE,
  TODAY,
  loyaltyCatalog,
  must,
  wordsOf,
} from '../testing/client-card.fixtures';

/*
 * «ДВИЖЕНИЕ» (client-card-revision-3 §2.2.5, §2.2.6, §4.7). The rows are
 * built from journal entries as the journal port hands them over — the
 * stored `clientJournal` bodies: Георги's own journal as stored, and
 * entries made here for the kinds the account fixtures do not hold (they
 * keep point rows only). The words are the app's catalogue, so a key the
 * presenter names and the catalogue lacks fails here.
 */

const WORDS = wordsOf('bg');
const CATALOG = loyaltyCatalog();

/** The joint of a fact line: a no-break space before the middot. */
const NBSP = String.fromCharCode(0xa0);
const JOINT = `${NBSP}· `;
const MINUS = String.fromCharCode(0x2212);

/** A month's heading as `Intl` words it: a narrow no-break space before its «г.». */
const heading = (month: string) => `${month}${String.fromCharCode(0x202f)}г.`;

const joined = (line: readonly LinePart[]) =>
  line.map((part) => part.text).join('');

/** What an entry changed, and the balance once it was folded in (every stored row carries one). */
type Effect = {
  readonly record: JournalEffectRecord;
  readonly balanceAfter: number;
};

/** A row's client-visible label: its key and its named parameters, in the order written. */
type Label = {
  readonly code: LabelCode;
  readonly params: Readonly<Record<string, string | number>>;
};

/** An instant and the shop day the boundary files it under (T5: written together). */
function stamped(iso: string): Pick<JournalEntry, 'utcEpochMs' | 'localDate'> {
  const at = utcMs(iso);
  return {
    utcEpochMs: at,
    localDate: ZonedTimeSystem.toLocal(at, SHOP_TIME_ZONE).localDate,
  };
}

/** The visit a correlation id names (`appt:{id}…`), as the stored rows carry it in `appointmentId`. */
function visitOf(correlationId: string): AppointmentId | null {
  const [root, id] = correlationId.split(':');
  return root === 'appt' && id !== undefined && id !== ''
    ? AppointmentId.of(id)
    : null;
}

/** A `clientJournal` row as the journal port answers one. */
function entry(
  seq: number,
  day: string,
  correlationId: string,
  effect: Effect,
  label: Label,
  reverses: string | null = null,
): JournalEntry {
  return {
    id: JournalEntryId.of(`e-${seq}`),
    customerId: GEORGI_CUSTOMER_ID,
    seq,
    // 10:45 in Sofia: the day is the same on the shop's calendar.
    ...stamped(`${day}T07:45:00.000Z`),
    reverses: reverses === null ? null : JournalEntryId.of(reverses),
    correlationId: CorrelationId.of(correlationId),
    idempotencyKey: `key-${seq}`,
    journalVisibility: JournalVisibility.Client,
    labelCode: label.code,
    labelParams: Object.entries(label.params).map(([name, value]) => ({
      name,
      value,
    })),
    balanceAfter: effect.balanceAfter,
    appointmentId: visitOf(correlationId),
    ...Actor.system(SystemSource.LoyaltyEngine),
    ...JournalSourceRecord.system(JournalSystemJob.Tier),
    ...effect.record,
  };
}

const points = (delta: number, balanceAfter: number): Effect => ({
  record: JournalEffectRecord.points(delta),
  balanceAfter,
});

const tierChanged = (
  from: string,
  to: string,
  balanceAfter: number,
): Effect => ({
  record: {
    journalEffect: JournalEffect.Tier,
    tierOp: TierOp.Changed,
    tierFrom: TierId.of(from),
    tierTo: TierId.of(to),
    tierUntil: null,
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
    redeemedRewardId: RewardId.of('reward-cut'),
    redemptionCost,
    ...GrantRefFields.none(),
  },
  balanceAfter,
});

const reward = (rewardOp: RewardOp, balanceAfter: number): Effect => ({
  record: {
    journalEffect: JournalEffect.Reward,
    rewardOp,
    ...RewardRefFields.couponGrant(CouponGrantId.of('grant-punch-10')),
  },
  balanceAfter,
});

const achievement = (
  ruleId: string,
  achievementOp: AchievementOp,
  balanceAfter: number,
): Effect => ({
  record: {
    journalEffect: JournalEffect.Achievement,
    achievementRuleId: AchievementRuleId.of(ruleId),
    achievementRuleVersion: 1,
    achievementAwardKey: `${ruleId}:dev-client-1`,
    achievementOp,
  },
  balanceAfter,
});

const earned = (amount: number): Label => ({
  code: 'points.rule',
  params: { rule: 'rule-earn-per-euro', points: amount },
});

/** One journal that holds every kind of §2.2.5, a reversal and the row it struck among them. */
const VISIT_FADE = entry(
  50,
  '2026-09-05',
  'appt:appt-a',
  points(17, 361),
  earned(17),
);
const VISIT_BEARD = entry(
  51,
  '2026-09-05',
  'appt:appt-a',
  points(10, 371),
  earned(10),
);
const TIER = entry(
  49,
  '2026-09-02',
  'tier:dev-client-1:gold:2026-09-02',
  tierChanged('silver', 'gold', 344),
  { code: 'tier.changed', params: { from: 'silver', to: 'gold' } },
);
const REDEEMED_POINTS = entry(45, '2026-06-20', 'rdm-1', points(-250, 94), {
  code: 'points.redeemed',
  params: { reward: 'reward-cut', points: 250 },
});
const REDEEMED = entry(
  46,
  '2026-06-20',
  'rdm-1',
  redemption(RedemptionOp.Redeemed, 250, 94),
  {
    code: 'redemption.changed',
    params: { op: 'redeemed', reward: 'reward-cut' },
  },
);
const GRANTED_LABEL: Label = {
  code: 'reward.granted',
  params: { rule: 'rule-every-10th-visit', reward: 'reward-cut', stamp: 10 },
};
const GRANTED = entry(
  44,
  '2026-05-16',
  'award:rule-every-10th-visit:dev-client-1:10',
  reward(RewardOp.Granted, 344),
  GRANTED_LABEL,
);
const GOODWILL = entry(43, '2026-04-18', 'adj-1', points(30, 344), {
  code: 'points.goodwill',
  params: {},
});
const REVERSAL = entry(
  42,
  '2026-04-05',
  'appt:appt-b',
  points(-17, 314),
  { code: 'points.reversed', params: {} },
  'e-41',
);
const REVERSED = entry(
  41,
  '2026-04-04',
  'appt:appt-b',
  points(17, 331),
  earned(17),
);
const LEVEL = entry(
  39,
  '2026-03-06',
  'award:rule-tenure-1',
  achievement('rule-tenure-1', AchievementOp.Granted, 314),
  {
    code: 'achievement.earned',
    params: { rule: 'rule-tenure-1', seriesId: 'series-tenure', level: 1 },
  },
);
const LEVEL_POINTS = entry(
  40,
  '2026-03-06',
  'award:rule-tenure-1',
  points(50, 314),
  {
    code: 'points.rule',
    params: {
      rule: 'rule-tenure-1',
      points: 50,
      seriesId: 'series-tenure',
      level: 1,
    },
  },
);
const EXPIRED = entry(35, '2025-12-31', 'exp-2025', points(-40, 264), {
  code: 'points.expired',
  params: {},
});
const LEVEL_BARE = entry(
  30,
  '2025-09-24',
  'award:rule-fade-2',
  achievement('rule-fade-2', AchievementOp.Granted, 304),
  {
    code: 'achievement.earned',
    params: { rule: 'rule-fade-2', seriesId: 'series-svc-fade', level: 2 },
  },
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

function activityInput(overrides: Partial<ActivityInput> = {}): ActivityInput {
  return {
    visitTitles: new Map([
      ['appt-a', 'Фейд · Оформяне на брада'],
      ['2026-04-04', 'Фейд'],
    ]),
    visitBarbers: new Map([
      ['appt-a', 'Иван'],
      ['appt-b', 'Иван'],
    ]),
    catalog: CATALOG,
    today: TODAY,
    wholeMonths: wholeMonthsOf(JOURNAL, true),
    words: WORDS,
    ...overrides,
  };
}

/** Every row of a journal, by the id of its event's newest entry. */
function rowsOf(
  entries: readonly JournalEntry[],
  overrides: Partial<ActivityInput> = {},
): ReadonlyMap<string, ActivityRowVm> {
  return new Map(
    activityGroups(
      foldByEvent(entries, true),
      activityInput({
        wholeMonths: wholeMonthsOf(entries, true),
        ...overrides,
      }),
    )
      .flatMap((group) => group.rows)
      .map((row) => [row.entryId, row]),
  );
}

/** Георги's journal as the feed reads it: every row as stored. */
function georgiJournal(): readonly JournalEntry[] {
  return GEORGI_LOYALTY.clientJournal;
}

/** The stored id of Георги's row `seq`. */
function georgiEntryId(seq: number): string {
  return must(
    GEORGI_LOYALTY.clientJournal.find((row) => row.seq === seq),
    `Георги’s row ${seq}`,
  ).id;
}

describe('foldByEvent', () => {
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
    const [visit, tier, redemption] = foldByEvent(JOURNAL, true);
    expect(visit).toMatchObject({ delta: 27, balanceAfter: 371 });
    // No points moved: no amount, no balance.
    expect(tier).toMatchObject({ delta: null, balanceAfter: null });
    expect(redemption).toMatchObject({ delta: -250, balanceAfter: 94 });
  });

  it('folds a visit’s seats under either spelling of its id', () => {
    const seats = [
      entry(
        2,
        '2026-07-13',
        'appt:appt-c:seat:s2',
        points(10, 307),
        earned(10),
      ),
      entry(
        1,
        '2026-07-13',
        'appt:appt-c:seat:s1',
        points(17, 297),
        earned(17),
      ),
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

  it('keeps a level an event of its own where its bonus rode the visit’s id', () => {
    // The first round's journals file a level's points under the visit
    // that earned it: the visit stays a visit, the level a level.
    const day = [
      entry(8, '2025-06-04', 'appt:appt-d:seat:s1', points(20, 135), {
        code: 'points.rule',
        params: {
          rule: 'rule-visits-2',
          points: 20,
          seriesId: 'series-visits',
          level: 2,
        },
      }),
      entry(
        7,
        '2025-06-04',
        'appt:appt-d:seat:s1',
        points(17, 115),
        earned(17),
      ),
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
      {
        code: 'redemption.changed',
        params: { op: 'reversed', reward: 'reward-cut' },
      },
    );
    expect(foldByEvent([back], true)[0]?.delta).toBe(250);
    const lapsed = entry(
      48,
      '2026-09-20',
      'rdm-1-lapsed',
      redemption(RedemptionOp.Expired, 250, 344),
      {
        code: 'redemption.changed',
        params: { op: 'expired', reward: 'reward-cut' },
      },
    );
    // The points were spent when it was taken: nothing moves a second time.
    expect(foldByEvent([lapsed], true)[0]?.delta).toBeNull();
  });

  it('never folds a row that compensates another, nor the row it struck, into their visit', () => {
    const other = entry(
      40.5,
      '2026-04-04',
      'appt:appt-b',
      points(10, 341),
      earned(10),
    );
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

describe('wholeMonthsOf', () => {
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

describe('activityGroups: a row by its kind (§2.2.5)', () => {
  const rows = rowsOf(JOURNAL);

  it('names a visit by its services, its line by who did it', () => {
    expect(rows.get('e-51')).toEqual({
      entryId: 'e-51',
      icon: 'loyalty.activity.visit',
      tone: 'accent',
      title: 'Фейд · Оформяне на брада',
      lines: [{ text: `5.09${JOINT}Иван`, hold: `${JOINT}Иван` }],
      struck: false,
      amount: '+27 т.',
      balanceAfter: '371 т.',
      accessibleName:
        'Спечелени, Посещение: Фейд · Оформяне на брада, 5 септември, +27 т.',
    });
  });

  it('finds a visit by its day where the map does not know the appointment, and says «Посещение» where it knows neither', () => {
    const byDay = rowsOf([REVERSED]).get('e-41');
    expect(byDay).toMatchObject({ title: 'Фейд', struck: false });
    expect(
      rowsOf([VISIT_FADE], {
        visitTitles: new Map(),
        visitBarbers: undefined,
      }).get('e-50'),
    ).toMatchObject({
      title: 'Посещение',
      lines: [{ text: '5.09' }],
      accessibleName: 'Спечелени, Посещение, 5 септември, +17 т.',
    });
  });

  it('names a level by its family and numeral, with what it paid', () => {
    expect(rows.get('e-40')).toEqual({
      entryId: 'e-40',
      icon: 'loyalty.activity.level',
      tone: 'accent',
      title: `Години с нас${NBSP}I`,
      lines: [{ text: `6.03${JOINT}постижение` }],
      struck: false,
      amount: '+50 т.',
      balanceAfter: '314 т.',
      accessibleName: 'Бонус, Постижение: Години с нас I, 6 март, +50 т.',
    });
  });

  it('draws a level that paid nothing without an amount, and opens its sentence on what it is', () => {
    expect(rows.get('e-30')).toEqual({
      entryId: 'e-30',
      icon: 'loyalty.activity.level',
      tone: 'accent',
      title: `Фейд${NBSP}II`,
      // The row's day says no year: the month heading over it owns one.
      lines: [{ text: `24.09${JOINT}постижение` }],
      struck: false,
      amount: null,
      balanceAfter: null,
      accessibleName: 'Постижение: Фейд II, 24 септември 2025 г.',
    });
  });

  it('names a redemption by its reward: the redemption leads, the points are its amount', () => {
    expect(rows.get('e-46')).toEqual({
      entryId: 'e-46',
      icon: 'loyalty.activity.redeemed',
      tone: 'neutral',
      title: 'Безплатно подстригване',
      lines: [{ text: `20.06${JOINT}размяна` }],
      struck: false,
      amount: `${MINUS}250 т.`,
      balanceAfter: '94 т.',
      accessibleName: `Използвани, Размяна: Безплатно подстригване, 20 юни, ${MINUS}250 т.`,
    });
  });

  it('draws a reward received, and one taken back, without an amount', () => {
    expect(rows.get('e-44')).toEqual({
      entryId: 'e-44',
      icon: 'loyalty.activity.granted',
      tone: 'accent',
      title: 'Безплатно подстригване',
      lines: [{ text: `16.05${JOINT}получена награда` }],
      struck: false,
      amount: null,
      balanceAfter: null,
      accessibleName: 'Получена награда, Безплатно подстригване, 16 май',
    });
    const revoked = entry(
      44,
      '2026-05-16',
      'award:rule-every-10th-visit:dev-client-1:10',
      reward(RewardOp.Revoked, 344),
      { code: 'reward.revoked', params: GRANTED_LABEL.params },
    );
    expect(rowsOf([revoked]).get('e-44')).toMatchObject({
      lines: [{ text: `16.05${JOINT}отнета награда` }],
      accessibleName: 'Отнета награда, Безплатно подстригване, 16 май',
    });
  });

  it('words a tier change by where it leads and where it came from', () => {
    expect(rows.get('e-49')).toEqual({
      entryId: 'e-49',
      icon: 'loyalty.activity.tier',
      tone: 'accent',
      title: 'Статус: Злато',
      lines: [{ text: `2.09${JOINT}от Сребро` }],
      struck: false,
      amount: null,
      balanceAfter: null,
      accessibleName: 'Нов статус, Статус: Злато, 2 септември, от Сребро',
    });
  });

  it('names the shop’s points by their source, the date alone on the line', () => {
    expect(rows.get('e-43')).toEqual({
      entryId: 'e-43',
      icon: 'loyalty.activity.adjusted',
      tone: 'neutral',
      title: 'Бонус от салона',
      lines: [{ text: '18.04' }],
      struck: false,
      amount: '+30 т.',
      balanceAfter: '344 т.',
      accessibleName: 'Корекция, Бонус от салона, 18 април, +30 т.',
    });
    const issue: JournalEntry = {
      ...GOODWILL,
      labelCode: 'points.serviceIssue',
      labelParams: [],
    };
    expect(rowsOf([issue]).get('e-43')?.title).toBe('Компенсация от салона');
    const correction: JournalEntry = {
      ...GOODWILL,
      labelCode: 'points.correction',
      labelParams: [],
    };
    expect(rowsOf([correction]).get('e-43')?.title).toBe('Корекция от салона');
  });

  it('titles points that lapsed by what happened to them', () => {
    expect(rows.get('e-35')).toEqual({
      entryId: 'e-35',
      icon: 'loyalty.activity.expired',
      tone: 'neutral',
      title: 'Изтекли',
      lines: [{ text: '31.12' }],
      struck: false,
      amount: `${MINUS}40 т.`,
      balanceAfter: '264 т.',
      accessibleName: `Изтекли, 31 декември 2025 г., ${MINUS}40 т.`,
    });
  });

  it('names a reward that lapsed, and says on its line what became of it', () => {
    const lapsed = entry(
      48,
      '2026-09-20',
      'rdm-1-lapsed',
      redemption(RedemptionOp.Expired, 250, 344),
      {
        code: 'redemption.changed',
        params: { op: 'expired', reward: 'reward-cut' },
      },
    );
    expect(rowsOf([lapsed]).get('e-48')).toEqual({
      entryId: 'e-48',
      icon: 'loyalty.activity.expired',
      tone: 'neutral',
      title: 'Безплатно подстригване',
      lines: [{ text: `20.09${JOINT}изтекли` }],
      struck: false,
      amount: null,
      balanceAfter: null,
      accessibleName: 'Изтекли, Безплатно подстригване, 20 септември',
    });
  });

  it('words a reversal by the row it takes back, and strikes that row', () => {
    expect(rows.get('e-42')).toEqual({
      entryId: 'e-42',
      icon: 'loyalty.activity.reversed',
      tone: 'neutral',
      title: 'Анулирано',
      lines: [{ text: `отменя запис от 4.04${JOINT}5.04` }],
      struck: false,
      amount: `${MINUS}17 т.`,
      balanceAfter: '314 т.',
      accessibleName: `Анулирано, отменя запис от 4 април, 5 април, ${MINUS}17 т.`,
    });
    expect(rows.get('e-41')).toEqual({
      entryId: 'e-41',
      icon: 'loyalty.activity.visit',
      tone: 'accent',
      title: 'Фейд',
      lines: [{ text: `4.04${JOINT}Иван${JOINT}отменено` }],
      struck: true,
      amount: '+17 т.',
      balanceAfter: '331 т.',
      accessibleName: 'Спечелени, Посещение: Фейд, 4 април, +17 т., отменено',
    });
  });

  it('gives a reversal whose row is not loaded its date alone', () => {
    expect(rowsOf([REVERSAL]).get('e-42')).toMatchObject({
      lines: [{ text: '5.04' }],
      accessibleName: `Анулирано, 5 април, ${MINUS}17 т.`,
    });
  });

  it('titles a row by what happened while the catalogue cannot name its subject', () => {
    const bare = rowsOf(JOURNAL, { catalog: null });
    expect(bare.get('e-46')).toMatchObject({
      title: 'Използвани',
      lines: [{ text: `20.06${JOINT}размяна` }],
      accessibleName: `Използвани, 20 юни, ${MINUS}250 т.`,
    });
    expect(bare.get('e-44')).toMatchObject({
      title: 'Получена награда',
      lines: [{ text: '16.05' }],
      accessibleName: 'Получена награда, 16 май',
    });
    expect(bare.get('e-49')).toMatchObject({
      title: 'Нов статус',
      lines: [{ text: '2.09' }],
      accessibleName: 'Нов статус, 2 септември',
    });
    expect(bare.get('e-40')).toMatchObject({
      title: 'Бонус',
      accessibleName: 'Бонус, 6 март, +50 т.',
    });
    expect(bare.get('e-30')).toMatchObject({
      title: 'Постижение',
      lines: [{ text: '24.09' }],
      accessibleName: 'Постижение, 24 септември 2025 г.',
    });
  });

  it('prints an amount over its balance or neither, one line a row, the minus a minus', () => {
    for (const row of rows.values()) {
      expect(row.amount === null).toBe(row.balanceAfter === null);
      if (row.amount !== null) {
        expect(row.amount).toMatch(/^[+−]\d.* т\.$/u);
      }
      expect(row.lines).toHaveLength(1);
      expect(row.accessibleName).not.toMatch(/-\d|\{\{|undefined|null| {2}/u);
    }
  });
});

describe('activityGroups: the months', () => {
  it('groups by the shop’s month, newest first, each under its heading', () => {
    const groups = activityGroups(foldByEvent(JOURNAL, true), activityInput());
    expect(groups.map((group) => [group.key, group.label, group.net])).toEqual([
      ['2026-09', heading('Септември 2026'), '+27 т.'],
      ['2026-06', heading('Юни 2026'), `${MINUS}250 т.`],
      // A reward received moved no points: the month has nothing to net.
      ['2026-05', heading('Май 2026'), null],
      // +30, the visit and its reversal: they cancel out.
      ['2026-04', heading('Април 2026'), '+30 т.'],
      ['2026-03', heading('Март 2026'), '+50 т.'],
      ['2025-12', heading('Декември 2025'), `${MINUS}40 т.`],
      ['2025-09', heading('Септември 2025'), null],
    ]);
    expect(groups[0]?.rows.map((row) => row.entryId)).toEqual(['e-51', 'e-49']);
    expect(groups[3]?.rows.map((row) => row.entryId)).toEqual([
      'e-43',
      'e-42',
      'e-41',
    ]);
  });

  it('files an instant under the month it falls in on the shop’s calendar', () => {
    // 22:30 UTC on 31 August is 1:30 on 1 September in Sofia: the
    // boundary files the row under that day, and the month is the day's.
    const late: JournalEntry = {
      ...VISIT_FADE,
      ...stamped('2026-08-31T22:30:00.000Z'),
    };
    const [group] = activityGroups(
      foldByEvent([late], true),
      activityInput({ wholeMonths: wholeMonthsOf([late], true) }),
    );
    expect(group?.key).toBe('2026-09');
    expect(group?.rows[0]?.lines[0]?.text).toContain('1.09');
  });

  it('prints no net for a month the page boundary may have cut', () => {
    const groups = activityGroups(
      foldByEvent(JOURNAL, false),
      activityInput({ wholeMonths: wholeMonthsOf(JOURNAL, false) }),
    );
    // The oldest event is held back, and with it its month.
    expect(groups.map((group) => group.key)).not.toContain('2025-09');
    expect(groups.at(-1)).toMatchObject({
      key: '2025-12',
      net: `${MINUS}40 т.`,
    });
    const cut = activityGroups(
      foldByEvent([VISIT_BEARD, VISIT_FADE, TIER, REDEEMED], false),
      activityInput({
        wholeMonths: wholeMonthsOf(
          [VISIT_BEARD, VISIT_FADE, TIER, REDEEMED],
          false,
        ),
      }),
    );
    expect(cut.map((group) => [group.key, group.net])).toEqual([
      ['2026-09', '+27 т.'],
    ]);
  });

  it('shows the newest events only under a limit, and no net over a month the limit cut', () => {
    const groups = activityGroups(
      foldByEvent(JOURNAL, true),
      activityInput({ limit: 5 }),
    );
    expect(
      groups.flatMap((group) => group.rows).map((row) => row.entryId),
    ).toEqual(['e-51', 'e-49', 'e-46', 'e-44', 'e-43']);
    expect(groups.map((group) => [group.key, group.net])).toEqual([
      ['2026-09', '+27 т.'],
      ['2026-06', `${MINUS}250 т.`],
      ['2026-05', null],
      // April holds two rows more than the five show.
      ['2026-04', null],
    ]);
    expect(
      activityGroups(foldByEvent(JOURNAL, true), activityInput({ limit: 0 })),
    ).toEqual([]);
  });
});

describe('Георги’s own journal', () => {
  const journal = georgiJournal();

  it('reads every row of the wire, a visit’s two seats one row', () => {
    expect(journal).toHaveLength(35);
    const groups = activityGroups(
      foldByEvent(journal, true),
      activityInput({
        visitTitles: new Map([['2026-07-13', 'Фейд · Оформяне на брада']]),
        visitBarbers: undefined,
        wholeMonths: wholeMonthsOf(journal, true),
      }),
    );
    const july = groups.find((group) => group.key === '2026-07');
    expect(july).toMatchObject({
      label: heading('Юли 2026'),
      net: '+27 т.',
      rows: [
        {
          entryId: georgiEntryId(32),
          title: 'Фейд · Оформяне на брада',
          lines: [{ text: '13.07' }],
          amount: '+27 т.',
          balanceAfter: '307 т.',
        },
      ],
    });
    const march = groups.find((group) => group.key === '2026-03');
    expect(march?.rows.map((row) => [row.title, row.amount])).toEqual([
      ['Безплатно подстригване', `${MINUS}250 т.`],
      ['Посещение', '+17 т.'],
      [`Години с нас${NBSP}I`, '+50 т.'],
    ]);
    expect(march?.net).toBe(`${MINUS}183 т.`);
    // The welcome bonus is named as the catalogue's own words name it.
    const first = groups.at(-1)?.rows.at(-2);
    expect(first).toMatchObject({ title: 'Добре дошъл', amount: '+20 т.' });
  });

  it('ends on the balance the account holds', () => {
    const [newest] = activityGroups(
      foldByEvent(journal, true),
      activityInput({ wholeMonths: wholeMonthsOf(journal, true) }),
    );
    expect(newest?.rows[0]?.balanceAfter).toBe('358 т.');
  });
});

describe('ledgerPageVm', () => {
  function pageInput(
    overrides: Partial<LedgerPageInput> = {},
  ): LedgerPageInput {
    return {
      ...activityInput(),
      cardLoadState: CardLoadState.Ready,
      entries: JOURNAL,
      next: null,
      loadingMore: false,
      failedMore: false,
      filter: JournalFeed.All,
      holder: 'Георги Петров',
      balance: 371,
      online: true,
      ...overrides,
    };
  }

  it('asks the reader for thirty rows a page', () => {
    expect(LEDGER_PAGE_READ).toBe(30);
  });

  it('cuts the quiet line around the balance, the one fact of it', () => {
    const page = ledgerPageVm(pageInput());
    expect(page.subline).toEqual([
      { text: 'Георги Петров · ', fact: false },
      { text: '371 т.', fact: true },
    ]);
    expect(joined(page.subline)).toBe('Георги Петров · 371 т.');
    // Owing reads as a minus; until the name is known the line is the balance.
    expect(
      ledgerPageVm(pageInput({ holder: ' ', balance: -40 })).subline,
    ).toEqual([{ text: `${MINUS}40 т.`, fact: true }]);
  });

  it('draws every page read so far, and ends the list when no cursor is left', () => {
    const page = ledgerPageVm(pageInput());
    expect(page.cardLoadState).toBe(CardLoadState.Ready);
    expect(page.filter).toBe(JournalFeed.All);
    expect(page.groups.flatMap((group) => group.rows)).toHaveLength(10);
    expect(page.paging).toEqual({ kind: 'end' });
  });

  it('offers the next page, holding the event the boundary may have cut', () => {
    const page = ledgerPageVm(
      pageInput({ next: 30, wholeMonths: wholeMonthsOf(JOURNAL, false) }),
    );
    expect(page.groups.flatMap((group) => group.rows)).toHaveLength(9);
    expect(page.paging).toEqual({ kind: 'more' });
    expect(
      ledgerPageVm(pageInput({ next: 30, loadingMore: true })).paging,
    ).toEqual({ kind: 'loading' });
    expect(
      ledgerPageVm(pageInput({ next: 30, failedMore: true })).paging,
    ).toEqual({ kind: 'failed' });
  });

  it('states no foot offline while a cursor is left, and still ends a list that has ended', () => {
    expect(
      ledgerPageVm(pageInput({ next: 30, online: false })).paging,
    ).toBeNull();
    expect(ledgerPageVm(pageInput({ online: false })).paging).toEqual({
      kind: 'end',
    });
  });

  it('draws nothing under the headline until the first page is read', () => {
    for (const cardLoadState of [
      CardLoadState.Loading,
      CardLoadState.Failed,
    ] as const) {
      const page = ledgerPageVm(pageInput({ cardLoadState }));
      expect(page).toMatchObject({ cardLoadState, groups: [], paging: null });
      expect(joined(page.subline)).toBe('Георги Петров · 371 т.');
    }
  });

  it('reads an empty journal, and a kind nothing answers, as a list that has ended', () => {
    expect(ledgerPageVm(pageInput({ entries: [] }))).toMatchObject({
      groups: [],
      paging: { kind: 'end' },
    });
    expect(
      ledgerPageVm(pageInput({ entries: [], filter: JournalFeed.Rewards })),
    ).toMatchObject({ filter: JournalFeed.Rewards, groups: [] });
  });

  it('nets a month under «Точки», and under no pill that reads other rows', () => {
    const pointRows = JOURNAL.filter(
      (row) => row.journalEffect === JournalEffect.Points,
    );
    const underPoints = ledgerPageVm(
      pageInput({
        filter: JournalFeed.Points,
        entries: pointRows,
        wholeMonths: wholeMonthsOf(pointRows, true),
      }),
    );
    expect(underPoints.groups.map((group) => [group.key, group.net])).toEqual([
      ['2026-09', '+27 т.'],
      ['2026-06', `${MINUS}250 т.`],
      ['2026-04', '+30 т.'],
      ['2026-03', '+50 т.'],
      ['2025-12', `${MINUS}40 т.`],
    ]);
    // Without its redemption row the points are still a redemption's.
    expect(underPoints.groups[1]?.rows[0]).toMatchObject({
      icon: 'loyalty.activity.redeemed',
      title: 'Безплатно подстригване',
    });

    const rewardRows = [REDEEMED, GRANTED];
    const underRewards = ledgerPageVm(
      pageInput({
        filter: JournalFeed.Rewards,
        entries: rewardRows,
        wholeMonths: wholeMonthsOf(rewardRows, true),
      }),
    );
    expect(
      underRewards.groups.map((group) => [
        group.key,
        group.net,
        group.rows.map((row) => [row.amount, row.balanceAfter]),
      ]),
    ).toEqual([
      ['2026-06', null, [[`${MINUS}250 т.`, null]]],
      ['2026-05', null, [[null, null]]],
    ]);

    const underStatus = ledgerPageVm(
      pageInput({
        filter: JournalFeed.Status,
        entries: [TIER],
        wholeMonths: wholeMonthsOf([TIER], true),
      }),
    );
    expect(underStatus.groups).toMatchObject([
      { key: '2026-09', net: null, rows: [{ title: 'Статус: Злато' }] },
    ]);
  });

  it('words the page in English from the same entries', () => {
    const page = ledgerPageVm(pageInput({ words: wordsOf('en') }));
    expect(joined(page.subline)).toBe('Георги Петров · 371 pts');
    expect(page.groups[0]).toMatchObject({
      label: 'September 2026',
      net: '+27 pts',
    });
    const names = page.groups
      .flatMap((group) => group.rows)
      .map((row) => row.accessibleName);
    expect(names).toHaveLength(10);
    expect(names.filter((name) => /\{\{|undefined|null/u.test(name))).toEqual(
      [],
    );
  });
});
