/**
 * Client details — typed example data for spec §9, with executable checks.
 * Cast: Мартин Илиев (dev-client-2) carries corrections B, C, D; Петър Димитров (dev-client-3) carries A.
 * Staff: Иван (barber + admin, the owner), Мария (receptionist), Нико (barber).
 */
import {
  actorForCaller,
  adjustmentEntryKey,
  auditActionOf,
  awardEntryKey,
  awardKey,
  capabilityFor,
  clientCaused,
  decide,
  decisionProblem,
  DEFAULT_LOYALTY_POLICY,
  DEFAULT_SUPPORT_POLICY,
  dueCueOn,
  eligibleApprovers,
  foldsInClientLedger,
  isRequestId,
  isStaffRelated,
  lapsedSince,
  manualDebitProblem,
  mayOverdraw,
  notifyByDefault,
  occurrenceKey,
  pauseChoiceDefault,
  pauseSummaryOf,
  pointsExpiryOf,
  pointsOnSubject30d,
  pointsToday,
  projectAccountStatus,
  REASON_PUBLIC_LABEL,
  REASONS_BY_KIND,
  receiptUndoOf,
  redeemProblem,
  reversalProblem,
  ROLE_CAPABILITIES,
  CAPABILITIES,
  seatFactKey,
  statWindows,
  suggestPause,
  validateRuleBody,
} from './model';
import type {
  Actor,
  Adjustment,
  AdjustmentId,
  BadgeEmblem,
  BadgeSpec,
  AppointmentId,
  ApprovalRequest,
  AuditRow,
  AwardKey,
  BarberId,
  CascadePreview,
  Choice,
  ChoiceId,
  ClientActivityEntry,
  ClientJournalEntry,
  ClientMoneyStats,
  ClientPause,
  ClientPauseNote,
  ClientProfile,
  ClientStats,
  Condition,
  CorrelationId,
  CouponGrantId,
  CouponId,
  GiftVoucherId,
  HeldNotification,
  IdempotencyKey,
  IsoDate,
  IsoInstant,
  JournalEffect,
  JournalEntryId,
  JournalSource,
  LocalizedText,
  LoyaltyAccount,
  LoyaltyEventId,
  MetricRef,
  PauseId,
  PauseTerm,
  PreviewLine,
  PublicLabel,
  PublicLabelCode,
  Redemption,
  RedemptionId,
  RequestId,
  RewardCatalogItem,
  RewardId,
  RuleBody,
  RuleExplanation,
  RuleId,
  RuleRef,
  RuleVersion,
  SeatId,
  ServiceId,
  StateVersion,
  StreakDefinition,
  StreakId,
  SupportActorUsage,
  SupportAuditAction,
  TierDefinition,
  TierId,
  Trigger,
  TriggerKind,
  UserId,
  UserRole,
  VisitFact,
} from './model';

// ── check harness ────────────────────────────────────────────────────────────
let checks = 0;
export function check(label: string, cond: boolean): void {
  if (!cond) throw new Error(`check failed: ${label}`);
  checks += 1;
}

// ── brand helpers (examples only; production mints ids in the port layer) ───
const uid = (s: string) => s as UserId;
const rid = (s: string) => s as RuleId;
const t = (s: string) => s as IsoInstant;
const d = (s: string) => s as IsoDate;
const jid = (s: string) => s as JournalEntryId;
const adj = (s: string) => s as AdjustmentId;
const aid = (s: string) => s as AppointmentId;
const seat = (s: string) => s as SeatId;
const evid = (s: string) => s as LoyaltyEventId;
const pid = (s: string) => s as PauseId;
const ik = (s: string) => s as IdempotencyKey;
const corr = (s: string) => s as CorrelationId;
const cid = (s: string) => s as CouponId;
const cg = (s: string) => s as CouponGrantId;
const svc = (s: string) => s as ServiceId;
const tid = (s: string) => s as TierId;
const rwd = (s: string) => s as RewardId;
const sv = (s: string) => s as StateVersion;
const chid = (s: string) => s as ChoiceId;
const bid = (s: string) => s as BarberId;
const txt = (bg: string, en: string): LocalizedText => ({ bg, en });
const label = (
  code: PublicLabelCode,
  params: Readonly<Record<string, string | number>> = {},
): PublicLabel => ({ code, params });
const R1 = (ruleId: string): RuleRef => ({ ruleId: rid(ruleId), version: 1 });
const fact = (appointmentId: string, seatId = 's1'): string =>
  seatFactKey(aid(appointmentId), seat(seatId));

// ── people ───────────────────────────────────────────────────────────────────
const IVAN = uid('dev-staff-ivan');
const MARIA = uid('dev-staff-maria');
const NIKO = uid('dev-staff-niko');
const MARTIN = uid('dev-client-2');
const PETAR = uid('dev-client-3');
const ROLES: Readonly<Record<string, readonly UserRole[]>> = {
  [IVAN]: ['barber', 'admin'],
  [MARIA]: ['receptionist'],
  [NIKO]: ['barber'],
  [MARTIN]: ['client'],
  [PETAR]: ['client'],
};
const rolesOf = (u: UserId): readonly UserRole[] => ROLES[u] ?? [];
const IVAN_A = actorForCaller(IVAN, rolesOf(IVAN)); // → admin
const MARIA_A = actorForCaller(MARIA, rolesOf(MARIA)); // → staff [receptionist]
const NIKO_A = actorForCaller(NIKO, rolesOf(NIKO)); // → staff [barber]
const ENGINE: Actor = { kind: 'system', source: 'loyalty_engine' };
const MIGRATION: Actor = { kind: 'system', source: 'loyalty_migration' };
const pol = DEFAULT_SUPPORT_POLICY;

// ── definitions ──────────────────────────────────────────────────────────────
const OWNER_AT = t('2026-06-01T06:00:00.000Z');
const CADENCE = 'cadence' as StreakId;
export const CADENCE_STREAK: StreakDefinition = {
  id: CADENCE,
  name: txt('Посещения в ритъм', 'Visits in rhythm'),
  version: 1,
  effectiveFrom: OWNER_AT,
  cadence: { kind: 'rollingDays', days: 42 },
  graceDays: 7,
  riskLeadDays: 7,
  freezes: { maxBanked: 2, earnEvery: 5, autoApply: true },
  repair: { windowDays: 14, perYear: 1 },
  excused: ['shopClosure', 'barberAbsence', 'staffCancelled'],
};
const tier = (
  id: string,
  bg: string,
  en: string,
  rank: number,
  atLeast: number,
  benefits: TierDefinition['benefits'],
): TierDefinition => ({
  id: tid(id),
  name: txt(bg, en),
  rank,
  benefits,
  version: 1,
  effectiveFrom: OWNER_AT,
  qualify: {
    metric: 'client.visits.completed',
    atLeast,
    window: { lastDays: 365 },
  },
});
export const TIERS: readonly TierDefinition[] = [
  tier('bronze', 'Бронз', 'Bronze', 0, 0, []),
  tier('silver', 'Сребро', 'Silver', 1, 6, []),
  tier('gold', 'Злато', 'Gold', 2, 12, ['perk.priorityWaitlist']),
  tier('platinum', 'Платина', 'Platinum', 3, 20, [
    'perk.priorityWaitlist',
    'perk.bookFurtherAhead',
    'perk.freeReschedule',
  ]),
];
const ONE_PER_30_DAYS = {
  perClient: { count: 1, windowDays: 30 },
  total: null,
} as const;
export const CATALOG: readonly RewardCatalogItem[] = [
  {
    id: rwd('reward-beard-trim'),
    name: txt('Безплатно оформяне на брада', 'Free beard trim'),
    cost: 120,
    grants: { kind: 'coupon', couponId: cid('coupon-free-beard') },
    enabled: true,
    order: 1,
    available: { from: null, until: null },
    limits: ONE_PER_30_DAYS,
    redeemedCount: 14,
  },
  {
    id: rwd('reward-free-cut'),
    name: txt('Безплатно подстригване', 'Free haircut'),
    cost: 250,
    grants: { kind: 'coupon', couponId: cid('coupon-free-cut') },
    enabled: true,
    order: 2,
    available: { from: null, until: null },
    limits: ONE_PER_30_DAYS,
    redeemedCount: 6,
  },
];

// ── the rules (loyaltyRules/*/versions/1) ────────────────────────────────────
const rule = (id: string, body: RuleBody): RuleVersion => ({
  ruleId: rid(id),
  version: 1,
  body,
  publishedAt: OWNER_AT,
  publishedBy: IVAN_A,
  effectiveFrom: OWNER_AT,
});
const VISITS: MetricRef = { metric: 'client.visits.completed' };
const WORKED: Condition = {
  kind: 'event',
  field: 'outcomeTo',
  op: 'eq',
  value: 'worked',
};
const ON_VISIT: readonly TriggerKind[] = [
  'visit.completed',
  'visit.outcomeCorrected',
  'rule.replay',
];
const visitsAtLeast = (value: number): Condition => ({
  kind: 'threshold',
  metric: VISITS,
  op: 'gte',
  value,
});
const base = {
  programId: null,
  scope: 'client',
  badge: null,
  manualGrantable: false,
} as const;
const badge = (
  emblem: BadgeSpec['emblem'],
  bg: string,
  en: string,
  reqBg: string,
  reqEn: string,
  order: number,
  progress: BadgeSpec['progress'] = null,
): BadgeSpec => ({
  emblem,
  title: txt(bg, en),
  requirement: txt(reqBg, reqEn),
  progress,
  order,
});

export const RULES: readonly RuleVersion[] = [
  rule('earn-per-euro', {
    ...base,
    name: txt('Точки за посещение', 'Points per visit'),
    triggers: ON_VISIT,
    condition: WORKED,
    awards: [
      { kind: 'points', amount: { kind: 'perSpend', pointsPerMajor: 1 } },
    ],
    recurrence: { kind: 'perEvent' },
  }),
  rule('first-sign-in', {
    ...base,
    name: txt('Първи вход', 'First sign-in'),
    triggers: ['account.firstSignIn'],
    condition: { kind: 'always' },
    awards: [{ kind: 'cosmetic', cosmeticId: 'frame.welcome' }],
    recurrence: { kind: 'once' },
    manualGrantable: true,
    badge: badge(
      'welcome',
      'Първи вход',
      'First sign-in',
      'Влез в профила си',
      'Sign in to your profile',
      1,
    ),
  }),
  rule('welcome', {
    ...base,
    name: txt('Регистрация', 'Registration'),
    triggers: ['account.registered'],
    condition: { kind: 'always' },
    awards: [{ kind: 'points', amount: { kind: 'fixed', points: 20 } }],
    recurrence: { kind: 'once' },
    manualGrantable: true,
    badge: badge(
      'welcome',
      'Добре дошъл',
      'Welcome',
      'Завърши регистрацията',
      'Complete registration',
      2,
    ),
  }),
  rule('referral-inviter-signup', {
    ...base,
    name: txt('Покани приятел', 'Invite a friend'),
    triggers: ['referral.redeemed'],
    condition: {
      kind: 'referral',
      role: 'inviter',
      refereeCondition: { kind: 'always' },
    },
    awards: [{ kind: 'points', amount: { kind: 'fixed', points: 30 } }],
    recurrence: { kind: 'perReferee' },
  }),
  rule('referral-referee-welcome', {
    ...base,
    name: txt('Дошъл по покана', 'Joined by invitation'),
    triggers: ['account.registered'],
    condition: {
      kind: 'referral',
      role: 'referee',
      refereeCondition: { kind: 'always' },
    },
    awards: [{ kind: 'coupon', couponId: cid('coupon-first10') }],
    recurrence: { kind: 'once' },
    badge: badge(
      'referral',
      'Дошъл по покана',
      'Joined by invitation',
      'Регистрирай се с покана от приятел',
      "Register with a friend's invitation",
      7,
    ),
  }),
  rule('referral-inviter-3-visits', {
    ...base,
    name: txt('Приятелят ти е редовен', 'Your friend became a regular'),
    triggers: ['referral.refereeVisitCompleted'],
    condition: {
      kind: 'referral',
      role: 'inviter',
      refereeCondition: visitsAtLeast(3),
    },
    awards: [{ kind: 'points', amount: { kind: 'fixed', points: 100 } }],
    recurrence: { kind: 'perReferee' },
  }),
  // P4 (`badgeNeedsOnce`): the per-referee payout above keeps its perReferee key; its medal is this once-rule's own key
  rule('referral-inviter-badge', {
    ...base,
    name: txt('Доведе приятел', 'Brought a friend'),
    triggers: ['referral.refereeVisitCompleted', 'rule.replay'],
    condition: {
      kind: 'referral',
      role: 'inviter',
      refereeCondition: visitsAtLeast(3),
    },
    awards: [],
    recurrence: { kind: 'once' },
    manualGrantable: true,
    badge: badge(
      'referral',
      'Доведе приятел',
      'Brought a friend',
      'Приятел, когото покани, идва 3 пъти',
      'A friend you invited visits 3 times',
      8,
    ),
  }),
  rule('first-visit', {
    ...base,
    name: txt('Първо подстригване', 'First haircut'),
    triggers: ON_VISIT,
    condition: { kind: 'allOf', of: [WORKED, visitsAtLeast(1)] },
    awards: [],
    recurrence: { kind: 'once' },
    manualGrantable: true,
    badge: badge(
      'welcome',
      'Първо подстригване',
      'First haircut',
      'Първо посещение в салона',
      'Your first visit',
      3,
    ),
  }),
  rule('tenth-visit', {
    ...base,
    name: txt('10 посещения', '10 visits'),
    triggers: ON_VISIT,
    condition: { kind: 'allOf', of: [WORKED, visitsAtLeast(10)] },
    awards: [],
    recurrence: { kind: 'once' },
    manualGrantable: true,
    badge: badge(
      'visits',
      '10 посещения',
      '10 visits',
      '10 завършени посещения',
      '10 completed visits',
      4,
      { metric: VISITS, target: 10 },
    ),
  }),
  rule('every-10th-visit', {
    ...base,
    name: txt('Всяко 10-о подстригване', 'Every 10th haircut'),
    triggers: ON_VISIT,
    condition: {
      kind: 'allOf',
      of: [WORKED, { kind: 'everyNth', metric: VISITS, n: 10 }],
    },
    awards: [{ kind: 'coupon', couponId: cid('coupon-free-cut') }],
    recurrence: { kind: 'perOccurrence' },
  }),
  // B3: the shop-wide celebration is a coupon announced after the fact as a thank-you — no badge, never advertised
  rule('shop-100th-booking', {
    ...base,
    scope: 'shop',
    name: txt('Юбилеен час', 'Milestone booking'),
    triggers: ['booking.created'],
    condition: {
      kind: 'everyNth',
      metric: { metric: 'shop.bookings.created' },
      n: 100,
    },
    awards: [{ kind: 'coupon', couponId: cid('coupon-milestone-booking') }],
    recurrence: { kind: 'perOccurrence' },
  }),
  rule('waitlist-used', {
    ...base,
    name: txt('Хванат час от листата', 'Caught a waitlist slot'),
    triggers: ['waitlist.booked'],
    condition: {
      kind: 'threshold',
      metric: { metric: 'client.waitlist.booked' },
      op: 'gte',
      value: 1,
    },
    awards: [{ kind: 'points', amount: { kind: 'fixed', points: 10 } }],
    recurrence: { kind: 'once' },
    manualGrantable: true,
    badge: badge(
      'selfService',
      'Хванат час',
      'Slot caught',
      'Запиши се от листата на чакащите',
      'Book a slot from the waitlist',
      5,
    ),
  }),
  rule('streak-6', {
    ...base,
    name: txt('6 в ритъм', '6 in rhythm'),
    triggers: ['streak.extended', 'rule.replay'],
    condition: { kind: 'streak', streakId: CADENCE, atLeast: 6 },
    awards: [{ kind: 'streakFreeze', streakId: CADENCE, count: 1 }],
    recurrence: { kind: 'once' },
    manualGrantable: true,
    badge: badge(
      'streak',
      '6 в ритъм',
      '6 in rhythm',
      '6 поредни посещения до 6 седмици едно от друго',
      '6 visits in a row, each within 6 weeks',
      6,
    ),
  }),
  rule('birthday', {
    ...base,
    name: txt('Рожден ден', 'Birthday'),
    triggers: ['calendar.daily'],
    condition: {
      kind: 'allOf',
      of: [
        { kind: 'profile', field: 'birthDate', present: true },
        { kind: 'date', match: { kind: 'birthday' } },
      ],
    },
    awards: [{ kind: 'coupon', couponId: cid('coupon-birthday') }],
    recurrence: { kind: 'perPeriod', period: 'year' },
  }),
  // the yearly coupon above cannot carry a medal (`badgeNeedsOnce`); the birthday emblem is a visit ON the birthday, once
  rule('birthday-visit', {
    ...base,
    name: txt('Рожден ден в салона', 'Birthday at the shop'),
    triggers: ON_VISIT,
    condition: {
      kind: 'allOf',
      of: [
        WORKED,
        { kind: 'profile', field: 'birthDate', present: true },
        { kind: 'date', match: { kind: 'birthday' } },
      ],
    },
    awards: [],
    recurrence: { kind: 'once' },
    manualGrantable: true,
    badge: badge(
      'birthday',
      'Рожден ден в салона',
      'Birthday at the shop',
      'Подстрижи се на рождения си ден',
      'Get a haircut on your birthday',
      9,
    ),
  }),
  rule('welcome-back', {
    ...base,
    name: txt('Добре дошъл отново', 'Welcome back'),
    triggers: ON_VISIT,
    condition: {
      kind: 'allOf',
      of: [
        WORKED,
        visitsAtLeast(2),
        {
          kind: 'not',
          of: { kind: 'within', days: 180, condition: visitsAtLeast(2) },
        },
      ],
    },
    awards: [{ kind: 'coupon', couponId: cid('coupon-beard5') }],
    recurrence: { kind: 'perPeriod', period: 'year' },
  }),
];
const ruleById = (id: string): RuleVersion => {
  const r = RULES.find((x) => x.ruleId === id);
  if (r === undefined) throw new Error(`no rule ${id}`);
  return r;
};

// ── journal builders ─────────────────────────────────────────────────────────
function entry(
  userId: UserId,
  seq: number,
  at: string,
  balanceAfter: number,
  effect: JournalEffect,
  source: JournalSource,
  actor: Actor,
  correlationId: string,
  idempotencyKey: IdempotencyKey,
  visibility: 'client' | 'staff',
  publicLabel: PublicLabel,
  reverses: JournalEntryId | null = null,
): ClientJournalEntry {
  return {
    id: jid(`${userId}_${String(seq).padStart(6, '0')}`),
    userId,
    seq,
    at: t(at),
    effect,
    source,
    actor,
    reverses,
    correlationId: corr(correlationId),
    idempotencyKey,
    visibility,
    publicLabel,
    balanceAfter,
  };
}
const ruleSource = (
  ruleId: string,
  key: AwardKey,
  eventId: string,
): JournalSource => ({
  kind: 'rule',
  rule: R1(ruleId),
  awardKey: key,
  eventId: evid(eventId),
});
/** A seat's points: rule earn-per-euro, perEvent → keyed on the seat fact (R28), never on the revisioned event id. */
function earn(
  user: UserId,
  seq: number,
  at: string,
  bal: number,
  factKey: string,
  eventId: string,
  spendMinor: number,
  points: number,
  correlation = factKey,
): ClientJournalEntry {
  const key = awardKey(rid('earn-per-euro'), user, factKey);
  return entry(
    user,
    seq,
    at,
    bal,
    { kind: 'points', delta: points },
    ruleSource('earn-per-euro', key, eventId),
    ENGINE,
    correlation,
    awardEntryKey(key, 0),
    'client',
    label('points.rule', { rule: 'earn-per-euro', points, spendMinor }),
  );
}
const streakUp = (
  seq: number,
  at: string,
  bal: number,
  from: number,
  to: number,
  dueBy: string,
  factKey: string,
): ClientJournalEntry =>
  entry(
    MARTIN,
    seq,
    at,
    bal,
    {
      kind: 'streak',
      streakId: CADENCE,
      op: 'extended',
      from,
      to,
      dueBy: d(dueBy),
    },
    { kind: 'system', job: 'streak' },
    ENGINE,
    factKey,
    ik(`streak:cadence:${factKey}`),
    'client',
    label('streak.changed', { op: 'extended', to }),
  );

// ── Мартин: adjustment ids and award keys used below ─────────────────────────
// Adjustment ids ARE the client-minted request ids (F2); these are readable stand-ins of the same shape.
const ADJ_P0 = adj('adj_0910_pause_noshow');
const ADJ_P = adj('adj_0911_pause_latecancel');
const ADJ_P_EDIT = adj('adj_0912_pause_edit');
const ADJ_B_ID = adj('adj_0915_outcome');
const ADJ_C1_ID = adj('adj_0916_goodwill');
const ADJ_C2_ID = adj('adj_0916_reverse');
const ADJ_D_ID = adj('adj_0918_service');
const T_B = '2026-09-15T07:05:00.000Z';
const EV_B = 'appt_a0910_seat_s1_corrected_r3'; // visit.outcomeCorrected emitted by the correction's own write
const EV_STREAK6 = 'streak_cadence_dev-client-2_6'; // streak.extended emitted by the recompute
const K_TENTH = awardKey(rid('tenth-visit'), MARTIN, 'once');
const K_EVERY10 = awardKey(
  rid('every-10th-visit'),
  MARTIN,
  'client.visits.completed:10',
);
const K_STREAK6 = awardKey(rid('streak-6'), MARTIN, 'once');
const K_EARN_B = awardKey(rid('earn-per-euro'), MARTIN, fact('a0910'));
const RDM = 'rdm_0812_beard_trim' as RedemptionId;
const NOSHOW_TERM: PauseTerm = {
  kind: 'temporary',
  until: t('2026-10-10T21:00:00.000Z'),
}; // through 10 Oct, Sofia
const LATE_TERM_0: PauseTerm = {
  kind: 'temporary',
  until: t('2026-10-12T21:00:00.000Z'),
}; // as applied 11 Sep
const LATE_TERM: PauseTerm = {
  kind: 'temporary',
  until: t('2026-10-04T21:00:00.000Z'),
}; // as edited 12 Sep
const A0910 = aid('a0910');
const NOSHOW_BASIS: readonly AppointmentId[] = ['a0718', 'a0829', 'a0910'].map(
  aid,
);
const LATE_BASIS: readonly AppointmentId[] = ['a0822', 'a0905'].map(aid);

/** Мартин's journal, seq 1–25 (the §9.8 ledger table is rendered from this array). */
export const MARTIN_LEDGER: readonly ClientJournalEntry[] = [
  entry(
    MARTIN,
    1,
    '2026-06-01T06:00:00.000Z',
    150,
    { kind: 'points', delta: 150 },
    { kind: 'migration', batchId: 'loyalty-launch-2026-06' },
    MIGRATION,
    'loyalty-launch-2026-06',
    ik('mig:loyalty-launch-2026-06:dev-client-2'),
    'client',
    label('points.opening', { points: 150, visits: 6 }),
  ),
  earn(
    MARTIN,
    2,
    '2026-06-20T09:40:00.000Z',
    175,
    fact('a0620'),
    'appt_a0620_seat_s1_worked_r1',
    2550,
    25,
  ),
  streakUp(
    3,
    '2026-06-20T09:40:00.000Z',
    175,
    2,
    3,
    '2026-08-01',
    fact('a0620'),
  ),
  earn(
    MARTIN,
    4,
    '2026-07-25T13:10:00.000Z',
    210,
    fact('a0725'),
    'appt_a0725_seat_s1_worked_r1',
    3550,
    35,
  ),
  streakUp(
    5,
    '2026-07-25T13:10:00.000Z',
    210,
    3,
    4,
    '2026-09-05',
    fact('a0725'),
  ),
  entry(
    MARTIN,
    6,
    '2026-07-25T13:10:00.000Z',
    210,
    {
      kind: 'tier',
      op: 'changed',
      from: tid('bronze'),
      to: tid('silver'),
      until: null,
    },
    { kind: 'system', job: 'tier' },
    ENGINE,
    fact('a0725'),
    ik('tier:dev-client-2:silver:2026-07-25'),
    'client',
    label('tier.changed', { to: 'silver' }),
  ),
  entry(
    MARTIN,
    7,
    '2026-08-12T07:30:00.000Z',
    90,
    { kind: 'points', delta: -120 },
    { kind: 'redemption', redemptionId: RDM },
    NIKO_A,
    RDM,
    ik(`rdm:${RDM}#0`),
    'client',
    label('points.redeemed', { reward: 'reward-beard-trim', points: 120 }),
  ),
  entry(
    MARTIN,
    8,
    '2026-08-12T07:30:00.000Z',
    90,
    {
      kind: 'redemption',
      op: 'redeemed',
      redemptionId: RDM,
      rewardId: rwd('reward-beard-trim'),
      cost: 120,
      grant: { kind: 'couponGrant', id: cg('cg_0812_beard') },
    },
    { kind: 'redemption', redemptionId: RDM },
    NIKO_A,
    RDM,
    ik(`rdm:${RDM}#1`),
    'client',
    label('redemption.changed', {
      op: 'redeemed',
      reward: 'reward-beard-trim',
    }),
  ),
  earn(
    MARTIN,
    9,
    '2026-08-12T08:15:00.000Z',
    115,
    fact('a0812'),
    'appt_a0812_seat_s1_worked_r2',
    2550,
    25,
  ),
  streakUp(
    10,
    '2026-08-12T08:15:00.000Z',
    115,
    4,
    5,
    '2026-09-23',
    fact('a0812'),
  ),
  entry(
    MARTIN,
    11,
    '2026-08-12T08:15:00.000Z',
    115,
    {
      kind: 'freeze',
      streakId: CADENCE,
      op: 'earned',
      count: 1,
      bankedAfter: 1,
    },
    { kind: 'system', job: 'streak' },
    ENGINE,
    fact('a0812'),
    ik(`freeze:cadence:${fact('a0812')}`),
    'client',
    label('freeze.changed', { op: 'earned', banked: 1 }),
  ),
  // 10 Sep: Нико stamps a no-show at 16:16; Мартин walks in at 16:20 and Иван cuts him in a free chair. Nobody reopens the stamp.
  // 17:30 the client page shows the B1 suggestion «3 неявявания за 60 дни · Спри онлайн записването?» and Мария confirms it.
  entry(
    MARTIN,
    12,
    '2026-09-10T14:30:00.000Z',
    115,
    {
      kind: 'pause',
      op: 'applied',
      pauseId: pid('pause_0910'),
      term: NOSHOW_TERM,
      scope: 'selfService',
      prior: null,
    },
    { kind: 'manual', adjustmentId: ADJ_P0 },
    MARIA_A,
    ADJ_P0,
    adjustmentEntryKey(ADJ_P0, 0),
    'staff',
    label('pause.changed', { op: 'applied', category: 'no_show_pattern' }),
  ),
  entry(
    MARTIN,
    13,
    '2026-09-11T08:30:00.000Z',
    115,
    {
      kind: 'pause',
      op: 'applied',
      pauseId: pid('pause_0911'),
      term: LATE_TERM_0,
      scope: 'selfService',
      prior: null,
    },
    { kind: 'manual', adjustmentId: ADJ_P },
    MARIA_A,
    ADJ_P,
    adjustmentEntryKey(ADJ_P, 0),
    'staff',
    label('pause.changed', {
      op: 'applied',
      category: 'late_cancellation_pattern',
    }),
  ),
  entry(
    MARTIN,
    14,
    '2026-09-12T10:00:00.000Z',
    115,
    {
      kind: 'pause',
      op: 'edited',
      pauseId: pid('pause_0911'),
      term: LATE_TERM,
      scope: 'selfService',
      prior: { term: LATE_TERM_0, scope: 'selfService' },
    },
    { kind: 'manual', adjustmentId: ADJ_P_EDIT },
    IVAN_A,
    ADJ_P_EDIT,
    adjustmentEntryKey(ADJ_P_EDIT, 0),
    'staff',
    label('pause.changed', { op: 'edited' }),
  ),
  // ── B: the outcome correction and its cascade — one transaction, one correlation ──
  entry(
    MARTIN,
    15,
    T_B,
    115,
    {
      kind: 'visitOutcome',
      appointmentId: A0910,
      seatId: seat('s1'),
      from: 'no_show',
      to: 'worked',
      revision: 3,
    },
    { kind: 'manual', adjustmentId: ADJ_B_ID },
    MARIA_A,
    ADJ_B_ID,
    adjustmentEntryKey(ADJ_B_ID, 0),
    'staff',
    label('visit.outcomeCorrected', { to: 'worked' }),
  ),
  earn(MARTIN, 16, T_B, 141, fact('a0910'), EV_B, 2600, 26, ADJ_B_ID),
  entry(
    MARTIN,
    17,
    T_B,
    141,
    {
      kind: 'streak',
      streakId: CADENCE,
      op: 'recomputed',
      from: 5,
      to: 6,
      dueBy: d('2026-11-15'),
    },
    { kind: 'correction', adjustmentId: ADJ_B_ID },
    MARIA_A,
    ADJ_B_ID,
    adjustmentEntryKey(ADJ_B_ID, 1),
    'client',
    label('streak.changed', { op: 'recomputed', to: 6 }),
  ),
  entry(
    MARTIN,
    18,
    T_B,
    141,
    {
      kind: 'achievement',
      rule: R1('tenth-visit'),
      awardKey: K_TENTH,
      op: 'granted',
    },
    ruleSource('tenth-visit', K_TENTH, EV_B),
    ENGINE,
    ADJ_B_ID,
    awardEntryKey(K_TENTH, 'badge'),
    'client',
    label('achievement.earned', { rule: 'tenth-visit' }),
  ),
  entry(
    MARTIN,
    19,
    T_B,
    141,
    {
      kind: 'reward',
      op: 'granted',
      ref: { kind: 'couponGrant', id: cg('cg_0915_free_cut') },
    },
    ruleSource('every-10th-visit', K_EVERY10, EV_B),
    ENGINE,
    ADJ_B_ID,
    awardEntryKey(K_EVERY10, 0),
    'client',
    label('reward.granted', {
      rule: 'every-10th-visit',
      coupon: 'coupon-free-cut',
    }),
  ),
  entry(
    MARTIN,
    20,
    T_B,
    141,
    {
      kind: 'achievement',
      rule: R1('streak-6'),
      awardKey: K_STREAK6,
      op: 'granted',
    },
    ruleSource('streak-6', K_STREAK6, EV_STREAK6),
    ENGINE,
    ADJ_B_ID,
    awardEntryKey(K_STREAK6, 'badge'),
    'client',
    label('achievement.earned', { rule: 'streak-6' }),
  ),
  entry(
    MARTIN,
    21,
    T_B,
    141,
    {
      kind: 'freeze',
      streakId: CADENCE,
      op: 'granted',
      count: 1,
      bankedAfter: 2,
    },
    ruleSource('streak-6', K_STREAK6, EV_STREAK6),
    ENGINE,
    ADJ_B_ID,
    awardEntryKey(K_STREAK6, 0),
    'client',
    label('freeze.changed', { op: 'granted', banked: 2 }),
  ),
  // the R25 choice «Вдигни» (default: its basis held a0910 and no longer holds), answered by Мария
  entry(
    MARTIN,
    22,
    T_B,
    141,
    {
      kind: 'pause',
      op: 'lifted',
      pauseId: pid('pause_0910'),
      term: NOSHOW_TERM,
      scope: 'selfService',
      prior: { term: NOSHOW_TERM, scope: 'selfService' },
    },
    { kind: 'correction', adjustmentId: ADJ_B_ID },
    MARIA_A,
    ADJ_B_ID,
    adjustmentEntryKey(ADJ_B_ID, 2),
    'staff',
    label('pause.changed', { op: 'lifted', category: 'no_show_pattern' }),
  ),
  // ── C: goodwill +30, then its compensation ──
  entry(
    MARTIN,
    23,
    '2026-09-16T07:05:00.000Z',
    171,
    { kind: 'points', delta: 30 },
    { kind: 'manual', adjustmentId: ADJ_C1_ID },
    MARIA_A,
    ADJ_C1_ID,
    adjustmentEntryKey(ADJ_C1_ID, 0),
    'client',
    label(REASON_PUBLIC_LABEL.goodwill, { points: 30 }),
  ),
  entry(
    MARTIN,
    24,
    '2026-09-16T07:40:00.000Z',
    141,
    { kind: 'points', delta: -30 },
    { kind: 'correction', adjustmentId: ADJ_C2_ID },
    MARIA_A,
    ADJ_C2_ID,
    adjustmentEntryKey(ADJ_C2_ID, 0),
    'client',
    label('points.reversed', { points: 30 }),
    jid('dev-client-2_000023'),
  ),
  // ── D: +120 over the receptionist cap — written only when Иван approved ──
  entry(
    MARTIN,
    25,
    '2026-09-18T09:10:02.000Z',
    261,
    { kind: 'points', delta: 120 },
    { kind: 'manual', adjustmentId: ADJ_D_ID },
    MARIA_A,
    ADJ_D_ID,
    adjustmentEntryKey(ADJ_D_ID, 0),
    'client',
    label(REASON_PUBLIC_LABEL.service_issue, { points: 120 }),
  ),
];
const M = (seq: number): ClientJournalEntry => {
  const e = MARTIN_LEDGER.find((x) => x.seq === seq);
  if (e === undefined) throw new Error(`no entry ${seq}`);
  return e;
};

// ── pure ledger functions ────────────────────────────────────────────────────
/** Spendable balance = Σ points effects (spine §6). */
export const balanceOf = (
  entries: readonly ClientJournalEntry[],
  opening = 0,
): number =>
  entries.reduce(
    (sum, e) => sum + (e.effect.kind === 'points' ? e.effect.delta : 0),
    opening,
  );
/** The LoyaltyAccount totals: a reversal counts in its original's bucket. Manual points are `adjusted`, never `earned` (R40). */
export function totals(entries: readonly ClientJournalEntry[]): {
  readonly earned: number;
  readonly adjusted: number;
  readonly spent: number;
} {
  let earned = 0;
  let adjusted = 0;
  let spent = 0;
  for (const e of entries) {
    if (e.effect.kind !== 'points') continue;
    const origin =
      e.reverses === null ? e : (entries.find((x) => x.id === e.reverses) ?? e);
    if (origin.source.kind === 'redemption') spent -= e.effect.delta;
    else if (origin.source.kind === 'manual') adjusted += e.effect.delta;
    else earned += e.effect.delta;
  }
  return { earned, adjusted, spent };
}
function checkLedger(
  name: string,
  entries: readonly ClientJournalEntry[],
  opening: number,
  firstSeq: number,
): void {
  let running = opening;
  entries.forEach((e, i) => {
    check(`${name}: seq dense at #${e.seq}`, e.seq === firstSeq + i);
    check(
      `${name}: id is uid_seq at #${e.seq}`,
      e.id === `${e.userId}_${String(e.seq).padStart(6, '0')}`,
    );
    if (e.effect.kind === 'points') running += e.effect.delta;
    check(
      `${name}: #${e.seq} balanceAfter ${e.balanceAfter} = running sum ${running}`,
      e.balanceAfter === running,
    );
    check(
      `${name}: #${e.seq} below zero only through a correction (T2)`,
      e.balanceAfter >= 0 || mayOverdraw(e.source),
    );
    check(
      `${name}: #${e.seq} pause/visit entries are staff-only`,
      (e.effect.kind === 'pause' || e.effect.kind === 'visitOutcome') ===
        (e.visibility === 'staff'),
    );
    if (e.reverses !== null) {
      const target = entries.find((x) => x.id === e.reverses);
      check(
        `${name}: #${e.seq} reverses an existing entry`,
        target !== undefined,
      );
      check(
        `${name}: #${e.seq} reverses an EARLIER entry`,
        target !== undefined && target.seq < e.seq,
      );
      check(
        `${name}: #${e.seq} is the exact inverse`,
        target?.effect.kind === 'points' &&
          e.effect.kind === 'points' &&
          target.effect.delta === -e.effect.delta,
      );
      check(
        `${name}: #${e.seq} compensation has source=correction`,
        e.source.kind === 'correction',
      );
      check(
        `${name}: #${e.seq} reverses no reversal`,
        target?.reverses === null,
      );
    }
    if (e.source.kind === 'rule')
      check(
        `${name}: #${e.seq} award key names its rule`,
        e.source.awardKey.startsWith(`${e.source.rule.ruleId}:`),
      );
    if (
      e.source.kind === 'rule' &&
      e.source.rule.ruleId === 'earn-per-euro' &&
      e.effect.kind === 'points'
    ) {
      check(
        `${name}: #${e.seq} earn = floor(spend €)`,
        e.effect.delta ===
          Math.floor(Number(e.publicLabel.params['spendMinor']) / 100),
      );
      check(
        `${name}: #${e.seq} per-visit key is the seat fact (R28)`,
        /:appt:[^:]+:seat:[^:]+$/.test(e.source.awardKey) &&
          !e.source.awardKey.includes('_r'),
      );
    }
  });
  check(
    `${name}: idempotency keys unique`,
    new Set(entries.map((e) => e.idempotencyKey)).size === entries.length,
  );
  const reversed = entries.flatMap((e) =>
    e.reverses === null ? [] : [e.reverses],
  );
  check(
    `${name}: every entry reversed at most once`,
    new Set(reversed).size === reversed.length,
  );
  check(
    `${name}: balanceOf = last balanceAfter`,
    balanceOf(entries, opening) === entries.at(-1)?.balanceAfter,
  );
}

// ── facts behind the ledger (for recompute checks) ───────────────────────────
const DAY = 86_400_000;
const dayNo = (iso: string): number =>
  Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const addDays = (iso: string, n: number): string =>
  new Date((dayNo(iso) + n) * DAY).toISOString().slice(0, 10);
const LEGACY_SPEND = [2400, 2400, 2550, 2550, 2550, 2700]; // six visits before launch → opening 150 т.
const VISIT_DAYS = [
  '2024-03-09',
  '2024-10-12',
  '2025-11-20',
  '2026-01-24',
  '2026-04-18',
  '2026-05-16',
  '2026-06-20',
  '2026-07-25',
  '2026-08-12',
  '2026-09-10',
];
/** A visit fact at the appointment's start (a0910 started 16:00 Sofia). */
const visit = (
  day: string,
  appointmentId = `a${day.slice(5, 7)}${day.slice(8, 10)}`,
): VisitFact => ({
  appointmentId: aid(appointmentId),
  at: t(`${day}T${day === '2026-09-10' ? '13' : '09'}:00:00.000Z`),
});
const NO_SHOWS_BEFORE_B: readonly VisitFact[] = [
  visit('2026-07-18'),
  visit('2026-08-29'),
  visit('2026-09-10'),
];
const LATE_CANCELS: readonly VisitFact[] = [
  visit('2026-08-22'),
  visit('2026-09-05'),
];
/** Trailing run of qualifying visits whose gaps fit cadence + grace. */
const streakRun = (days: readonly string[], def: StreakDefinition): number => {
  const limit =
    (def.cadence.kind === 'rollingDays' ? def.cadence.days : 31) +
    def.graceDays;
  let run = days.length === 0 ? 0 : 1;
  for (let i = days.length - 1; i > 0; i -= 1) {
    const cur = days[i];
    const prev = days[i - 1];
    if (
      cur === undefined ||
      prev === undefined ||
      dayNo(cur) - dayNo(prev) > limit
    )
      break;
    run += 1;
  }
  return run;
};
const tierFor = (
  qualifying: number,
): {
  readonly current: TierDefinition;
  readonly next: TierDefinition | null;
} => {
  const sorted = [...TIERS].sort((a, b) => a.rank - b.rank);
  const reached = sorted.filter((x) => qualifying >= x.qualify.atLeast);
  const current = reached.at(-1) ?? sorted[0];
  if (current === undefined) throw new Error('no tiers');
  return {
    current,
    next: sorted.find((x) => x.rank === current.rank + 1) ?? null,
  };
};

/** clientStats/dev-client-2 after B (v14): per VISIT (R33), bounded instants, no money. */
export const MARTIN_STATS: ClientStats = {
  userId: MARTIN,
  lifetime: {
    visitsCompleted: 10,
    noShows: 2,
    lateCancels: 2,
    clientCancels: 2,
  },
  last365: {
    visitsCompleted: VISIT_DAYS.filter(
      (x) => dayNo('2026-09-15') - dayNo(x) < 365,
    ).map((x) => visit(x)),
    noShows: NO_SHOWS_BEFORE_B.slice(0, 2),
    lateCancels: LATE_CANCELS,
  },
  firstVisitAt: visit('2024-03-09').at,
  lastVisit: {
    appointmentId: A0910,
    at: t('2026-09-10T13:00:00.000Z'),
    legs: [
      {
        serviceId: svc('svc-fade'),
        variantId: null,
        minutes: 30,
        barberId: bid('ivan'),
        label: 'Фейд',
      },
    ],
  },
  nextVisit: null,
  avgCadenceDays: 42,
  preferredBarberId: bid('ivan'),
  usualServiceIds: [svc('svc-fade')],
  pauseSuggestion: null, // 2 no-shows in 60 days < 3, and a pause is active
  version: 14,
  updatedAt: t(T_B),
};
/** clientStats/dev-client-2/restricted/money — admin-only. */
export const MARTIN_MONEY: ClientMoneyStats = {
  userId: MARTIN,
  lifetimeSpendMinor: 26400,
  version: 14,
  updatedAt: t(T_B),
};
export const MARTIN_ACCOUNT: LoyaltyAccount = {
  userId: MARTIN,
  balance: 261,
  lifetimeEarned: 261,
  lifetimeAdjusted: 120,
  lifetimeSpent: 120,
  tier: {
    current: tid('silver'),
    definitionVersion: 1,
    since: t('2026-07-25T13:10:00.000Z'),
    qualifying: 8,
    next: tid('gold'),
    remaining: 4,
    override: null,
  },
  streaks: {
    cadence: {
      streakId: CADENCE,
      definitionVersion: 1,
      phase: { kind: 'frozen', until: d('2026-10-05'), reason: 'pause' },
      current: 6,
      best: 6,
      lastQualifiedAt: t('2026-09-10T13:00:00.000Z'),
      dueBy: d('2026-11-15'),
      freezesBanked: 2,
    },
  },
  // client-card-redesign §4.1: no badge summary — his medals are family progress documents beside the account
  punchCards: [
    {
      ruleId: rid('every-10th-visit'),
      filled: 0,
      size: 10,
      title: txt('Безплатно подстригване', 'Free haircut'),
    },
  ],
  records: [
    {
      kind: 'longestRhythm',
      value: 6,
      on: d('2026-09-10'),
      year: null,
      serviceId: null,
    },
    {
      kind: 'favouriteService',
      value: 10,
      on: null,
      year: null,
      serviceId: svc('svc-fade'),
    },
    {
      kind: 'firstVisit',
      value: 1,
      on: d('2024-03-09'),
      year: null,
      serviceId: null,
    },
  ],
  pointsExpiry: null, // R30: expiry is off at launch («Точките не изтичат»)
  seq: 25,
  version: 25,
  updatedAt: t('2026-09-18T09:10:02.000Z'),
};

// ── pauses (B1, R25: both are a person's decision; neither is automatic) ─────
/** 10 Sep 17:30 — Мария confirms the threshold's suggestion; the basis is the three no-show visits. */
export const PAUSE_NOSHOW: ClientPause = {
  id: pid('pause_0910'),
  userId: MARTIN,
  scope: 'selfService',
  term: NOSHOW_TERM,
  reason: { category: 'no_show_pattern', clientVisible: true },
  adjustmentId: ADJ_P0,
  basis: NOSHOW_BASIS,
  fromSuggestion: true,
  reviewOn: d('2026-10-11'),
  appliedBy: MARIA_A,
  appliedAt: t('2026-09-10T14:30:00.000Z'),
  state: 'lifted',
  history: [
    {
      op: 'applied',
      at: t('2026-09-10T14:30:00.000Z'),
      by: MARIA_A,
      adjustmentId: ADJ_P0,
      journalEntryId: M(12).id,
      change: null,
    },
    {
      op: 'lifted',
      at: t(T_B),
      by: MARIA_A,
      adjustmentId: ADJ_B_ID,
      journalEntryId: M(22).id,
      change: null,
    },
  ],
  version: 2,
};
/** 11 Sep — a separate ground (two late cancellations), applied without a suggestion; Иван shortens it on 12 Sep. */
export const PAUSE_LATE: ClientPause = {
  id: pid('pause_0911'),
  userId: MARTIN,
  scope: 'selfService',
  term: LATE_TERM,
  reason: { category: 'late_cancellation_pattern', clientVisible: true }, // no free text on the record (R56)
  adjustmentId: ADJ_P,
  basis: LATE_BASIS,
  fromSuggestion: false,
  reviewOn: d('2026-10-05'),
  appliedBy: MARIA_A,
  appliedAt: t('2026-09-11T08:30:00.000Z'),
  state: 'active',
  history: [
    {
      op: 'applied',
      at: t('2026-09-11T08:30:00.000Z'),
      by: MARIA_A,
      adjustmentId: ADJ_P,
      journalEntryId: M(13).id,
      change: null,
    },
    {
      op: 'edited',
      at: t('2026-09-12T10:00:00.000Z'),
      by: IVAN_A,
      adjustmentId: ADJ_P_EDIT,
      journalEntryId: M(14).id,
      change: { term: LATE_TERM, reviewOn: d('2026-10-05') },
    },
  ],
  version: 2,
};
/** clientPauses/pause_0911/private/note (R56) — Мария's «Бележка на екипа», written by the pause.apply commit;
 *  receptionist and admin read it, sysadmin and barbers never. PAUSE_NOSHOW has none, so its sub-document is absent. */
export const PAUSE_LATE_NOTE: ClientPauseNote = {
  text: 'Два късни отказа за три седмици; обадих се, клиентът е наясно.',
  authorUid: MARIA,
  writtenAt: t('2026-09-11T08:30:00.000Z'),
};
/** The pause.apply behind PAUSE_NOSHOW: 30 days ≤ maxTemporaryPauseDays, so a receptionist commits it alone. */
export const ADJ_P0_REC: Adjustment = {
  id: ADJ_P0,
  subjectUserId: MARTIN,
  input: {
    kind: 'pause.apply',
    scope: 'selfService',
    term: NOSHOW_TERM,
    category: 'no_show_pattern',
    clientVisible: true,
    basis: NOSHOW_BASIS,
    reviewOn: d('2026-10-11'),
    fromSuggestion: true,
  },
  reason: { code: 'policy_enforcement' },
  notifyClient: notifyByDefault('policy_enforcement'),
  actor: MARIA_A,
  requestedAt: t('2026-09-10T14:29:40.000Z'),
  previewDigest: 'sha256:3f10…a9d2',
  stateVersion: sv('acct:v11|stats:v13|pause:v0'),
  choices: [],
  approval: { kind: 'notRequired' },
  anomalies: [],
  committedAt: t('2026-09-10T14:30:00.000Z'),
  resultingEntryIds: [M(12).id],
  reverses: null,
  reversedBy: null,
};

// ── B: wrongly marked no-show, corrected with cascade ────────────────────────
const lineOf = (
  e: ClientJournalEntry,
  before: string | number | boolean | null,
  after: string | number | boolean | null,
): PreviewLine => ({ label: e.publicLabel, before, after, effect: e.effect });
/** Σ pause-doc versions — the `pause:` component of a StateVersion. */
const pauseVersion = (pauses: readonly ClientPause[]): string =>
  `pause:v${pauses.reduce((s, p) => s + p.version, 0)}`;
const PAUSES_BEFORE_B: readonly ClientPause[] = [
  {
    ...PAUSE_NOSHOW,
    state: 'active',
    history: PAUSE_NOSHOW.history.slice(0, 1),
    version: 1,
  },
  PAUSE_LATE,
];
export const PREVIEW_B: CascadePreview = {
  direct: [lineOf(M(15), 'no_show', 'worked')],
  derived: [
    lineOf(M(17), 5, 6),
    {
      label: label('preview.stat', { stat: 'visitsCompleted' }),
      before: 9,
      after: 10,
      effect: null,
    },
    {
      label: label('preview.stat', { stat: 'noShows90d' }),
      before: 3,
      after: 2,
      effect: null,
    },
    {
      label: label('preview.stat', {
        stat: 'tierQualifying',
        tier: 'silver',
        next: 'gold',
      }),
      before: 7,
      after: 8,
      effect: null,
    },
  ],
  ruleEffects: [
    lineOf(M(16), 115, 141),
    lineOf(M(18), false, true),
    lineOf(M(19), null, 'coupon-free-cut'),
    lineOf(M(20), false, true),
    lineOf(M(21), 1, 2),
  ],
  choices: [
    {
      // R25: its basis held a0910; 2 no-shows remain < 3 → default «Вдигни»
      id: chid('pause-0910'),
      label: label('choice.manualPause', {
        pause: 'pause_0910',
        category: 'no_show_pattern',
        basisHolds: 'no',
      }),
      subject: { kind: 'pause', pauseId: PAUSE_NOSHOW.id },
      options: ['keep', 'lift'],
      defaultOption: 'lift',
      lines: [lineOf(M(22), 'active', 'lifted')],
    },
    {
      // a different ground → default «Запази»
      id: chid('pause-0911'),
      label: label('choice.manualPause', {
        pause: 'pause_0911',
        category: 'late_cancellation_pattern',
        basisHolds: 'yes',
      }),
      subject: { kind: 'pause', pauseId: PAUSE_LATE.id },
      options: ['keep', 'lift'],
      defaultOption: 'keep',
      lines: [
        {
          label: label('pause.changed', {
            op: 'lifted',
            category: 'late_cancellation_pattern',
          }),
          before: 'active',
          after: 'lifted',
          effect: {
            kind: 'pause',
            op: 'lifted',
            pauseId: PAUSE_LATE.id,
            term: LATE_TERM,
            scope: 'selfService',
            prior: { term: LATE_TERM, scope: 'selfService' },
          },
        },
      ],
    },
  ],
  warnings: [{ code: 'subjectPaused', params: { until: '2026-10-11' } }],
  approval: { kind: 'notRequired' },
  balance: { before: 115, after: 141 },
  stateVersion: sv(
    `acct:v14|stats:v13|${pauseVersion(PAUSES_BEFORE_B)}|appt:r2`,
  ),
  confirmation: 'alert',
};
export const ADJ_B: Adjustment = {
  id: ADJ_B_ID,
  subjectUserId: MARTIN,
  input: {
    kind: 'visit.outcome',
    appointmentId: A0910,
    seatId: seat('s1'),
    from: 'no_show',
    to: { kind: 'worked' },
  },
  reason: {
    code: 'staff_error',
    note: 'Дойде в 16:20, подстрига го Иван; неявяването е отбелязано по грешка.',
  },
  notifyClient: notifyByDefault('staff_error'),
  actor: MARIA_A,
  requestedAt: t('2026-09-15T07:04:10.000Z'),
  previewDigest: 'sha256:9d41…b07e',
  stateVersion: PREVIEW_B.stateVersion,
  choices: [
    { choiceId: chid('pause-0910'), option: 'lift' },
    { choiceId: chid('pause-0911'), option: 'keep' },
  ],
  approval: { kind: 'notRequired' },
  anomalies: [],
  committedAt: t(T_B),
  resultingEntryIds: [15, 16, 17, 18, 19, 20, 21, 22].map((s) => M(s).id),
  reverses: null,
  reversedBy: null,
};
/** An allBookings pause preview's choice (R49): nothing is cancelled silently; «Остави часа» is the default. */
export const BOOKING_CHOICE: Choice = {
  id: chid('booking-a1022'),
  label: label('choice.upcomingBooking', { on: '2026-10-22' }),
  subject: { kind: 'booking', appointmentId: aid('a1022'), seatId: seat('s1') },
  options: ['keep', 'cancel'],
  defaultOption: 'keep',
  lines: [],
};

// ── C: goodwill +30, reversed by compensation ────────────────────────────────
export const ADJ_C1: Adjustment = {
  id: ADJ_C1_ID,
  subjectUserId: MARTIN,
  input: { kind: 'points.credit', points: 30 },
  reason: { code: 'goodwill', note: 'Чака 30 мин заради закъснение на Нико.' },
  notifyClient: notifyByDefault('goodwill'),
  actor: MARIA_A,
  requestedAt: t('2026-09-16T07:04:50.000Z'),
  previewDigest: 'sha256:51aa…03c2',
  stateVersion: sv('acct:v22|stats:v14|pause:v4'),
  choices: [],
  approval: { kind: 'notRequired' },
  anomalies: ['repeat_subject'], // 4th act by Мария on Мартин in 30 days
  committedAt: t('2026-09-16T07:05:00.000Z'),
  resultingEntryIds: [M(23).id],
  reverses: null,
  reversedBy: ADJ_C2_ID,
};
export const ADJ_C2: Adjustment = {
  id: ADJ_C2_ID,
  subjectUserId: MARTIN,
  input: {
    kind: 'adjustment.reverse',
    original: { id: ADJ_C1.id, kind: ADJ_C1.input },
  },
  reason: {
    code: 'staff_error',
    note: 'Жестът вече беше даден като отстъпка на сметката — двойно.',
  },
  notifyClient: notifyByDefault('staff_error'),
  actor: MARIA_A,
  requestedAt: t('2026-09-16T07:39:40.000Z'),
  previewDigest: 'sha256:c0de…77f1',
  stateVersion: sv('acct:v23|stats:v14|pause:v4'),
  choices: [],
  approval: { kind: 'notRequired' },
  anomalies: ['repeat_subject'],
  committedAt: t('2026-09-16T07:40:00.000Z'),
  resultingEntryIds: [M(24).id],
  reverses: ADJ_C1.id,
  reversedBy: null,
};
/** heldNotifications/adj_0916_goodwill (T1): released at +10 min, before the undo, so the reversal sends one neutral follow-up (R31). */
export const HELD_C1: HeldNotification = {
  userId: MARTIN,
  kind: 'loyalty_corrected',
  payload: M(23).publicLabel,
  releaseAt: t('2026-09-16T07:15:00.000Z'),
  state: 'released',
  purgeAt: { seconds: Date.UTC(2026, 8, 23, 7, 15) / 1000, nanoseconds: 0 },
};
/** An Adjustment's audit row: written INSIDE the commit transaction (F1), Actor from actorForCaller, targetUserId = the CLIENT. */
const auditOf = (
  a: Adjustment,
  context: Readonly<Record<string, string>>,
): AuditRow => ({
  actor: a.actor,
  action: auditActionOf(a.input.kind),
  at: a.committedAt ?? a.requestedAt,
  targetUserId: a.subjectUserId,
  resourceId: `adjustments/${a.id}`,
  context: {
    ...context,
    reason: a.reason.code,
    entries: a.resultingEntryIds.join(','),
  },
});
export const AUDIT_C: readonly AuditRow[] = [
  auditOf(ADJ_C1, {
    points: '+30',
    anomalies: 'repeat_subject',
    notifyClient: 'true',
  }),
  auditOf(ADJ_C2, { points: '-30', reverses: ADJ_C1.id }),
];
export const AUDIT_B: AuditRow = auditOf(ADJ_B, {
  appointment: 'a0910/s1',
  from: 'no_show',
  to: 'worked',
  choices: ADJ_B.choices.map((c) => `${c.choiceId}=${c.option}`).join(','),
});

/** supportActors/dev-staff-maria as each request's transaction read it (rule payouts are not manual points). */
const usageRow = (
  a: Adjustment,
  points: number,
  compensatesOwn = false,
): SupportActorUsage['recent'][number] => ({
  adjustmentId: a.id,
  at: a.committedAt ?? a.requestedAt,
  subjectUserId: a.subjectUserId,
  kind: a.input.kind,
  points,
  compensatesOwn,
});
const ADJ_P_REC_ROW = {
  adjustmentId: ADJ_P,
  at: t('2026-09-11T08:30:00.000Z'),
  subjectUserId: MARTIN,
  kind: 'pause.apply',
  points: 0,
  compensatesOwn: false,
} as const;
export const MARIA_USAGE_0916: SupportActorUsage = {
  userId: MARIA,
  version: 3,
  recent: [usageRow(ADJ_P0_REC, 0), ADJ_P_REC_ROW, usageRow(ADJ_B, 0)],
};
export const MARIA_USAGE_0918: SupportActorUsage = {
  userId: MARIA,
  version: 5,
  recent: [
    ...MARIA_USAGE_0916.recent,
    usageRow(ADJ_C1, 30),
    usageRow(ADJ_C2, 30, true),
  ],
};
/** Non-admin manual points on Мартин, as the D transaction reads them from `adjustments` (an undo of one's own act excluded). */
const MARTIN_MANUAL_30D = [
  { at: t('2026-09-16T07:05:00.000Z'), points: 30, byAdmin: false },
];

// ── D: +120 by a receptionist → approval → commit ────────────────────────────
export const PREVIEW_D: CascadePreview = {
  direct: [lineOf(M(25), 141, 261)],
  derived: [
    {
      label: label('preview.stat', {
        stat: 'rewardAffordable',
        reward: 'reward-free-cut',
      }),
      before: false,
      after: true,
      effect: null,
    },
  ],
  ruleEffects: [],
  choices: [],
  warnings: [],
  approval: { kind: 'required', reason: 'overLimit' },
  balance: { before: 141, after: 261 },
  stateVersion: sv('acct:v24|stats:v14|pause:v4'),
  confirmation: 'receipt',
};
export const ADJ_D_PENDING: Adjustment = {
  id: ADJ_D_ID,
  subjectUserId: MARTIN,
  input: { kind: 'points.credit', points: 120 },
  reason: {
    code: 'service_issue',
    note: 'Неуспешно оформяне на брадата на 17.09; клиентът беше недоволен.',
  },
  notifyClient: notifyByDefault('service_issue'),
  actor: MARIA_A,
  requestedAt: t('2026-09-18T08:00:00.000Z'),
  previewDigest: 'sha256:e2b9…41d0',
  stateVersion: PREVIEW_D.stateVersion,
  choices: [],
  approval: {
    kind: 'pending',
    reason: 'overLimit',
    requestedAt: t('2026-09-18T08:00:00.000Z'),
    expiresAt: t('2026-09-25T08:00:00.000Z'),
  },
  anomalies: ['repeat_subject'],
  committedAt: null,
  resultingEntryIds: [],
  reverses: null,
  reversedBy: null,
};
/** clientProfiles/dev-client-2 while D is pending: the barber-readable pause summary and pending row (no requester). */
export const MARTIN_PROFILE_0918: ClientProfile = {
  userId: MARTIN,
  tags: [],
  flags: { staffRelated: false },
  preferences: { preferredBarberId: bid('ivan') },
  pauseSummary: pauseSummaryOf(
    [PAUSE_NOSHOW, PAUSE_LATE],
    t('2026-09-18T08:00:00.000Z'),
  ),
  pauseSuggestionDismissedAt: t(T_B), // the lift in B stamps it (R49)
  pendingAdjustments: [
    {
      adjustmentId: ADJ_D_ID,
      kind: 'points.credit',
      points: 120,
      requestedAt: t('2026-09-18T08:00:00.000Z'),
      expiresAt: t('2026-09-25T08:00:00.000Z'),
    },
  ],
  mergedInto: null,
  version: 6,
  updatedAt: t('2026-09-18T08:00:00.000Z'),
  updatedBy: MARIA_A,
};
export const APPROVAL_D: ApprovalRequest = {
  adjustmentId: ADJ_D_ID,
  input: ADJ_D_PENDING.input,
  reason: ADJ_D_PENDING.reason,
  subject: { userId: MARTIN, displayName: 'Мартин Илиев' },
  requester: { userId: MARIA, displayName: 'Мария', roles: rolesOf(MARIA) },
  state: ADJ_D_PENDING.approval,
  preview: PREVIEW_D,
  anomalies: ADJ_D_PENDING.anomalies,
  viewerMayDecide:
    decide(rolesOf(IVAN), 'approvals.decide', {
      actorUid: IVAN,
      requesterUid: MARIA,
      subject: { uid: MARTIN, staffRelated: false },
    }).kind === 'allowed' &&
    decisionProblem(ADJ_D_PENDING, IVAN, t('2026-09-18T09:09:00.000Z')) ===
      null,
};
export const ADJ_D: Adjustment = {
  ...ADJ_D_PENDING,
  approval: {
    kind: 'approved',
    reason: 'overLimit',
    requestedAt: t('2026-09-18T08:00:00.000Z'),
    decidedBy: IVAN_A,
    decidedAt: t('2026-09-18T09:10:00.000Z'),
  },
  committedAt: t('2026-09-18T09:10:02.000Z'),
  resultingEntryIds: [M(25).id],
};
export const AUDIT_D: readonly AuditRow[] = [
  {
    actor: MARIA_A,
    action: 'support.approval_requested',
    at: ADJ_D_PENDING.requestedAt,
    targetUserId: MARTIN,
    resourceId: `adjustments/${ADJ_D_ID}`,
    context: {
      kind: 'points.credit',
      points: '+120',
      reason: 'service_issue',
      approval: 'overLimit',
      expiresAt: '2026-09-25T08:00:00.000Z',
    },
  },
  {
    actor: IVAN_A,
    action: 'support.approval_approved',
    at: t('2026-09-18T09:10:00.000Z'),
    targetUserId: MARTIN,
    resourceId: `adjustments/${ADJ_D_ID}`,
    context: { previewReRun: 'acct:v24|stats:v14|pause:v4', requester: MARIA },
  },
  auditOf(ADJ_D, { points: '+120', approvedBy: IVAN }),
];

// ── Дейност (P9): the unified adjustment/audit event, as listClientActivity assembles it ──
/** One adjustment's row: source, before → after and entry links from its journal entries; reason, approval and
 *  anomalies from the adjustment. `withNotes` is false for a sysadmin viewer (R15). */
function activityOf(a: Adjustment, withNotes: boolean): ClientActivityEntry {
  const rows = MARTIN_LEDGER.filter((e) => a.resultingEntryIds.includes(e.id));
  const first = rows[0];
  const publicLabel = first?.publicLabel.code ?? null;
  return {
    id: a.id,
    at: a.committedAt ?? a.requestedAt,
    correlationId: first?.correlationId ?? corr(a.id),
    kind: a.input.kind,
    source: first?.source ?? { kind: 'manual', adjustmentId: a.id },
    actor: a.actor,
    reason:
      withNotes && a.reason.note !== undefined
        ? { code: a.reason.code, publicLabel, note: a.reason.note }
        : { code: a.reason.code, publicLabel },
    changes: rows.flatMap((e) =>
      e.effect.kind === 'points'
        ? [
            {
              quantity: 'points' as const,
              before: e.balanceAfter - e.effect.delta,
              after: e.balanceAfter,
            },
          ]
        : [],
    ),
    fields: [],
    reverses: a.reverses,
    reversedBy: a.reversedBy,
    approval: a.approval,
    anomalies: a.anomalies,
    visibility: first?.visibility ?? 'staff',
    adjustmentId: a.id,
    journalEntryIds: rows.map((e) => e.id),
  };
}
/** Мария's Дейност on Мартин for C and D, newest first. */
export const ACTIVITY_CD: readonly ClientActivityEntry[] = [
  activityOf(ADJ_D, true),
  activityOf(ADJ_C2, true),
  activityOf(ADJ_C1, true),
];

// ── A: missed award (system fault) → explainer → replayRule (Петър) ─────────
export const EVENT_A: Trigger = {
  id: evid('appt_a0905p_seat_s1_worked_r2'),
  userId: PETAR,
  factKey: fact('a0905p'),
  at: t('2026-09-05T10:30:00.000Z'),
  localDate: d('2026-09-05'),
  event: {
    kind: 'visit.completed',
    appointmentId: aid('a0905p'),
    seatId: seat('s1'),
    outcomeFrom: 'scheduled',
    outcomeTo: 'worked',
    spendMinor: 2200,
    serviceIds: [svc('svc-classic-cut')],
  },
  replayOf: null,
  processedAt: null,
  outcome: null,
  attempts: 3,
  lastError:
    'DEADLINE_EXCEEDED: engine transaction aborted 3× during the 5 Sep deploy',
  purgeAt: { seconds: Date.UTC(2026, 11, 4, 10, 30) / 1000, nanoseconds: 0 },
};
const K_A_EVERY10 = awardKey(
  rid('every-10th-visit'),
  PETAR,
  'client.visits.completed:20',
);
const K_A_EARN = awardKey(rid('earn-per-euro'), PETAR, EVENT_A.factKey);
export const EXPLAIN_A: RuleExplanation = {
  rule: R1('every-10th-visit'),
  userId: PETAR,
  evaluatedAt: t('2026-09-12T08:58:00.000Z'),
  asOfEventId: EVENT_A.id,
  met: true,
  trace: [
    { path: 'allOf', kind: 'allOf', met: true, actual: null, required: null },
    {
      path: 'allOf[0]',
      kind: 'event',
      met: true,
      actual: 'worked',
      required: 'worked',
    },
    {
      path: 'allOf[1]',
      kind: 'everyNth',
      met: true,
      actual: 20,
      required: 'кратно на 10',
    },
  ],
  awardKey: K_A_EVERY10,
  issued: false,
  offer: 'replay',
};
const REPLAY_REQ = 'rq_0912_replay_a0905p' as RequestId;
/** replayRule (R45): a replay inbox doc with a deterministic id, carrying the ORIGINAL arm, fact key and date. */
export const REPLAY_A: Trigger = {
  ...EVENT_A,
  id: evid(`replay_${REPLAY_REQ}`),
  replayOf: {
    eventId: EVENT_A.id,
    requestId: REPLAY_REQ,
    by: MARIA_A,
    reason: 'system_fault',
  },
  processedAt: t('2026-09-12T09:00:03.000Z'),
  outcome: 'applied',
  attempts: 1,
  lastError: null,
  purgeAt: { seconds: Date.UTC(2026, 11, 11, 9, 0, 3) / 1000, nanoseconds: 0 },
};
/** Петър's journal from seq 41 (balance after seq 40 = 310). Both entries cite the ORIGINAL event; the replay is the delivery. */
export const PETAR_LEDGER_TAIL: readonly ClientJournalEntry[] = [
  earn(
    PETAR,
    41,
    '2026-09-12T09:00:03.000Z',
    332,
    EVENT_A.factKey,
    EVENT_A.id,
    2200,
    22,
    REPLAY_REQ,
  ),
  entry(
    PETAR,
    42,
    '2026-09-12T09:00:03.000Z',
    332,
    {
      kind: 'reward',
      op: 'granted',
      ref: { kind: 'couponGrant', id: cg('cg_0912_p20') },
    },
    ruleSource('every-10th-visit', K_A_EVERY10, EVENT_A.id),
    ENGINE,
    REPLAY_REQ,
    awardEntryKey(K_A_EVERY10, 0),
    'client',
    label('reward.granted', {
      rule: 'every-10th-visit',
      coupon: 'coupon-free-cut',
    }),
  ),
];
/** auditLog/rq_0912_replay_a0905p — in the replay's transaction (F1). */
export const AUDIT_A: AuditRow = {
  actor: MARIA_A,
  action: 'support.rule_replay',
  at: t('2026-09-12T09:00:03.000Z'),
  targetUserId: PETAR,
  resourceId: `loyaltyEvents/${REPLAY_A.id}`,
  context: {
    eventId: EVENT_A.id,
    reason: 'system_fault',
    entries: PETAR_LEDGER_TAIL.map((e) => e.id).join(','),
  },
};
/** Toy engine step (P2): READ each met rule's award doc first; present → a no-op, absent → create(). create() is
 *  never the dedupe path — its ALREADY_EXISTS would abort the whole commit, processedAt and journal included. */
function replay(
  event: Trigger,
  met: readonly { readonly ruleId: string; readonly nth: number | null }[],
  awards: Set<AwardKey>,
): readonly AwardKey[] {
  const created: AwardKey[] = [];
  for (const m of met) {
    const r = ruleById(m.ruleId);
    if (
      !r.body.triggers.includes(event.event.kind) &&
      !r.body.triggers.includes('rule.replay')
    )
      continue;
    const occ = occurrenceKey(r.body.recurrence, {
      trigger: event,
      nth:
        m.nth === null
          ? null
          : { metric: 'client.visits.completed', multiple: m.nth },
    });
    if (!occ.ok) continue;
    const key = awardKey(
      r.ruleId,
      r.body.scope === 'shop' ? 'shop' : event.userId,
      occ.value,
    );
    if (awards.has(key)) continue; // tx.get(awards/{key}).exists → the duplicate branch, nothing written
    awards.add(key);
    created.push(key);
  }
  return created;
}

// ── an owed balance (T2, R27): a visit's points reversed after the reward they paid for was spent; cleared at a lapse
//    (expiry is off at launch, R30 — this row appears only once the owner enables it) ──
const KIRIL = uid('dev-client-5');
const ADJ_O = adj('adj_1003_outcome_wrong_client');
export const OWED_LEDGER: readonly ClientJournalEntry[] = [
  entry(
    KIRIL,
    7,
    '2026-10-01T10:00:00.000Z',
    250,
    { kind: 'points', delta: 25 },
    ruleSource(
      'earn-per-euro',
      awardKey(rid('earn-per-euro'), KIRIL, fact('a1001k')),
      'appt_a1001k_seat_s1_worked_r1',
    ),
    ENGINE,
    fact('a1001k'),
    awardEntryKey(awardKey(rid('earn-per-euro'), KIRIL, fact('a1001k')), 0),
    'client',
    label('points.rule', {
      rule: 'earn-per-euro',
      points: 25,
      spendMinor: 2500,
    }),
  ),
  entry(
    KIRIL,
    8,
    '2026-10-02T09:00:00.000Z',
    0,
    { kind: 'points', delta: -250 },
    { kind: 'redemption', redemptionId: 'rdm_1002_free_cut_k' as RedemptionId },
    NIKO_A,
    'rdm_1002_free_cut_k',
    ik('rdm:rdm_1002_free_cut_k#0'),
    'client',
    label('points.redeemed', { reward: 'reward-free-cut', points: 250 }),
  ),
  entry(
    KIRIL,
    9,
    '2026-10-03T08:00:00.000Z',
    -25,
    { kind: 'points', delta: -25 },
    { kind: 'correction', adjustmentId: ADJ_O },
    MARIA_A,
    ADJ_O,
    adjustmentEntryKey(ADJ_O, 1),
    'client',
    label('points.reversed', { points: 25 }),
    jid('dev-client-5_000007'),
  ),
  entry(
    KIRIL,
    10,
    '2027-10-02T01:00:00.000Z',
    0,
    { kind: 'points', delta: 25 },
    { kind: 'system', job: 'pointsExpiry' },
    { kind: 'system', source: 'points_expiry' },
    'lapse:dev-client-5:2027-10-02',
    ik('lapse:dev-client-5:2027-10-02'),
    'client',
    label('points.debtCleared', { points: 25 }),
  ),
];

// ── run the checks ───────────────────────────────────────────────────────────
export function runChecks(): number {
  // definitions
  for (const r of RULES)
    check(`rule ${r.ruleId} validates`, validateRuleBody(r.body).length === 0);
  check('≥ 8 rules', RULES.length >= 8);
  check(
    'perOccurrence without everyNth is refused',
    validateRuleBody({
      ...ruleById('tenth-visit').body,
      recurrence: { kind: 'perOccurrence' },
    }).includes('perOccurrenceNeedsEveryNth'),
  );
  check(
    'B3: a shop-wide rule is never a badge',
    validateRuleBody({
      ...ruleById('shop-100th-booking').body,
      badge: badge('visits', 'Юбилеен час', 'Milestone booking', '—', '—', 9),
    }).includes('shopRuleIsBadge'),
  );
  check(
    'an everyNth over a windowed count is refused (its multiples repeat)',
    validateRuleBody({
      ...ruleById('every-10th-visit').body,
      condition: {
        kind: 'everyNth',
        metric: {
          metric: 'client.visits.completed',
          window: { lastDays: 365 },
        },
        n: 10,
      },
    }).includes('windowedEveryNth') &&
      validateRuleBody({
        ...ruleById('every-10th-visit').body,
        condition: {
          kind: 'within',
          days: 365,
          condition: { kind: 'everyNth', metric: VISITS, n: 10 },
        },
      }).includes('windowedEveryNth'),
  );
  check(
    'no rule carries a hidden badge (B3): every badge states its requirement',
    RULES.every(
      (r) => r.body.badge === null || r.body.badge.requirement.bg.length > 0,
    ),
  );
  check(
    'P4: a badge rule recurs once; a recurring payout that wants a medal pairs with its own once-rule',
    RULES.every(
      (r) => r.body.badge === null || r.body.recurrence.kind === 'once',
    ) &&
      validateRuleBody({
        ...ruleById('referral-inviter-3-visits').body,
        badge: ruleById('referral-inviter-badge').body.badge,
      }).includes('badgeNeedsOnce'),
  );
  // The rules' own emblems; the §4 catalogue's families and seasons draw the rest (client-card-redesign.md §4.6).
  type RuleEmblem = Extract<
    BadgeEmblem,
    'visits' | 'streak' | 'referral' | 'selfService' | 'birthday' | 'welcome'
  >;
  const EMBLEMS: Readonly<Record<RuleEmblem, true>> = {
    visits: true,
    streak: true,
    referral: true,
    selfService: true,
    birthday: true,
    welcome: true,
  };
  check(
    '§10: every rule emblem renders (some rule carries each; a key exists only for a slot that renders it)',
    Object.keys(EMBLEMS).every((e) =>
      RULES.some((r) => r.body.badge?.emblem === e),
    ),
  );
  check(
    "the brief's referral achievements are medals: the referee at registration, the inviter once, when a friend visits 3 times",
    ruleById('referral-referee-welcome').body.badge?.emblem === 'referral' &&
      ruleById('referral-inviter-badge').body.badge?.emblem === 'referral' &&
      ruleById('referral-inviter-badge').body.recurrence.kind === 'once' &&
      ruleById('referral-inviter-3-visits').body.recurrence.kind ===
        'perReferee',
  );
  check(
    'R29: every version and definition carries effectiveFrom',
    RULES.every((r) => r.effectiveFrom >= r.publishedAt) &&
      CADENCE_STREAK.version === 1 &&
      TIERS.every((x) => x.version === 1),
  );
  check(
    'tiers ranked 0..3 with 0/6/12/20',
    TIERS.map((x) => x.qualify.atLeast).join() === '0,6,12,20',
  );
  check('catalogue 120 / 250', CATALOG.map((x) => x.cost).join() === '120,250');

  // idempotency helpers
  const cal: Pick<Trigger, 'factKey' | 'localDate' | 'event'> = {
    factKey: 'cal:2026-10-03:dev-client-2',
    localDate: d('2026-10-03'),
    event: { kind: 'calendar.daily' },
  };
  const occ = (r: RuleBody['recurrence'], nth: number | null, trigger = cal) =>
    occurrenceKey(r, {
      trigger,
      nth:
        nth === null
          ? null
          : { metric: 'client.visits.completed', multiple: nth },
    });
  check(
    'once → once',
    JSON.stringify(occ({ kind: 'once' }, null)) ===
      '{"ok":true,"value":"once"}',
  );
  check(
    'perPeriod year → 2026',
    JSON.stringify(occ({ kind: 'perPeriod', period: 'year' }, null)) ===
      '{"ok":true,"value":"2026"}',
  );
  check(
    'perPeriod month → 2026-10',
    JSON.stringify(occ({ kind: 'perPeriod', period: 'month' }, null)) ===
      '{"ok":true,"value":"2026-10"}',
  );
  check(
    'perOccurrence → metric:multiple',
    JSON.stringify(occ({ kind: 'perOccurrence' }, 20)) ===
      '{"ok":true,"value":"client.visits.completed:20"}',
  );
  check(
    'perOccurrence without nth fails',
    JSON.stringify(occ({ kind: 'perOccurrence' }, null)) ===
      '{"ok":false,"error":"needsEveryNth"}',
  );
  check(
    'perReferee on a non-referral event fails',
    JSON.stringify(occ({ kind: 'perReferee' }, null)) ===
      '{"ok":false,"error":"needsReferee"}',
  );
  check(
    'perReferee → referee uid',
    JSON.stringify(
      occ({ kind: 'perReferee' }, null, {
        ...cal,
        event: {
          kind: 'referral.redeemed',
          inviterUserId: MARTIN,
          refereeUserId: uid('dev-client-9'),
        },
      }),
    ) === '{"ok":true,"value":"dev-client-9"}',
  );
  check(
    'R28: perEvent keys on the seat fact, not the revisioned event id',
    JSON.stringify(
      occurrenceKey({ kind: 'perEvent' }, { trigger: EVENT_A, nth: null }),
    ) === '{"ok":true,"value":"appt:a0905p:seat:s1"}',
  );
  check(
    "R28: award doc id has no prefix; a missed_award credit writes the rule's own key",
    K_A_EARN === 'earn-per-euro:dev-client-3:appt:a0905p:seat:s1' &&
      awardKey(
        rid('earn-per-euro'),
        PETAR,
        seatFactKey(aid('a0905p'), seat('s1')),
      ) === K_A_EARN,
  );
  check(
    'shop-scope key has one winner',
    awardKey(rid('shop-100th-booking'), 'shop', 'shop.bookings.created:300') ===
      'shop-100th-booking:shop:shop.bookings.created:300',
  );
  check(
    'entry keys namespace award and adjustment ids',
    awardEntryKey(K_TENTH, 'badge') ===
      'award:tenth-visit:dev-client-2:once#badge' &&
      adjustmentEntryKey(ADJ_C1_ID, 0) === 'adj:adj_0916_goodwill#0',
  );

  // Мартин's ledger + projections
  checkLedger('Мартин', MARTIN_LEDGER, 0, 1);
  const tot = totals(MARTIN_LEDGER);
  check(
    'account balance = Σ points',
    MARTIN_ACCOUNT.balance === balanceOf(MARTIN_LEDGER),
  );
  check(
    'R40: earned 261 (rule + migration) / adjusted 120 (manual) / spent 120',
    tot.earned === MARTIN_ACCOUNT.lifetimeEarned &&
      tot.adjusted === MARTIN_ACCOUNT.lifetimeAdjusted &&
      tot.spent === MARTIN_ACCOUNT.lifetimeSpent,
  );
  check(
    'balance = earned + adjusted − spent',
    MARTIN_ACCOUNT.balance === tot.earned + tot.adjusted - tot.spent,
  );
  check(
    'account.seq = last entry',
    MARTIN_ACCOUNT.seq === MARTIN_LEDGER.at(-1)?.seq,
  );
  check(
    'opening 150 = Σ floor(legacy spend)',
    LEGACY_SPEND.reduce((s, x) => s + Math.floor(x / 100), 0) ===
      M(1).balanceAfter,
  );
  check(
    'lifetime spend (admin-only doc)',
    LEGACY_SPEND.reduce((s, x) => s + x, 0) + 2550 + 3550 + 2550 + 2600 ===
      MARTIN_MONEY.lifetimeSpendMinor &&
      !('lifetimeSpendMinor' in MARTIN_STATS) &&
      MARTIN_MONEY.version === MARTIN_STATS.version,
  );
  const win = statWindows(MARTIN_STATS, t(T_B));
  check(
    'R33: visits per visit, windows computed at read (10 / 8 / 4)',
    VISIT_DAYS.length === MARTIN_STATS.lifetime.visitsCompleted &&
      win.visitsCompleted.last12m === 8 &&
      win.visitsCompleted.last90d === 4,
  );
  check(
    'R33: no-shows 2 in 90 days after B (capsule ≥ reliabilityCapsuleNoShows)',
    win.noShows.last90d === 2 &&
      win.noShows.last90d >= pol.reliabilityCapsuleNoShows,
  );
  const last12m = VISIT_DAYS.filter(
    (x) => dayNo('2026-09-18') - dayNo(x) <= 365,
  );
  const gaps = last12m
    .slice(1)
    .map((x, i) => dayNo(x) - dayNo(last12m[i] ?? x));
  check(
    'avgCadenceDays 42',
    Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) ===
      MARTIN_STATS.avgCadenceDays,
  );
  check(
    'R34: due cue = last visit + cadence (22 Oct), none while a next visit exists',
    dueCueOn(MARTIN_STATS, DEFAULT_LOYALTY_POLICY) === '2026-10-22' &&
      dueCueOn(
        { ...MARTIN_STATS, avgCadenceDays: null },
        DEFAULT_LOYALTY_POLICY,
      ) === '2026-10-08' &&
      dueCueOn(
        { ...MARTIN_STATS, nextVisit: MARTIN_STATS.lastVisit },
        DEFAULT_LOYALTY_POLICY,
      ) === null,
  );
  const lapse = (
    today: string,
    avgCadenceDays: number | null = 42,
    nextVisit = MARTIN_STATS.nextVisit,
  ) =>
    lapsedSince(
      { ...MARTIN_STATS, avgCadenceDays, nextVisit },
      DEFAULT_LOYALTY_POLICY,
      d(today),
    );
  check(
    'R57: lapsed from last visit + max(2 × cadence, 90 days) — 42 → 90 days (9 Dec), 60 → 120 (8 Jan), < 3 visits → 90 without a rhythm clause; none while a next visit exists',
    lapse('2026-12-08') === null &&
      JSON.stringify(lapse('2026-12-09')) ===
        '{"since":"2026-12-09","weeks":12,"personalCadenceDays":42}' &&
      lapse('2027-01-07', 60) === null &&
      lapse('2027-01-08', 60)?.since === '2027-01-08' &&
      lapse('2027-01-08', 60)?.weeks === 17 &&
      JSON.stringify(lapse('2026-12-17', null)) ===
        '{"since":"2026-12-09","weeks":14,"personalCadenceDays":null}' &&
      lapse('2027-06-01', 42, MARTIN_STATS.lastVisit) === null,
  );
  check(
    'R57: the lapse line replaces the due cue — whenever lapsed, the due cue holds and is never later',
    [null, 7, 28, 42, 45, 60, 120].every((c) => {
      const l = lapse('2027-09-01', c);
      const due = dueCueOn(
        { ...MARTIN_STATS, avgCadenceDays: c },
        DEFAULT_LOYALTY_POLICY,
      );
      return l !== null && due !== null && due <= l.since;
    }),
  );
  check(
    "R33: only client-caused cancellations count (an unexplained cancel only when the client made it); a converted no-show takes the correction's attribution",
    clientCaused({ reason: { kind: 'client_unwell' }, by: 'staff' }, null) &&
      !clientCaused(
        { reason: { kind: 'staff_shop_closure' }, by: 'client' },
        null,
      ) &&
      !clientCaused({ reason: { kind: 'unspecified' }, by: 'staff' }, null) &&
      clientCaused({ reason: { kind: 'unspecified' }, by: 'client' }, null) &&
      !clientCaused(
        { reason: { kind: 'other', note: 'спряно записване' }, by: 'staff' },
        null,
      ) &&
      clientCaused(
        { reason: { kind: 'other', note: 'пътувам' }, by: 'client' },
        null,
      ) &&
      clientCaused(
        { reason: { kind: 'no_show_converted' }, by: 'staff' },
        'client',
      ) &&
      !clientCaused(
        { reason: { kind: 'no_show_converted' }, by: 'staff' },
        'shop',
      ),
  );
  check(
    'streak before B = 5, after B = 6',
    streakRun(VISIT_DAYS.slice(0, -1), CADENCE_STREAK) === 5 &&
      streakRun(VISIT_DAYS, CADENCE_STREAK) === 6,
  );
  const streakEntries = MARTIN_LEDGER.flatMap((e) =>
    e.effect.kind === 'streak' ? [e.effect] : [],
  );
  check(
    'projection streak = last streak entry',
    streakEntries.at(-1)?.to === MARTIN_ACCOUNT.streaks['cadence']?.current,
  );
  const freezeEntries = MARTIN_LEDGER.flatMap((e) =>
    e.effect.kind === 'freeze' ? [e.effect] : [],
  );
  check(
    'freezes banked = last freeze entry, ≤ maxBanked',
    freezeEntries.at(-1)?.bankedAfter === 2 &&
      2 <= CADENCE_STREAK.freezes.maxBanked,
  );
  // due date: 42 days after the last visit, pushed by the days the KEPT pause froze the streak (11 Sep → 5 Oct);
  // the lifted pause_0910 (its basis was the wrong no-show) freezes nothing after the recompute
  check(
    'dueBy 2026-11-15',
    addDays(
      addDays('2026-09-10', 42),
      dayNo('2026-10-05') - dayNo('2026-09-11'),
    ) === MARTIN_ACCOUNT.streaks['cadence']?.dueBy,
  );
  const tf = tierFor(MARTIN_ACCOUNT.tier.qualifying);
  check(
    'tier Сребро, next Злато in 4',
    tf.current.id === 'silver' &&
      tf.next?.id === 'gold' &&
      tf.next.qualify.atLeast - 8 === MARTIN_ACCOUNT.tier.remaining,
  );
  check(
    'projections pin their definition version (R29)',
    MARTIN_ACCOUNT.tier.definitionVersion === 1 &&
      MARTIN_ACCOUNT.streaks['cadence']?.definitionVersion ===
        CADENCE_STREAK.version,
  );
  check(
    'badges earned are journaled under their once key (P4)',
    MARTIN_LEDGER.every(
      (e) =>
        e.effect.kind !== 'achievement' ||
        e.effect.awardKey === awardKey(e.effect.rule.ruleId, MARTIN, 'once'),
    ),
  );
  check(
    'R30: expiry off at launch — nothing lapses («Точките не изтичат»)',
    !DEFAULT_LOYALTY_POLICY.expiry.enabled &&
      MARTIN_ACCOUNT.pointsExpiry === null &&
      pointsExpiryOf(d('2026-09-10'), MARTIN_ACCOUNT.balance) === null,
  );
  const on = {
    ...DEFAULT_LOYALTY_POLICY,
    expiry: { ...DEFAULT_LOYALTY_POLICY.expiry, enabled: true },
  };
  check(
    'B4 as modelled: 12 months after the last visit, notice 30 days before',
    JSON.stringify(pointsExpiryOf(d('2026-09-10'), 261, on)) ===
      '{"expiresOn":"2027-09-10","noticeFrom":"2027-08-11"}' &&
      pointsExpiryOf(d('2024-02-29'), 10, on)?.expiresOn === '2025-02-28' &&
      pointsExpiryOf(d('2026-09-10'), 0, on) === null,
  );

  // an owed balance (T2, R27)
  checkLedger('Кирил owes', OWED_LEDGER, 225, 7);
  check(
    'R27: a correction may drive the balance negative; the lapse clears the debt with its own label',
    OWED_LEDGER.some(
      (e) => e.balanceAfter < 0 && e.source.kind === 'correction',
    ) &&
      OWED_LEDGER.at(-1)?.publicLabel.code === 'points.debtCleared' &&
      OWED_LEDGER.at(-1)?.balanceAfter === 0,
  );
  check(
    'R27: a manual debit is bounded by the balance (refused beyond, never clamped)',
    manualDebitProblem(262, 261) === 'balanceShortfall' &&
      manualDebitProblem(261, 261) === null &&
      manualDebitProblem(5, -25) === 'balanceShortfall',
  );

  // catalogue + redemption (limits, availability, pause)
  const freeCut = CATALOG.find((c) => c.id === 'reward-free-cut');
  const beard = CATALOG.find((c) => c.id === 'reward-beard-trim');
  if (freeCut === undefined || beard === undefined)
    throw new Error('catalogue');
  const recent = [{ rewardId: beard.id, on: d('2026-08-12') }];
  check(
    'free cut affordable (261 ≥ 250) but no reward-ready row while paused (spine §7)',
    redeemProblem(freeCut, {
      balance: 261,
      today: d('2026-09-18'),
      paused: true,
      recent,
    }) === 'paused' &&
      redeemProblem(freeCut, {
        balance: 261,
        today: d('2026-10-05'),
        paused: false,
        recent,
      }) === null,
  );
  check(
    'beard trim: 1 per 30 days per client',
    redeemProblem(beard, {
      balance: 200,
      today: d('2026-09-05'),
      paused: false,
      recent,
    }) === 'perClientLimit' &&
      redeemProblem(beard, {
        balance: 200,
        today: d('2026-09-11'),
        paused: false,
        recent,
      }) === null,
  );
  check(
    'an owed balance never redeems; stock and window refuse',
    redeemProblem(beard, {
      balance: -20,
      today: d('2026-10-05'),
      paused: false,
      recent: [],
    }) === 'insufficientPoints' &&
      redeemProblem(
        { ...beard, limits: { perClient: null, total: 14 } },
        { balance: 500, today: d('2026-10-05'), paused: false, recent: [] },
      ) === 'soldOut' &&
      redeemProblem(
        { ...beard, available: { from: null, until: d('2026-09-30') } },
        { balance: 500, today: d('2026-10-05'), paused: false, recent: [] },
      ) === 'ended',
  );

  // pauses (B1, R25: suggest, a person confirms; basis + review date recorded)
  const at1400 = t('2026-09-10T14:00:00.000Z');
  const suggestion = suggestPause(NO_SHOWS_BEFORE_B, 0, at1400, pol, null);
  check(
    'R25: 3 no-shows in 60 days only SUGGESTS; the confirmed pause carries that basis',
    suggestion !== null &&
      JSON.stringify(suggestion.basis) === JSON.stringify(PAUSE_NOSHOW.basis) &&
      suggestion.raisedAt === '2026-09-10T13:00:00.000Z' &&
      PAUSE_NOSHOW.fromSuggestion &&
      ADJ_P0_REC.input.kind === 'pause.apply' &&
      ADJ_P0_REC.input.fromSuggestion &&
      ADJ_P0_REC.actor.kind === 'staff',
  );
  check(
    'R49: «Не сега» hides the suggestion until a newer no-show raises it',
    suggestPause(
      NO_SHOWS_BEFORE_B,
      0,
      at1400,
      pol,
      t('2026-09-10T13:30:00.000Z'),
    )?.dismissedAt === '2026-09-10T13:30:00.000Z' &&
      suggestPause(
        [...NO_SHOWS_BEFORE_B, visit('2026-09-20', 'a0920')],
        0,
        t('2026-09-20T12:00:00.000Z'),
        pol,
        t('2026-09-10T13:30:00.000Z'),
      )?.dismissedAt === null,
  );
  check(
    'R25: no suggestion while a pause is active, none after B (2 < 3)',
    suggestPause(NO_SHOWS_BEFORE_B, 1, at1400, pol, null) === null &&
      suggestPause(MARTIN_STATS.last365.noShows, 0, t(T_B), pol, null) ===
        null &&
      MARTIN_STATS.pauseSuggestion === null,
  );
  check(
    'R25: no pause is written by the system',
    MARTIN_LEDGER.every(
      (e) =>
        e.effect.kind !== 'pause' ||
        e.actor.kind !== 'system' ||
        e.effect.op === 'expired',
    ),
  );
  check(
    'a receptionist confirms a 30-day suggestion alone',
    decide(rolesOf(MARIA), capabilityFor(ADJ_P0_REC.input), {
      actorUid: MARIA,
      subject: { uid: MARTIN, staffRelated: false },
      pauseDays: 30,
    }).kind === 'allowed' &&
      decide(rolesOf(MARIA), 'client.pause.confirmSuggestion', {
        actorUid: MARIA,
        subject: { uid: MARTIN, staffRelated: false },
      }).kind === 'allowed' &&
      decide(rolesOf(NIKO), 'client.pause.confirmSuggestion', {
        actorUid: NIKO,
        subject: { uid: MARTIN, staffRelated: false },
      }).kind === 'absent',
  );
  check(
    'pause history cites journal entries',
    [PAUSE_NOSHOW, PAUSE_LATE].every((p) =>
      p.history.every((h) =>
        MARTIN_LEDGER.some((e) => e.id === h.journalEntryId),
      ),
    ),
  );
  check(
    'every pause row states before → after',
    MARTIN_LEDGER.every(
      (e) =>
        e.effect.kind !== 'pause' ||
        (e.effect.op === 'applied') === (e.effect.prior === null),
    ),
  );
  const before = projectAccountStatus(
    PAUSES_BEFORE_B,
    t('2026-09-15T07:00:00.000Z'),
  );
  const after = projectAccountStatus([PAUSE_NOSHOW, PAUSE_LATE], t(T_B));
  check(
    'projection before B = the no-show pause (ends later)',
    JSON.stringify(before) ===
      '{"kind":"blocked","reason":"no_show_pattern","untilIso":"2026-10-10T21:00:00.000Z","scope":"selfService"}',
  );
  check(
    'projection after B = the kept late-cancel pause',
    JSON.stringify(after) ===
      '{"kind":"blocked","reason":"late_cancellation_pattern","untilIso":"2026-10-04T21:00:00.000Z","scope":"selfService"}',
  );
  const hidden = projectAccountStatus(
    [{ ...PAUSE_LATE, reason: { category: 'conduct', clientVisible: false } }],
    t(T_B),
  );
  check(
    'hidden category projects as manual',
    hidden.kind === 'blocked' && hidden.reason === 'manual',
  );
  const strongest = projectAccountStatus(
    [
      PAUSE_LATE,
      {
        ...PAUSE_LATE,
        id: pid('pause_x'),
        scope: 'allBookings',
        term: { kind: 'temporary', until: t('2026-09-30T21:00:00.000Z') },
      },
    ],
    t(T_B),
  );
  check(
    'scope = the strongest live pause (client copy differs, B2)',
    strongest.kind === 'blocked' && strongest.scope === 'allBookings',
  );
  check(
    'expired pause projects active',
    projectAccountStatus([PAUSE_LATE], t('2026-10-05T00:00:00.000Z')).kind ===
      'active',
  );
  const summary = MARTIN_PROFILE_0918.pauseSummary;
  check(
    'R48: barbers read a pause summary — term, scope, visible category, basis count, since; never who or the note',
    summary !== null &&
      summary.basisCount === 2 &&
      summary.category === 'late_cancellation_pattern' &&
      summary.since === PAUSE_LATE.appliedAt &&
      !JSON.stringify(summary).includes('maria') &&
      !JSON.stringify(summary).includes('обадих') &&
      pauseSummaryOf(
        [
          {
            ...PAUSE_LATE,
            reason: { category: 'conduct', clientVisible: false },
          },
        ],
        t(T_B),
      )?.category === 'manual',
  );
  // @ts-expect-error — R56: a pause record carries no free text; the note is its private/note sub-document
  const NOTE_ON_RECORD: ClientPause['reason'] = {
    category: 'conduct',
    clientVisible: false,
    note: 'не се пише тук',
  };
  check(
    'R56: no pause record carries a note (frontDesk() admits sysadmin); «Бележка на екипа» is clientPauses/{id}/private/note, by the applier, in the apply commit',
    NOTE_ON_RECORD.category === 'conduct' &&
      [PAUSE_NOSHOW, PAUSE_LATE].every(
        (p) =>
          !('note' in p.reason) &&
          !JSON.stringify(p).includes(PAUSE_LATE_NOTE.text),
      ) &&
      PAUSE_LATE.appliedBy.kind === 'staff' &&
      PAUSE_LATE_NOTE.authorUid === PAUSE_LATE.appliedBy.userId &&
      PAUSE_LATE_NOTE.writtenAt === PAUSE_LATE.appliedAt &&
      !JSON.stringify(MARTIN_PROFILE_0918).includes(PAUSE_LATE_NOTE.text),
  );

  // B
  const chosen = PREVIEW_B.choices
    .filter((c) =>
      ADJ_B.choices.some((a) => a.choiceId === c.id && a.option !== 'keep'),
    )
    .flatMap((c) => c.lines);
  const allLines = [
    ...PREVIEW_B.direct,
    ...PREVIEW_B.derived,
    ...PREVIEW_B.ruleEffects,
    ...chosen,
  ].filter((l) => l.effect !== null);
  check(
    'B: every effect line (incl. the answered choices) is exactly one committed entry',
    allLines.length === ADJ_B.resultingEntryIds.length &&
      ADJ_B.resultingEntryIds.every((id) =>
        allLines.some(
          (l) =>
            JSON.stringify(l.effect) ===
            JSON.stringify(MARTIN_LEDGER.find((e) => e.id === id)?.effect),
        ),
      ),
  );
  check(
    'B: balance line matches the ledger',
    PREVIEW_B.balance.before === M(14).balanceAfter &&
      PREVIEW_B.balance.after === M(22).balanceAfter,
  );
  check(
    'B: all cascade entries share the correlation',
    ADJ_B.resultingEntryIds.every(
      (id) =>
        (MARTIN_LEDGER.find((e) => e.id === id)?.correlationId as
          string | undefined) === ADJ_B.id,
    ),
  );
  check(
    'R25: defaults — lift the pause whose basis held a0910, keep the other',
    PREVIEW_B.choices.map((c) => c.defaultOption).join() === 'lift,keep' &&
      pauseChoiceDefault(PAUSES_BEFORE_B[0] ?? PAUSE_NOSHOW, A0910, pol) ===
        'lift' &&
      pauseChoiceDefault(PAUSE_LATE, A0910, pol) === 'keep' &&
      pauseChoiceDefault(PAUSE_LATE, aid('a0822'), pol) === 'lift' && // a late-cancel basis holds only while every fact stands
      ADJ_B.choices.map((c) => c.option).join() === 'lift,keep' &&
      PAUSE_NOSHOW.state === 'lifted' &&
      PAUSE_LATE.state === 'active',
  );
  check(
    'R49: an allBookings preview offers each upcoming booking as a choice, default keep',
    BOOKING_CHOICE.subject.kind === 'booking' &&
      BOOKING_CHOICE.defaultOption === 'keep' &&
      BOOKING_CHOICE.options.includes('cancel'),
  );
  check(
    'B: stateVersion pause component = Σ pause versions before B; after B it is v4',
    PREVIEW_B.stateVersion.includes('|pause:v3|') &&
      pauseVersion([PAUSE_NOSHOW, PAUSE_LATE]) === 'pause:v4' &&
      ADJ_C1.stateVersion.includes('pause:v4'),
  );
  check(
    'B: the audit row records both answers',
    AUDIT_B.context?.['choices'] === 'pause-0910=lift,pause-0911=keep' &&
      AUDIT_B.action === 'support.visit_outcome',
  );
  check(
    'B: award keys from the helpers',
    K_EVERY10 === 'every-10th-visit:dev-client-2:client.visits.completed:10' &&
      K_EARN_B === 'earn-per-euro:dev-client-2:appt:a0910:seat:s1',
  );
  check(
    'B: receptionist may correct 5 days back',
    decide(rolesOf(MARIA), capabilityFor(ADJ_B.input), {
      actorUid: MARIA,
      subject: { uid: MARTIN, staffRelated: false },
      daysBack: 5,
    }).kind === 'allowed',
  );
  check(
    'B: a barber may not (same day only, R46)',
    JSON.stringify(
      decide(rolesOf(NIKO), 'visit.outcome.correct', {
        actorUid: NIKO,
        subject: { uid: MARTIN, staffRelated: false },
        daysBack: 5,
      }),
    ) === '{"kind":"refused","reason":"overLimit"}' &&
      decide(rolesOf(NIKO), 'visit.outcome.correct', {
        actorUid: NIKO,
        subject: { uid: MARTIN, staffRelated: false },
        daysBack: 0,
      }).kind === 'allowed',
  );

  // C
  checkLedger(
    'Мартин C slice',
    MARTIN_LEDGER.slice(22, 24),
    M(22).balanceAfter,
    23,
  );
  check(
    'C: reversal links both ways',
    ADJ_C1.reversedBy === ADJ_C2.id && ADJ_C2.reverses === ADJ_C1.id,
  );
  check(
    'C: net zero',
    balanceOf([M(23), M(24)]) === 0 &&
      M(24).balanceAfter === M(22).balanceAfter,
  );
  check(
    'C: undo needs what the original needed',
    capabilityFor(ADJ_C2.input) === 'loyalty.points.adjust',
  );
  check(
    'C: the undo was allowed against the state it read',
    reversalProblem({ ...ADJ_C1, reversedBy: null }) === null,
  );
  check(
    'C: a second undo (toast + Activity row racing) refuses',
    reversalProblem(ADJ_C1) === 'alreadyReversed',
  );
  check(
    'C: a reversal is never reversed; a pending request cannot be',
    reversalProblem(ADJ_C2) === 'isReversal' &&
      reversalProblem(ADJ_D_PENDING) === 'notCommitted',
  );
  check(
    'C: audit rows name the client and the action',
    AUDIT_C.every((a) => a.targetUserId === MARTIN) &&
      AUDIT_C.map((a) => a.action).join() ===
        'support.points_credit,support.adjustment_reverse',
  );
  check(
    'C (R18): client labels «Бонус от салона» and «Анулирано», never the note',
    M(23).publicLabel.code === 'points.goodwill' &&
      M(24).publicLabel.code === 'points.reversed' &&
      !JSON.stringify(M(23).publicLabel).includes('Нико'),
  );
  check(
    'C (R53): 35 min apart > undoWindowMinutes, so the client ledger shows both rows; 5 min would fold',
    !foldsInClientLedger(M(23), M(24), pol.undoWindowMinutes) &&
      foldsInClientLedger(
        M(23),
        { ...M(24), at: t('2026-09-16T07:10:00.000Z') },
        pol.undoWindowMinutes,
      ),
  );
  check(
    'C (T1, R31): the notice was held 10 min and released before the undo, so a neutral follow-up goes out',
    Date.parse(HELD_C1.releaseAt) - Date.parse(ADJ_C1.committedAt ?? '') ===
      pol.undoWindowMinutes * 60_000 &&
      HELD_C1.state === 'released' &&
      HELD_C1.releaseAt < (ADJ_C2.committedAt ?? ''),
  );
  check(
    'C: within caps — pointsToday from the actor usage doc, per-subject 30 days (R40)',
    pointsToday(MARIA_USAGE_0916, ADJ_C1.requestedAt, 30) === 30 &&
      pointsOnSubject30d([], ADJ_C1.requestedAt, 30) === 30 &&
      decide(rolesOf(MARIA), 'loyalty.points.adjust', {
        actorUid: MARIA,
        subject: { uid: MARTIN, staffRelated: false },
        points: 30,
        pointsToday: 30,
        pointsOnSubject30d: 30,
      }).kind === 'allowed',
  );

  // per-actor serialisation: two +40 requests by one actor on two different clients, 100 already used today
  const busy: SupportActorUsage = {
    userId: MARIA,
    version: 7,
    recent: [
      {
        adjustmentId: adj('adj_0917_credit_other'),
        at: t('2026-09-17T08:00:00.000Z'),
        subjectUserId: PETAR,
        kind: 'points.credit',
        points: 100,
        compensatesOwn: false,
      },
    ],
  };
  const now17 = t('2026-09-17T12:00:00.000Z');
  const probe = (today: number) =>
    decide(rolesOf(MARIA), 'loyalty.points.adjust', {
      actorUid: MARIA,
      subject: { uid: MARTIN, staffRelated: false },
      points: 40,
      pointsToday: today,
    }).kind;
  const afterFirst: SupportActorUsage = {
    ...busy,
    version: 8,
    recent: [
      ...busy.recent,
      {
        adjustmentId: adj('adj_0917_credit_first'),
        at: now17,
        subjectUserId: MARTIN,
        kind: 'points.credit',
        points: 40,
        compensatesOwn: false,
      },
    ],
  };
  check(
    'cap race: from one snapshot both +40 would pass (180 > 150 committed)',
    probe(pointsToday(busy, now17, 40)) === 'allowed',
  );
  check(
    'cap race: serialised on supportActors/{uid}, the second sees 180 → approval',
    probe(pointsToday(afterFirst, now17, 40)) === 'approval',
  );
  check(
    "an undo of one's own credit costs nothing and frees nothing",
    pointsToday(MARIA_USAGE_0918, t('2026-09-16T07:45:00.000Z'), 0) === 30,
  );

  // D
  const probeD = {
    actorUid: MARIA,
    subject: { uid: MARTIN, staffRelated: false },
    points: 120,
    pointsToday: pointsToday(MARIA_USAGE_0918, ADJ_D_PENDING.requestedAt, 120),
    pointsOnSubject30d: pointsOnSubject30d(
      MARTIN_MANUAL_30D,
      ADJ_D_PENDING.requestedAt,
      120,
    ),
  };
  check(
    'D: +120 by receptionist → approval (overLimit: per act and per subject)',
    JSON.stringify(decide(rolesOf(MARIA), 'loyalty.points.adjust', probeD)) ===
      '{"kind":"approval","reason":"overLimit"}' &&
      probeD.pointsOnSubject30d === 150,
  );
  check(
    'R40: 4 × 30 on one client in 30 days — the 4th crosses the per-subject 100',
    JSON.stringify(
      decide(rolesOf(MARIA), 'loyalty.points.adjust', {
        actorUid: MARIA,
        subject: { uid: MARTIN, staffRelated: false },
        points: 30,
        pointsToday: 30,
        pointsOnSubject30d: 120,
      }),
    ) === '{"kind":"approval","reason":"overLimit"}',
  );
  check(
    'D: expiry = requested + 7 days',
    ADJ_D_PENDING.approval.kind === 'pending' &&
      Date.parse(ADJ_D_PENDING.approval.expiresAt) -
        Date.parse(ADJ_D_PENDING.approval.requestedAt) ===
        pol.approvalExpiryDays * DAY,
  );
  check(
    'D: pending writes nothing to the journal; the staff ledger reads the pending row from clientProfiles (A12, R38)',
    ADJ_D_PENDING.resultingEntryIds.length === 0 &&
      !MARTIN_LEDGER.some(
        (e) =>
          e.at < t('2026-09-18T09:10:00.000Z') &&
          (e.correlationId as string) === ADJ_D_ID,
      ) &&
      MARTIN_PROFILE_0918.pendingAdjustments[0]?.adjustmentId === ADJ_D_ID &&
      !JSON.stringify(MARTIN_PROFILE_0918.pendingAdjustments).includes(MARIA),
  );
  check(
    'D: Иван may decide, Мария may not',
    APPROVAL_D.viewerMayDecide &&
      decide(rolesOf(MARIA), 'approvals.decide', {
        actorUid: MARIA,
        requesterUid: MARIA,
      }).kind !== 'allowed' &&
      decisionProblem(ADJ_D_PENDING, MARIA, t('2026-09-18T09:10:00.000Z')) ===
        'ownRequest',
  );
  check(
    'D: nobody decides their own request',
    JSON.stringify(
      decide(rolesOf(IVAN), 'approvals.decide', {
        actorUid: IVAN,
        requesterUid: IVAN,
      }),
    ) === '{"kind":"refused","reason":"ownRequest"}',
  );
  check(
    'D: nobody decides a request on their own client record',
    JSON.stringify(
      decide(rolesOf(IVAN), 'approvals.decide', {
        actorUid: IVAN,
        requesterUid: MARIA,
        subject: { uid: IVAN, staffRelated: true },
      }),
    ) === '{"kind":"refused","reason":"self"}' &&
      decisionProblem(
        { ...ADJ_D_PENDING, subjectUserId: IVAN },
        IVAN,
        t('2026-09-18T09:10:00.000Z'),
      ) === 'ownRecord',
  );
  check(
    "H4 (R38): with one admin, a request on the owner's record has no eligible approver",
    eligibleApprovers([IVAN], MARIA, MARTIN).join() === IVAN &&
      eligibleApprovers([IVAN], MARIA, IVAN).length === 0,
  );
  check(
    'D: a second approve and a late approve refuse',
    decisionProblem(ADJ_D, IVAN, t('2026-09-18T09:11:00.000Z')) ===
      'notPending' &&
      decisionProblem(ADJ_D_PENDING, IVAN, t('2026-09-25T08:00:00.000Z')) ===
        'expired',
  );
  check(
    'D: approval decided by an admin actor',
    ADJ_D.approval.kind === 'approved' &&
      ADJ_D.approval.decidedBy.kind === 'admin',
  );
  check(
    'D: preview balance matches commit',
    PREVIEW_D.balance.after === M(25).balanceAfter,
  );
  check(
    'D: three audit rows',
    AUDIT_D.length === 3 && AUDIT_D[2]?.action === 'support.points_credit',
  );

  // Дейност (P9): the unified adjustment/audit event
  const [rowD, rowC2, rowC1] = ACTIVITY_CD;
  check(
    'P9: a Дейност row joins journal and adjustment — before → after and links from the journal, reason and anomalies from the adjustment',
    rowC1 !== undefined &&
      rowC2 !== undefined &&
      rowD !== undefined &&
      JSON.stringify(rowC1.changes) ===
        '[{"quantity":"points","before":141,"after":171}]' &&
      rowC1.reversedBy === ADJ_C2_ID &&
      rowC1.reason?.code === 'goodwill' &&
      rowC1.reason.publicLabel === 'points.goodwill' &&
      rowC1.anomalies.includes('repeat_subject') &&
      rowC2.kind === 'adjustment.reverse' &&
      rowC2.source?.kind === 'correction' &&
      rowC2.reverses === ADJ_C1_ID &&
      JSON.stringify(rowC2.changes) ===
        '[{"quantity":"points","before":171,"after":141}]' &&
      rowD.approval?.kind === 'approved' &&
      rowD.journalEntryIds.join() === M(25).id &&
      rowD.actor.kind === 'staff',
  );
  const pendingRow = activityOf(ADJ_D_PENDING, true);
  check(
    'A12: a pending request is a staff-only Дейност row with its approval state and no journal entry',
    pendingRow.approval?.kind === 'pending' &&
      pendingRow.journalEntryIds.length === 0 &&
      pendingRow.visibility === 'staff' &&
      pendingRow.changes.length === 0,
  );
  check(
    "R15: a sysadmin's Дейност carries no «Бележка на екипа»",
    ACTIVITY_CD.every((r) => r.reason?.note !== undefined) &&
      [ADJ_C1, ADJ_C2, ADJ_D]
        .map((a) => activityOf(a, false))
        .every((r) => r.reason !== null && !('note' in r.reason)),
  );
  check(
    'A8, R18: «Уведоми клиента» defaults and the client labels of manual points',
    notifyByDefault('goodwill') &&
      notifyByDefault('missed_award') &&
      !notifyByDefault('staff_error') &&
      !notifyByDefault('system_fault') &&
      REASON_PUBLIC_LABEL.goodwill === 'points.goodwill' &&
      REASON_PUBLIC_LABEL.service_issue === 'points.serviceIssue' &&
      REASON_PUBLIC_LABEL.fraud_or_abuse === 'points.correction',
  );

  // A
  checkLedger('Петър tail', PETAR_LEDGER_TAIL, 310, 41);
  const oA = occurrenceKey(ruleById('every-10th-visit').body.recurrence, {
    trigger: EVENT_A,
    nth: { metric: 'client.visits.completed', multiple: 20 },
  });
  check(
    'A: explainer award key = helper',
    oA.ok &&
      awardKey(rid('every-10th-visit'), PETAR, oA.value) === EXPLAIN_A.awardKey,
  );
  check(
    'A: met but not issued → replay offer',
    EXPLAIN_A.met && !EXPLAIN_A.issued && EXPLAIN_A.offer === 'replay',
  );
  check(
    'A: TTL mirror = at + 90 days',
    EVENT_A.purgeAt.seconds * 1000 - Date.parse(EVENT_A.at) === 90 * DAY,
  );
  const store = new Set<AwardKey>([
    awardKey(rid('first-visit'), PETAR, 'once'),
    awardKey(rid('tenth-visit'), PETAR, 'once'),
  ]);
  const met = [
    { ruleId: 'earn-per-euro', nth: null },
    { ruleId: 'first-visit', nth: null },
    { ruleId: 'tenth-visit', nth: null },
    { ruleId: 'every-10th-visit', nth: 20 },
  ];
  const first = replay(REPLAY_A, met, store);
  const second = replay(REPLAY_A, met, store);
  check(
    'A: first replay issues exactly the missing two',
    first.length === 2 &&
      first.includes(K_A_EARN) &&
      first.includes(K_A_EVERY10),
  );
  check('A: second replay is a no-op', second.length === 0);
  const outcomeOf = (created: readonly AwardKey[]): 'applied' | 'duplicate' =>
    created.length === 0 ? 'duplicate' : 'applied';
  check(
    'P2: guards are read first — the replay is `applied`, a delivery whose guards all exist is `duplicate`, the unprocessed original has no outcome',
    outcomeOf(first) === REPLAY_A.outcome &&
      REPLAY_A.processedAt !== null &&
      outcomeOf(second) === 'duplicate' &&
      EVENT_A.outcome === null &&
      EVENT_A.processedAt === null,
  );
  check(
    'A: the replay doc carries the original arm, fact and date; its id derives from the request id (F2)',
    REPLAY_A.factKey === EVENT_A.factKey &&
      REPLAY_A.localDate === EVENT_A.localDate &&
      REPLAY_A.id === `replay_${REPLAY_REQ}` &&
      REPLAY_A.replayOf?.eventId === EVENT_A.id,
  );
  check(
    'A: replay entries cite the original event',
    PETAR_LEDGER_TAIL.every(
      (e) =>
        e.source.kind === 'rule' &&
        e.source.eventId === EVENT_A.id &&
        (e.correlationId as string) === REPLAY_REQ,
    ),
  );
  check(
    'A (R45): replayRule is gated by loyalty.replay — receptionist alone, barber and sysadmin absent; audited in-transaction',
    decide(rolesOf(MARIA), 'loyalty.replay', {
      actorUid: MARIA,
      subject: { uid: PETAR, staffRelated: false },
    }).kind === 'allowed' &&
      decide(['barber'], 'loyalty.replay', { actorUid: NIKO }).kind ===
        'absent' &&
      decide(['sysadmin'], 'loyalty.replay', { actorUid: uid('vendor') })
        .kind === 'absent' &&
      AUDIT_A.action === 'support.rule_replay' &&
      AUDIT_A.targetUserId === PETAR,
  );

  // capabilities (§3.2)
  const s = (u: UserId, staffRelated = false) => ({ uid: u, staffRelated });
  const dec = (
    who: readonly UserRole[],
    c: Parameters<typeof decide>[1],
    p: Parameters<typeof decide>[2],
  ) => JSON.stringify(decide(who, c, p));
  check(
    'R2: barbers hold no request grants — points are absent',
    dec(['barber'], 'loyalty.points.adjust', {
      actorUid: NIKO,
      subject: s(MARTIN),
      points: 20,
    }) === '{"kind":"absent"}' &&
      ROLE_CAPABILITIES.barber.every((g) => g.mode === 'alone'),
  );
  check(
    'R46: the added capabilities exist',
    [
      'client.pause.viewDetail',
      'client.pause.confirmSuggestion',
      'client.identity.edit',
      'booking.placePaused',
      'loyalty.explain',
      'loyalty.replay',
      'audit.export',
      'settings.supportPolicy.write',
      'roles.assign',
      'ops.backfill',
    ].every((c) => (CAPABILITIES as readonly string[]).includes(c)),
  );
  check(
    'R47: the policy keys and defaults',
    Object.keys(pol).length === 24 &&
      pol.suggestPauseNoShows === 3 &&
      pol.suggestPauseWindowDays === 60 &&
      pol.reliabilityCapsuleNoShows === 2 &&
      pol.reliabilityCapsuleWindowDays === 90 &&
      pol.maxOpenClaimsPerClient === 3 &&
      pol.perSubjectPoints30d === 100 &&
      pol.receptionistStreakExtendMaxDays === 42 &&
      pol.stepUpMaxAgeMinutes === 5 &&
      pol.barberOutcomeCorrectionDays === 0 &&
      !('autoPauseDays' in pol),
  );
  check(
    'receptionist +30 → alone',
    dec(['receptionist'], 'loyalty.points.adjust', {
      actorUid: MARIA,
      subject: s(MARTIN),
      points: 30,
      pointsToday: 30,
    }) === '{"kind":"allowed"}',
  );
  check(
    'receptionist day cap → approval',
    dec(['receptionist'], 'loyalty.points.adjust', {
      actorUid: MARIA,
      subject: s(MARTIN),
      points: 40,
      pointsToday: 160,
    }) === '{"kind":"approval","reason":"overLimit"}',
  );
  check(
    'own record → refused',
    dec(['receptionist'], 'loyalty.points.adjust', {
      actorUid: MARIA,
      subject: s(MARIA),
      points: 10,
    }) === '{"kind":"refused","reason":"self"}',
  );
  check(
    'R40: a staff account is implicitly staff-related → approval for a non-admin; placement, on-behalf redemption and replay are never routed',
    isStaffRelated({ staffRelated: false }, rolesOf(NIKO)) &&
      !isStaffRelated({ staffRelated: false }, rolesOf(MARTIN)) &&
      dec(['receptionist'], 'loyalty.points.adjust', {
        actorUid: MARIA,
        subject: s(NIKO, true),
        points: 10,
      }) === '{"kind":"approval","reason":"staffRelated"}' &&
      dec(['receptionist'], 'loyalty.redeem.onBehalf', {
        actorUid: MARIA,
        subject: s(NIKO, true),
      }) === '{"kind":"allowed"}' &&
      dec(['receptionist'], 'booking.placePaused', {
        actorUid: MARIA,
        subject: s(NIKO, true),
      }) === '{"kind":"allowed"}' &&
      dec(['barber'], 'booking.placePaused', {
        actorUid: NIKO,
        subject: s(NIKO),
      }) === '{"kind":"refused","reason":"self"}',
  );
  check(
    'admin +120 → alone',
    dec(rolesOf(IVAN), 'loyalty.points.adjust', {
      actorUid: IVAN,
      subject: s(MARTIN),
      points: 120,
    }) === '{"kind":"allowed"}',
  );
  check(
    'admin on own client record → refused',
    dec(rolesOf(IVAN), 'loyalty.points.adjust', {
      actorUid: IVAN,
      subject: s(IVAN),
      points: 5,
    }) === '{"kind":"refused","reason":"self"}',
  );
  check(
    'sysadmin points → break-glass; never decides approvals (R15)',
    dec(['sysadmin'], 'loyalty.points.adjust', {
      actorUid: uid('vendor'),
      subject: s(MARTIN),
      points: 10,
    }) === '{"kind":"breakGlass"}' &&
      dec(['sysadmin'], 'approvals.decide', {
        actorUid: uid('vendor'),
        requesterUid: MARIA,
      }) === '{"kind":"absent"}',
  );
  check(
    'content_manager sees no client',
    dec(['content_manager'], 'client.view', { actorUid: uid('cm') }) ===
      '{"kind":"absent"}',
  );
  check(
    'receptionist lifts temporary, not permanent',
    dec(['receptionist'], 'client.pause.lift', {
      actorUid: MARIA,
      subject: s(MARTIN),
      pauseTerm: 'temporary',
    }) === '{"kind":"allowed"}' &&
      dec(['receptionist'], 'client.pause.lift', {
        actorUid: MARIA,
        subject: s(MARTIN),
        pauseTerm: 'permanent',
      }) === '{"kind":"refused","reason":"overLimit"}',
  );
  check(
    'receptionist 45-day pause → approval',
    dec(['receptionist'], 'client.pause.temporary', {
      actorUid: MARIA,
      subject: s(MARTIN),
      pauseDays: 45,
    }) === '{"kind":"approval","reason":"overLimit"}',
  );
  check(
    '2nd streak repair this year → approval',
    dec(['receptionist'], 'loyalty.streak.repair', {
      actorUid: MARIA,
      subject: s(MARTIN),
      perClientThisYear: 2,
    }) === '{"kind":"approval","reason":"overLimit"}',
  );
  check(
    'streak.extend beyond one period (42 d) → approval',
    capabilityFor({ kind: 'streak.extend', streakId: CADENCE, days: 90 }) ===
      'loyalty.streak.repair' &&
      dec(['receptionist'], 'loyalty.streak.repair', {
        actorUid: MARIA,
        subject: s(MARTIN),
        perClientThisYear: 1,
        extendDays: 90,
      }) === '{"kind":"approval","reason":"overLimit"}' &&
      dec(['receptionist'], 'loyalty.streak.repair', {
        actorUid: MARIA,
        subject: s(MARTIN),
        perClientThisYear: 1,
        extendDays: 14,
      }) === '{"kind":"allowed"}',
  );
  check(
    'permanent pause needs the permanent capability',
    capabilityFor({
      kind: 'pause.apply',
      scope: 'selfService',
      term: { kind: 'permanent' },
      category: 'conduct',
      clientVisible: false,
      basis: [],
      reviewOn: d('2027-03-01'),
      fromSuggestion: false,
    }) === 'client.pause.permanent',
  );
  check(
    'barber cannot list clients (existing rule)',
    dec(['barber'], 'client.list', { actorUid: NIKO }) === '{"kind":"absent"}',
  );
  check(
    'only admin reads money',
    dec(['receptionist'], 'client.stats.money', { actorUid: MARIA }) ===
      '{"kind":"absent"}' &&
      dec(['admin'], 'client.stats.money', { actorUid: IVAN }) ===
        '{"kind":"allowed"}' &&
      dec(['sysadmin'], 'client.stats.money', { actorUid: uid('vendor') }) ===
        '{"kind":"absent"}',
  );
  check(
    "admin holds every capability but ops.backfill (sysadmin's)",
    ROLE_CAPABILITIES.admin.length === CAPABILITIES.length - 1 &&
      dec(['admin'], 'ops.backfill', { actorUid: IVAN }) ===
        '{"kind":"absent"}' &&
      dec(['sysadmin'], 'ops.backfill', { actorUid: uid('vendor') }) ===
        '{"kind":"allowed"}',
  );
  check(
    'client holds none; content_manager only rules.draft',
    ROLE_CAPABILITIES.client.length === 0 &&
      ROLE_CAPABILITIES.content_manager.map((g) => g.capability).join() ===
        'rules.draft',
  );
  check(
    'actor attribution',
    IVAN_A.kind === 'admin' &&
      MARIA_A.kind === 'staff' &&
      NIKO_A.kind === 'staff',
  );
  // R6: the redeemer's receipt «Отмени» (sec-03 §3.2.1, §3.2.3) — redemptions/{RDM} as it stood minutes after Нико redeemed
  const RDM_DOC: Redemption = {
    id: RDM,
    userId: MARTIN,
    rewardId: rwd('reward-beard-trim'),
    cost: 120,
    by: NIKO_A,
    channel: 'onBehalf',
    at: t('2026-08-12T07:30:00.000Z'),
    context: 'visitSheet',
    state: {
      kind: 'active',
      grant: { kind: 'couponGrant', id: cg('cg_0812_beard') },
      expiresAt: null,
    },
    entryIds: MARTIN_LEDGER.filter(
      (e) => e.source.kind === 'redemption' && e.source.redemptionId === RDM,
    ).map((e) => e.id),
  };
  check(
    'R6: receiptUndoOf — own on-behalf, active, ≤ undoWindowMinutes → admitted; late or spent → lapsed; anyone else → notOwn',
    RDM_DOC.entryIds.length === 2 &&
      receiptUndoOf(RDM_DOC, NIKO, t('2026-08-12T07:40:00.000Z'), pol) ===
        'admitted' &&
      receiptUndoOf(RDM_DOC, NIKO, t('2026-08-12T07:41:00.000Z'), pol) ===
        'lapsed' &&
      receiptUndoOf(
        {
          ...RDM_DOC,
          state: {
            kind: 'used',
            grant: { kind: 'couponGrant', id: cg('cg_0812_beard') },
            usedAt: t('2026-08-12T07:32:00.000Z'),
          },
        },
        NIKO,
        t('2026-08-12T07:35:00.000Z'),
        pol,
      ) === 'lapsed' &&
      receiptUndoOf(RDM_DOC, MARIA, t('2026-08-12T07:35:00.000Z'), pol) ===
        'notOwn' &&
      receiptUndoOf(
        { ...RDM_DOC, channel: 'self', by: { kind: 'user', userId: MARTIN } },
        MARTIN,
        t('2026-08-12T07:35:00.000Z'),
        pol,
      ) === 'notOwn',
  );
  check(
    'R6: a barber is allowed the receipt undo and absent on the plain reversal; never routed; H1 still binds',
    capabilityFor({ kind: 'redemption.reverse', redemptionId: RDM }) ===
      'loyalty.redemption.reverse' &&
      dec(['barber'], 'loyalty.redemption.reverse', {
        actorUid: NIKO,
        subject: s(MARTIN),
        receiptUndo: true,
      }) === '{"kind":"allowed"}' &&
      dec(['barber'], 'loyalty.redemption.reverse', {
        actorUid: NIKO,
        subject: s(MARTIN),
        receiptUndo: false,
      }) === '{"kind":"absent"}' &&
      dec(['receptionist'], 'loyalty.redemption.reverse', {
        actorUid: MARIA,
        subject: s(NIKO, true),
        receiptUndo: true,
      }) === '{"kind":"allowed"}' &&
      dec(['receptionist'], 'loyalty.redemption.reverse', {
        actorUid: MARIA,
        subject: s(NIKO, true),
      }) === '{"kind":"approval","reason":"staffRelated"}' &&
      dec(['barber'], 'loyalty.redemption.reverse', {
        actorUid: NIKO,
        subject: s(NIKO, true),
        receiptUndo: true,
      }) === '{"kind":"refused","reason":"self"}' &&
      dec(['content_manager'], 'loyalty.redemption.reverse', {
        actorUid: uid('cm'),
        subject: s(MARTIN),
        receiptUndo: true,
      }) === '{"kind":"absent"}',
  );
  // the callable's path end to end: receiptUndoOf on the doc read in the transaction feeds the probe, decide() rules
  const USED: Redemption = {
    ...RDM_DOC,
    state: {
      kind: 'used',
      grant: { kind: 'couponGrant', id: cg('cg_0812_beard') },
      usedAt: t('2026-08-12T07:33:00.000Z'),
    },
  };
  const undoBy = (who: UserId, at: string, doc: Redemption = RDM_DOC) =>
    decide(
      rolesOf(who),
      capabilityFor({ kind: 'redemption.reverse', redemptionId: RDM }),
      {
        actorUid: who,
        subject: s(MARTIN),
        ageDays: 0,
        receiptUndo: receiptUndoOf(doc, who, t(at), pol) === 'admitted',
      },
    ).kind;
  check(
    'R6 end to end: Нико undoes his own on-behalf redemption inside undoWindowMinutes while the grant is unused, and not after (nor once it is used); Мария reverses it under her own grant',
    undoBy(NIKO, '2026-08-12T07:31:00.000Z') === 'allowed' &&
      undoBy(NIKO, '2026-08-12T07:40:00.000Z') === 'allowed' &&
      undoBy(NIKO, '2026-08-12T07:40:01.000Z') === 'absent' &&
      undoBy(NIKO, '2026-08-12T07:35:00.000Z', USED) === 'absent' &&
      undoBy(MARIA, '2026-08-12T08:00:00.000Z') === 'allowed',
  );

  // P2: every guard doc is READ inside the transaction first; present → the duplicate branch, absent → create()
  const guarded = <T>(
    store: Map<string, T>,
    id: string,
    write: () => T,
  ): { readonly branch: 'created' | 'duplicate'; readonly doc: T } => {
    const stored = store.get(id); // tx.get(guardRef): the only dedupe path
    if (stored !== undefined) return { branch: 'duplicate', doc: stored };
    const doc = write();
    store.set(id, doc); // tx.create(guardRef, doc): absent, so no ALREADY_EXISTS aborts the commit
    return { branch: 'created', doc };
  };
  let written = 0;
  const adjustments = new Map<string, Adjustment>();
  const redemptions = new Map<string, Redemption>();
  const firstC1 = guarded(adjustments, ADJ_C1_ID, () => {
    written += 1;
    return ADJ_C1;
  });
  const retryC1 = guarded(adjustments, ADJ_C1_ID, () => {
    written += 1;
    return { ...ADJ_C1, committedAt: t('2026-09-16T07:05:09.000Z') };
  });
  const firstRdm = guarded(redemptions, RDM, () => {
    written += 1;
    return RDM_DOC;
  });
  const retryRdm = guarded(redemptions, RDM, () => {
    written += 1;
    return USED;
  });
  check(
    'P2: a retried commitAdjustment or redeemReward reads its request-id guard present and returns the stored result; nothing is written twice',
    firstC1.branch === 'created' &&
      retryC1.branch === 'duplicate' &&
      retryC1.doc.committedAt === ADJ_C1.committedAt &&
      retryC1.doc.resultingEntryIds.join() === M(23).id &&
      firstRdm.branch === 'created' &&
      retryRdm.branch === 'duplicate' &&
      retryRdm.doc.state.kind === 'active' &&
      written === 2,
  );
  // sec-06 §6.7: reward.reinstate names a coupon grant or one recorded gift-voucher draw (`${appointmentId}#${index}`); a perk or a cosmetic is never reinstated
  const REINSTATE_DRAW = {
    kind: 'reward.reinstate',
    ref: { kind: 'giftVoucher', id: 'gv_0901_50eur' as GiftVoucherId },
    drawId: `${A0910}#0`,
  } as const;
  // @ts-expect-error — a perk is not a reinstatable RewardRef
  const NOT_REINSTATABLE: Parameters<typeof capabilityFor>[0] = {
    kind: 'reward.reinstate',
    ref: { kind: 'perk', perkId: 'perk.freeReschedule' },
  };
  check(
    '§6.7: reward.reinstate carries a coupon grant or a voucher draw, gated by loyalty.reward.reinstate',
    capabilityFor(REINSTATE_DRAW) === 'loyalty.reward.reinstate' &&
      NOT_REINSTATABLE.kind === 'reward.reinstate' &&
      /^[^#]+#\d+$/.test(REINSTATE_DRAW.drawId) &&
      capabilityFor({
        kind: 'reward.reinstate',
        ref: { kind: 'couponGrant', id: cg('cg_0812_beard') },
      }) === 'loyalty.reward.reinstate',
  );
  // The sec-03 §3.6.3 addendum: the redemption, profile, bulk, claim and B6 rows type-check as SupportAuditAction.
  const R45_ADDENDUM: readonly SupportAuditAction[] = [
    'support.reward_redeemed',
    'support.profile_updated',
    'support.bulk_scheduled',
    'support.bulk_cancelled',
    'support.bulk_executed',
    'support.bulk_reversed',
    'support.claim_submitted',
    'support.claim_resolved',
    'support.rhythm_protected',
  ];
  check(
    'R45: audit actions',
    auditActionOf('points.credit') === 'support.points_credit' &&
      auditActionOf('pause.apply') === 'support.pause_apply' &&
      auditActionOf('visit.outcome') === 'support.visit_outcome' &&
      auditActionOf('client.merge') === 'support.client_merge' &&
      new Set(R45_ADDENDUM).size === 9,
  );

  // reasons, request ids, overdraw
  const ALL_ADJ = [ADJ_P0_REC, ADJ_B, ADJ_C1, ADJ_C2, ADJ_D];
  for (const a of ALL_ADJ)
    check(
      `${a.id}: reason allowed for ${a.input.kind}`,
      REASONS_BY_KIND[a.input.kind].includes(a.reason.code),
    );
  check(
    'R49: pause.apply offers no client_request',
    !REASONS_BY_KIND['pause.apply'].includes('client_request'),
  );
  for (const id of [
    ADJ_P0,
    ADJ_P,
    ADJ_P_EDIT,
    ADJ_B_ID,
    ADJ_C1_ID,
    ADJ_C2_ID,
    ADJ_D_ID,
    REPLAY_REQ,
    RDM,
  ])
    check(`${id}: a request id (F2)`, isRequestId(id));
  check(
    'all adjustment entries exist',
    ALL_ADJ.every((a) =>
      a.resultingEntryIds.every((id) => MARTIN_LEDGER.some((e) => e.id === id)),
    ),
  );
  check(
    'T2: only a correction may overdraw',
    mayOverdraw({ kind: 'correction', adjustmentId: ADJ_C2_ID }) &&
      !mayOverdraw({ kind: 'manual', adjustmentId: ADJ_C1_ID }) &&
      !mayOverdraw({ kind: 'redemption', redemptionId: RDM }),
  );
  return checks;
}

const passed = runChecks();
console.log(`examples.ts: ${passed} checks passed`);
