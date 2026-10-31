// Phase 4b (2026-10) — read CLAUDE.md Laws 1–9 for the current shape. libs/domain/* and libs/application/* were deleted in Phase 4b; links and paths into them below are dead history.
// Pre-Law-6/7 shapes (`kind` discriminators, ISO-string instants, a local Brand): never copy a type from this file — the live shapes are libs/ecs-core's.
/**
 * Client details — data model (spec §9), grown with the achievements read model of
 * `client-card-redesign.md` §4: medal families and seasons, per-client progress, and the pure standing services
 * the staff card draws with (their wire shapes: `libs/application/engagement/src/lib/ports/loyalty-document.ts`).
 * Self-contained: every repo type it needs is mirrored locally with a pointer to its source. House conventions
 * kept: nominal brands, `Result` instead of throw, flat discriminated unions by `kind`, no TS `namespace`. Wire choices for the NEW collections:
 * instants are UTC ISO strings (auditLog precedent), shop-calendar dates are Europe/Sofia
 * `YYYY-MM-DD`, money is integer EUR minor units. Native Timestamps only where the rules must pin
 * `request.time` (`clientNotes.writtenAt`) or TTL reads them (`purgeAt`).
 */

// ── Kernel stand-ins ─────────────────────────────────────────────────────────
declare const brand: unique symbol;
/** libs/domain/kernel/src/lib/brand.ts:9-11 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
/** libs/domain/kernel/src/lib/result.ts:25 (reduced to a plain union) */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const fail = <const E>(error: E): Result<never, E> => ({ ok: false, error });

type S<B extends string> = Brand<string, B>;
export type UserId = S<'UserId'>;
export type RuleId = S<'RuleId'>;
export type ProgramId = S<'RewardProgramId'>;
export type StreakId = S<'StreakId'>;
export type TierId = S<'TierId'>;
export type RewardId = S<'RewardId'>;
export type CouponId = S<'CouponId'>;
export type CouponGrantId = S<'CouponGrantId'>;
export type GiftVoucherId = S<'GiftVoucherId'>;
export type AppointmentId = S<'AppointmentId'>;
export type SeatId = S<'SeatId'>;
export type BarberId = S<'BarberId'>;
export type ServiceId = S<'ServiceId'>;
export type JournalEntryId = S<'JournalEntryId'>;
export type AdjustmentId = S<'AdjustmentId'>;
export type PauseId = S<'PauseId'>;
export type RedemptionId = S<'RedemptionId'>;
export type LoyaltyEventId = S<'LoyaltyEventId'>;
export type AwardKey = S<'AwardKey'>;
export type IdempotencyKey = S<'IdempotencyKey'>;
export type CorrelationId = S<'CorrelationId'>;
export type ChoiceId = S<'ChoiceId'>;
export type TagId = S<'ClientTagId'>;
export type LocationId = S<'LocationId'>;
/** client-card-redesign §4.1: the achievements catalogue's ids (the CouponId pattern in libs/domain/engagement ids.ts). */
export type BadgeCategoryId = S<'BadgeCategoryId'>;
export type BadgeSeriesId = S<'BadgeSeriesId'>;
export type SeasonId = S<'SeasonId'>;
/** A client-minted request id (F2): the doc id of the adjustment, redemption, replay event and audit row it creates. */
export type RequestId = S<'RequestId'>;
/** Opaque CAS token over every doc a cascade reads, e.g. `acct:v18|stats:v13|pause:v3|appt:r2`. */
export type StateVersion = S<'StateVersion'>;
export type IsoInstant = S<'IsoInstant'>; // 2026-09-15T07:05:00.000Z
export type IsoDate = S<'IsoDate'>; // 2026-09-15, Europe/Sofia calendar
/** Native Firestore Timestamp. */
export interface FirestoreTimestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
}
export interface LocalizedText {
  readonly bg: string;
  readonly en: string;
}

// ── Mirrors of existing vocabulary ───────────────────────────────────────────
/** libs/domain/accounts/src/lib/user-role.ts:18-24 */
export type UserRole =
  | 'client'
  | 'barber'
  | 'receptionist'
  | 'content_manager'
  | 'admin'
  | 'sysadmin';
/** user-role.ts:44-50 — a subject holding one is implicitly staffRelated (R40). */
export const STAFF_ROLES: readonly UserRole[] = [
  'barber',
  'receptionist',
  'content_manager',
  'admin',
  'sysadmin',
];
/** libs/domain/accounts/src/lib/block-reason.ts:9-10 */
export type BlockReason =
  'excessive_failed_attempts' | 'terms_violation' | 'fraud_suspect' | 'manual';
/** libs/domain/scheduling/src/lib/seat-outcome.ts:129-138 (kinds only) */
export type SeatOutcomeKind = 'scheduled' | 'worked' | 'no_show' | 'cancelled';
/** seat-outcome.ts:29-38. `no_show_converted` is stamped by the correction edge, never picked. */
export type CancellationReason =
  | {
      readonly kind:
        | 'client_changed_plans'
        | 'client_unwell'
        | 'staff_barber_absence'
        | 'staff_shop_closure'
        | 'no_show_converted'
        | 'unspecified';
    }
  | { readonly kind: 'other'; readonly note: string };
/** One seat (one service of one person) of one appointment — the unit an outcome correction names. */
export interface SeatRef {
  readonly appointmentId: AppointmentId;
  readonly seatId: SeatId;
}
/** libs/domain/notifications/src/lib/notification.ts:26-36 + R31 (in-app only; a closed union, each kind needs glyph + copy). */
export type NotificationKind =
  | 'appointment_reminder'
  | 'appointment_changed'
  | 'waitlist_match'
  | 'reward_granted'
  | 'announcement'
  | 'approval_requested'
  | 'approval_decided'
  | 'support_digest'
  | 'loyalty_corrected'
  | 'claim_resolved';

/** governance Actor (actor.ts:22-57) + `staff`: a non-admin staff caller with its roles AT THE TIME.
 *  auditLog.actor, clientJournal.actor, adjustments.actor, clientPauses.appliedBy. */
export type Actor =
  | { readonly kind: 'system'; readonly source: string }
  | { readonly kind: 'user'; readonly userId: UserId }
  | {
      readonly kind: 'staff';
      readonly userId: UserId;
      readonly roles: readonly UserRole[];
    }
  | { readonly kind: 'admin'; readonly adminUserId: UserId }
  | {
      readonly kind: 'impersonator';
      readonly adminUserId: UserId;
      readonly targetUserId: UserId;
      readonly sessionId: string;
      readonly scope: 'read' | 'write';
    };
/** Callable attribution (spine §5): admin in the role set → `admin`; other staff → `staff` + roles snapshot. */
export function actorForCaller(uid: UserId, roles: readonly UserRole[]): Actor {
  if (roles.includes('admin')) return { kind: 'admin', adminUserId: uid };
  return roles.some((r) => r !== 'client')
    ? { kind: 'staff', userId: uid, roles }
    : { kind: 'user', userId: uid };
}

// ── Rule grammar (loyaltyRules/{ruleId} + versions/{v}) ──────────────────────
/** Closed, code-level metric registry — adding a METRIC is code; composing RULES is data. */
export type Metric =
  | 'client.visits.completed' // VISITS whose subject is the client: its worked seats in one appointment count once (R33)
  | 'client.bookings.selfService'
  | 'client.spend.major'
  | 'client.referrals.completed'
  | 'client.waitlist.booked'
  | 'client.points.lifetime' // = LoyaltyAccount.lifetimeEarned: manual points never count (R40)
  | 'shop.bookings.created' // the transactional shop-wide ordinal carried on booking.created
  // client-card-redesign §4.1: what the medal families count
  | 'client.services.distinct'
  | 'client.barbers.distinct'
  | 'client.locations.distinct'
  | 'client.months.distinct' // Europe/Sofia calendar months with a worked visit
  | 'client.visits.earlyBird' // worked visits starting by 10:00
  | 'client.visits.weekend' // worked visits on the shop's weekend day (Saturday; Sundays are closed)
  | 'client.visits.onTime' // worked visits with arrivedAt ≤ the start
  | 'client.visits.party' // worked visits booked with company
  | 'client.tenure.days'; // days since the first worked visit: calendar-driven, no visit moves it
/** `where` narrows a visit count to one service, barber or location (§4.1). A season's families count inside the
 *  season's window, so they carry no `window` of their own. */
export interface MetricRef {
  readonly metric: Metric;
  readonly window?: { readonly lastDays: number };
  readonly where?: {
    readonly serviceId?: ServiceId;
    readonly barberId?: BarberId;
    readonly locationId?: LocationId;
  };
}
export type ComparisonOp = 'gte' | 'gt' | 'eq' | 'lte' | 'lt';
export type EventField = 'channel' | 'spendMinor' | 'serviceIds' | 'outcomeTo';
export type ProfileField = 'email' | 'birthDate' | 'avatar';

/** Composable condition (spine §8). `within` re-windows every metric below it to the last `days`. */
export type Condition =
  | { readonly kind: 'always' }
  | { readonly kind: 'allOf' | 'anyOf'; readonly of: readonly Condition[] }
  | { readonly kind: 'not'; readonly of: Condition }
  | {
      readonly kind: 'threshold';
      readonly metric: MetricRef;
      readonly op: ComparisonOp;
      readonly value: number;
    }
  | {
      readonly kind: 'everyNth';
      readonly metric: MetricRef;
      readonly n: number;
    }
  | {
      readonly kind: 'streak';
      readonly streakId: StreakId;
      readonly atLeast: number;
    }
  | {
      readonly kind: 'within';
      readonly days: number;
      readonly condition: Condition;
    }
  | {
      readonly kind: 'event';
      readonly field: EventField;
      readonly op: 'eq' | 'gte' | 'lte' | 'includes';
      readonly value: string | number;
    }
  | {
      readonly kind: 'referral';
      readonly role: 'inviter' | 'referee';
      readonly refereeCondition: Condition;
    }
  | {
      readonly kind: 'profile';
      readonly field: ProfileField;
      readonly present: boolean;
    }
  | {
      readonly kind: 'date';
      readonly match:
        | { readonly kind: 'birthday' }
        | {
            readonly kind: 'monthDay';
            readonly month: number;
            readonly day: number;
          };
    }
  | { readonly kind: 'tier'; readonly atLeast: TierId };

/** What happened — one arm per trigger family, so the engine can only read a fact its kind carries. */
export type TriggerEvent =
  | {
      readonly kind:
        | 'account.registered'
        | 'account.firstSignIn'
        | 'account.profileCompleted'
        | 'calendar.daily'
        | 'waitlist.joined'
        | 'waitlist.booked';
    }
  | {
      readonly kind: 'booking.created';
      readonly channel: 'selfService' | 'staff';
      readonly shopOrdinal: number;
    }
  | {
      readonly kind:
        | 'visit.completed'
        | 'visit.noShow'
        | 'visit.cancelled'
        | 'visit.outcomeCorrected';
      readonly appointmentId: AppointmentId;
      readonly seatId: SeatId;
      readonly outcomeFrom: SeatOutcomeKind;
      readonly outcomeTo: SeatOutcomeKind;
      readonly spendMinor: number;
      readonly serviceIds: readonly ServiceId[];
    }
  | {
      readonly kind: 'referral.redeemed' | 'referral.refereeVisitCompleted';
      readonly inviterUserId: UserId;
      readonly refereeUserId: UserId;
    }
  | {
      readonly kind: 'streak.extended';
      readonly streakId: StreakId;
      readonly current: number;
    };
/** A rule subscribes to event kinds; `rule.replay` opts it into «Обработи отново» (a replay re-delivers the
 *  ORIGINAL event arm, marked by `Trigger.replayOf`; no event is ever of kind rule.replay). */
export type TriggerKind = TriggerEvent['kind'] | 'rule.replay';
/** loyaltyEvents/{eventId} — the engine inbox. Id = `appt_<id>_seat_<seatId>_<verb>_r<revision>` for a seat fact
 *  (spine §6), `replay_${requestId}` for a replay (R45), else the fact key. Compensations never emit one (R29). */
export interface Trigger {
  readonly id: LoyaltyEventId;
  readonly userId: UserId;
  /** Stable business key; `perEvent` keys on THIS (R28): `appt:<id>:seat:<seatId>` (seatFactKey), `reg:<uid>`, `cal:<date>:<uid>`. */
  readonly factKey: string;
  readonly at: IsoInstant;
  readonly localDate: IsoDate;
  readonly event: TriggerEvent;
  /** replayRule (R45): gated by loyalty.replay, idempotent (the award keys are the original's), no undo. */
  readonly replayOf: {
    readonly eventId: LoyaltyEventId;
    readonly requestId: RequestId;
    readonly by: Actor;
    readonly reason: 'system_fault' | 'missed_award';
  } | null;
  /** P2: the engine transaction READS this doc and every award guard first. `duplicate` = every guard it reached
   *  already existed, so nothing but this mark was written; null while unprocessed. */
  readonly processedAt: IsoInstant | null;
  readonly outcome: 'applied' | 'duplicate' | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly purgeAt: FirestoreTimestamp; // TTL 90 days (F6: bookkeeping)
}

export type PerkId =
  'perk.priorityWaitlist' | 'perk.bookFurtherAhead' | 'perk.freeReschedule';
/** Closed domain ids, mapped to icon keys in the feature — no icon key is ever persisted (§10). */
export type CosmeticId = 'frame.welcome';
export type BadgeEmblem =
  | 'visits'
  | 'streak'
  | 'referral'
  | 'selfService'
  | 'birthday'
  | 'welcome'
  // client-card-redesign §4.1: the families' and seasons' emblems (icon keys `loyalty.badge.<emblem>`, §8.2)
  | 'service'
  | 'barber'
  | 'shop'
  | 'anniversary'
  | 'earlyBird'
  | 'weekend'
  | 'onTime'
  | 'waitlist'
  | 'profile'
  | 'party'
  | 'explorer'
  // one face per family (client-card-redesign §3.3.3): rhythm and season families never borrow `streak` / `season`
  | 'yearRound'
  | 'comeback'
  | 'seasonMonthly'
  | 'vacation'
  | 'season'
  | 'event';
/** What a rule pays (Reward grown into Award; reward.ts:14-24). */
export type Award =
  | {
      readonly kind: 'points';
      readonly amount:
        | { readonly kind: 'fixed'; readonly points: number }
        | { readonly kind: 'perSpend'; readonly pointsPerMajor: number };
    }
  | { readonly kind: 'coupon'; readonly couponId: CouponId }
  | {
      readonly kind: 'voucher';
      readonly amountMinor: number;
      readonly expiresInDays: number;
    }
  | {
      readonly kind: 'tierGrant';
      readonly tierId: TierId;
      readonly forDays: number;
    }
  | {
      readonly kind: 'perk';
      readonly perkId: PerkId;
      readonly forDays: number | null;
    }
  | {
      readonly kind: 'streakFreeze';
      readonly streakId: StreakId;
      readonly count: number;
    }
  | { readonly kind: 'cosmetic'; readonly cosmeticId: CosmeticId };
export type Recurrence =
  | { readonly kind: 'once' | 'perEvent' | 'perReferee' }
  | { readonly kind: 'perOccurrence' } // requires exactly one everyNth node
  | { readonly kind: 'perPeriod'; readonly period: 'year' | 'month' };

/** A rule with `badge` IS a badge (recorded deviation: badge = presentation of an achievement).
 *  Every badge is always shown with its requirement — no hidden state (B3). Since client-card-redesign §4 the card
 *  draws the catalogue's `BadgeSeries`: a family whose every level names the once-rule that awards it
 *  (`BadgeLevel.ruleId`); this spec stays the rule's own summary. */
export interface BadgeSpec {
  readonly emblem: BadgeEmblem;
  readonly title: LocalizedText;
  readonly requirement: LocalizedText; // the exact requirement, shown while locked
  readonly progress: {
    readonly metric: MetricRef;
    readonly target: number;
  } | null; // «3 от 10» + meter
  readonly order: number;
}
export interface RuleBody {
  readonly programId: ProgramId | null; // RewardProgram stays the container
  readonly name: LocalizedText;
  readonly scope: 'client' | 'shop'; // shop = one winner per occurrence across the shop
  readonly triggers: readonly TriggerKind[];
  readonly condition: Condition;
  readonly awards: readonly Award[];
  readonly recurrence: Recurrence;
  readonly badge: BadgeSpec | null;
  readonly manualGrantable: boolean; // loyalty.achievement.grant may issue it (once-rules only)
}
export type RuleLifecycle =
  | { readonly kind: 'draft' }
  | {
      readonly kind: 'published';
      readonly version: number;
      readonly publishedAt: IsoInstant;
      readonly publishedBy: Actor;
    }
  | {
      readonly kind: 'retired';
      readonly lastVersion: number;
      readonly retiredAt: IsoInstant;
      readonly retiredBy: Actor;
    };
/** loyaltyRules/{ruleId} — header + editable draft. */
export interface LoyaltyRule {
  readonly id: RuleId;
  readonly lifecycle: RuleLifecycle;
  readonly draft: RuleBody | null;
  readonly updatedAt: IsoInstant;
}
/** loyaltyRules/{ruleId}/versions/{v} — immutable; journal entries cite ruleId@version. A version that changes
 *  earning or expiry takes effect at `effectiveFrom` ≥ publish + loyaltyPolicy.ruleChangeNoticeDays (R29). */
export interface RuleVersion {
  readonly ruleId: RuleId;
  readonly version: number;
  readonly body: RuleBody;
  readonly publishedAt: IsoInstant;
  readonly publishedBy: Actor;
  readonly effectiveFrom: IsoInstant;
}
export interface RuleRef {
  readonly ruleId: RuleId;
  readonly version: number;
}

/** `triggerCycle` is set by publishRule's check over the whole published set (R29), not by validateRuleBody. */
export type RuleProblem =
  | 'noTriggers'
  | 'emptyRule'
  | 'perOccurrenceNeedsEveryNth'
  | 'badNth'
  | 'windowedEveryNth'
  | 'shopScopeMismatch'
  | 'shopRuleIsBadge'
  | 'badgeNeedsOnce'
  | 'perRefereeNeedsReferral'
  | 'manualGrantNeedsOnce'
  | 'triggerCycle';
function nodesOf(c: Condition): readonly Condition[] {
  switch (c.kind) {
    case 'allOf':
    case 'anyOf':
      return [c, ...c.of.flatMap(nodesOf)];
    case 'not':
      return [c, ...nodesOf(c.of)];
    case 'within':
      return [c, ...nodesOf(c.condition)];
    case 'referral':
      return [c, ...nodesOf(c.refereeCondition)];
    default:
      return [c];
  }
}
/** Publish-time validation of one body (rules.publish refuses a body with problems). */
export function validateRuleBody(b: RuleBody): readonly RuleProblem[] {
  const nodes = nodesOf(b.condition);
  const nths = nodes.flatMap((c) => (c.kind === 'everyNth' ? [c] : []));
  const metrics = nodes.flatMap((c) =>
    c.kind === 'threshold' || c.kind === 'everyNth' ? [c.metric.metric] : [],
  );
  const out: RuleProblem[] = [];
  if (b.triggers.length === 0) out.push('noTriggers');
  if (b.awards.length === 0 && b.badge === null) out.push('emptyRule');
  if (b.recurrence.kind === 'perOccurrence' && nths.length !== 1)
    out.push('perOccurrenceNeedsEveryNth');
  if (nths.some((c) => !Number.isInteger(c.n) || c.n < 2)) out.push('badNth');
  // a windowed count falls and climbs back, so its multiples repeat and the occurrence key would be ambiguous
  const underWithin = nodes.flatMap((c) =>
    c.kind === 'within' ? nodesOf(c.condition) : [],
  );
  if (
    nths.some((c) => c.metric.window !== undefined || underWithin.includes(c))
  )
    out.push('windowedEveryNth');
  if ((b.scope === 'shop') !== metrics.some((m) => m.startsWith('shop.')))
    out.push('shopScopeMismatch');
  if (b.scope === 'shop' && b.badge !== null) out.push('shopRuleIsBadge'); // B3: a shop-wide celebration is a thank-you, never a badge
  // P4: one medal per rule, earned under the `once` key; a recurring payout that also wants a medal pairs with its own once-rule
  if (b.badge !== null && b.recurrence.kind !== 'once')
    out.push('badgeNeedsOnce');
  if (
    b.recurrence.kind === 'perReferee' &&
    !nodes.some((c) => c.kind === 'referral')
  )
    out.push('perRefereeNeedsReferral');
  if (b.manualGrantable && b.recurrence.kind !== 'once')
    out.push('manualGrantNeedsOnce');
  return out;
}

/** awards/{awardKey} — exactly-once (P2): the transaction READS the key first; absent → create(), present → a
 *  granted ⇄ revoked CAS flip or a no-op, never a second doc (R28). create() is only the race backstop: its
 *  ALREADY_EXISTS aborts the whole commit, so it is never the dedupe path. A manual `missed_award` credit writes
 *  the rule's own key (`via: manual`). */
export interface AwardRecord {
  readonly key: AwardKey;
  readonly rule: RuleRef;
  readonly userId: UserId;
  readonly occurrenceKey: string;
  readonly state:
    | {
        readonly kind: 'granted';
        readonly at: IsoInstant;
        readonly via: 'rule' | 'manual';
        readonly adjustmentId: AdjustmentId | null;
      }
    | {
        readonly kind: 'revoked';
        readonly at: IsoInstant;
        readonly adjustmentId: AdjustmentId;
      };
  readonly eventId: LoyaltyEventId | null;
  readonly entryIds: readonly JournalEntryId[];
}
/** explainRule(ruleId, userId) — the «Защо?» trace; offer = replay when met but not issued, never a manual grant. */
export interface RuleExplanation {
  readonly rule: RuleRef;
  readonly userId: UserId;
  readonly evaluatedAt: IsoInstant;
  readonly asOfEventId: LoyaltyEventId | null;
  readonly met: boolean;
  readonly trace: readonly {
    readonly path: string;
    readonly kind: Condition['kind'];
    readonly met: boolean;
    readonly actual: number | string | null;
    readonly required: number | string | null;
  }[];
  readonly awardKey: AwardKey | null;
  readonly issued: boolean;
  readonly offer: 'replay' | 'none';
}

// ── Streaks, tiers, catalogue ────────────────────────────────────────────────
/** Shop-caused gaps (A5): never counted against the client, logged with the reason. */
export type StreakExcuse = 'shopClosure' | 'barberAbsence' | 'staffCancelled';
/** streakDefinitions/{streakId} — «Посещения в ритъм». Projections pin `version` (R29). */
export interface StreakDefinition {
  readonly id: StreakId;
  readonly name: LocalizedText;
  readonly version: number;
  readonly effectiveFrom: IsoInstant;
  readonly cadence:
    | { readonly kind: 'rollingDays'; readonly days: number }
    | {
        readonly kind: 'calendar';
        readonly unit: 'month';
        readonly every: number;
      };
  readonly graceDays: number;
  readonly riskLeadDays: number;
  readonly freezes: {
    readonly maxBanked: number;
    readonly earnEvery: number;
    readonly autoApply: boolean;
  }; // UI word «защита»
  /** R19: the earn-back is automatic — the first worked visit within `windowDays` of the break restores the
   *  rhythm, at most `perYear` times per 12 months; the staff `streak.repair` exists for faults. */
  readonly repair: { readonly windowDays: number; readonly perYear: number };
  readonly excused: readonly StreakExcuse[];
}
export type StreakPhase =
  | { readonly kind: 'active' }
  | { readonly kind: 'atRisk'; readonly dueBy: IsoDate } // coaching for staff; the client sees «Време е за следващото подстригване» at most
  | { readonly kind: 'inGrace'; readonly graceUntil: IsoDate }
  | {
      readonly kind: 'frozen';
      readonly until: IsoDate;
      readonly reason: 'freeze' | 'pause' | 'clientPause';
    } // clientPause = B6 (P5)
  | {
      readonly kind: 'broken';
      readonly brokenAt: IsoDate;
      readonly repairableUntil: IsoDate;
    };
/** loyaltyAccounts/{uid}.streaks[id] — a PROJECTION recomputed from visit facts + manual streak entries. */
export interface StreakState {
  readonly streakId: StreakId;
  readonly definitionVersion: number;
  readonly phase: StreakPhase;
  readonly current: number;
  readonly best: number;
  readonly lastQualifiedAt: IsoInstant | null;
  readonly dueBy: IsoDate | null;
  readonly freezesBanked: number;
}
/** tierDefinitions/{tierId} */
export interface TierDefinition {
  readonly id: TierId;
  readonly name: LocalizedText;
  readonly rank: number;
  readonly benefits: readonly PerkId[];
  readonly version: number;
  readonly effectiveFrom: IsoInstant;
  readonly qualify: {
    readonly metric: Metric;
    readonly atLeast: number;
    readonly window: { readonly lastDays: number };
  };
}
/** loyaltyAccounts/{uid}.tier — computed; qualifying is counted in VISITS, never mixed with points (A1). */
export interface TierState {
  readonly current: TierId;
  readonly definitionVersion: number;
  readonly since: IsoInstant;
  readonly qualifying: number;
  readonly next: TierId | null;
  readonly remaining: number | null;
  readonly override: {
    readonly tierId: TierId;
    readonly until: IsoDate | null;
    readonly source:
      | { readonly kind: 'award'; readonly awardKey: AwardKey }
      | { readonly kind: 'adjustment'; readonly adjustmentId: AdjustmentId };
  } | null;
}
/** rewardsCatalog/{rewardId} — admin-edited; `redeemedCount` is kept inside the redemption transaction, so the
 *  item doc serialises its `total` stock. The redeemed grant's expiry comes from what it mints. */
export interface RewardCatalogItem {
  readonly id: RewardId;
  readonly name: LocalizedText;
  readonly cost: number;
  readonly enabled: boolean;
  readonly order: number;
  readonly grants: Extract<Award, { kind: 'coupon' | 'voucher' | 'perk' }>;
  readonly available: {
    readonly from: IsoDate | null;
    readonly until: IsoDate | null;
  }; // Europe/Sofia, inclusive
  readonly limits: {
    readonly perClient: {
      readonly count: number;
      readonly windowDays: number;
    } | null;
    readonly total: number | null;
  };
  readonly redeemedCount: number;
}
export type RedeemProblem =
  | 'disabled'
  | 'notYetAvailable'
  | 'ended'
  | 'soldOut'
  | 'paused'
  | 'insufficientPoints'
  | 'perClientLimit';
const DAY_MS = 86_400_000;
const dayNumber = (d: IsoDate): number =>
  Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
/** One of the client's non-reversed redemptions, as the per-client limit counts it. */
export interface RedemptionRecord {
  readonly rewardId: RewardId;
  readonly on: IsoDate;
}
/** The one redeem gate (callable authoritative, UI decides the lock line). `recent` = the client's non-reversed redemptions. */
export function redeemProblem(
  item: RewardCatalogItem,
  input: {
    readonly balance: number;
    readonly today: IsoDate;
    readonly paused: boolean;
    readonly recent: readonly RedemptionRecord[];
  },
): RedeemProblem | null {
  if (!item.enabled) return 'disabled';
  if (item.available.from !== null && input.today < item.available.from)
    return 'notYetAvailable';
  if (item.available.until !== null && input.today > item.available.until)
    return 'ended';
  if (item.limits.total !== null && item.redeemedCount >= item.limits.total)
    return 'soldOut';
  if (input.paused) return 'paused'; // spine §7: no redemption while paused; earning continues
  if (input.balance < item.cost) return 'insufficientPoints'; // an owed (negative) balance never redeems
  const per = item.limits.perClient;
  if (per !== null) {
    const inWindow = input.recent.filter(
      (r) =>
        r.rewardId === item.id &&
        dayNumber(input.today) - dayNumber(r.on) < per.windowDays,
    );
    if (inWindow.length >= per.count) return 'perClientLimit';
  }
  return null;
}
export type RewardRef =
  | { readonly kind: 'couponGrant'; readonly id: CouponGrantId }
  | { readonly kind: 'giftVoucher'; readonly id: GiftVoucherId }
  | { readonly kind: 'perk'; readonly perkId: PerkId }
  | { readonly kind: 'cosmetic'; readonly cosmeticId: CosmeticId };
/** redemptions/{requestId} — owner + book read, server write. The guard is READ first (F2, P2): present → a retry, the
 *  stored `state` returns; absent → create(). On behalf only on today's live visit whose seat holds the subject (R6);
 *  its receipt's undo works while the grant is unused, within undoWindowMinutes (receiptUndoOf). */
export interface Redemption {
  readonly id: RedemptionId;
  readonly userId: UserId;
  readonly rewardId: RewardId;
  readonly cost: number;
  readonly by: Actor;
  readonly channel: 'self' | 'onBehalf';
  readonly at: IsoInstant;
  /** A closed code on this owner-readable doc — never staff free text (T5), never an AppointmentId. */
  readonly context: 'selfView' | 'visitSheet';
  readonly state:
    | {
        readonly kind: 'active';
        readonly grant: RewardRef;
        readonly expiresAt: IsoInstant | null;
      }
    | {
        readonly kind: 'used';
        readonly grant: RewardRef;
        readonly usedAt: IsoInstant;
      }
    | {
        readonly kind: 'expired';
        readonly grant: RewardRef;
        readonly expiredAt: IsoInstant;
      } // journaled (redemption.expired), never silent
    | {
        readonly kind: 'reversed';
        readonly at: IsoInstant;
        readonly adjustmentId: AdjustmentId;
      };
  readonly entryIds: readonly JournalEntryId[];
}
/** settings/loyaltyPolicy — public read, written by publishRule only. The earn rate is a rule (`earn-per-euro`), not policy. */
export interface LoyaltyPolicy {
  /** B4's rule, modelled and OFF at launch (R30): client copy «Точките не изтичат» while in-app is the only channel. */
  readonly expiry: {
    readonly enabled: boolean;
    readonly afterMonthsWithoutVisit: number;
    readonly noticeDays: number;
  };
  readonly defaultCadenceDays: number; // R34: the due cue before a client has 3 visits
  readonly ruleChangeNoticeDays: number; // R29: effectiveFrom ≥ publish + this (§13 Q21)
}
export const DEFAULT_LOYALTY_POLICY: LoyaltyPolicy = {
  expiry: { enabled: false, afterMonthsWithoutVisit: 12, noticeDays: 30 },
  defaultCadenceDays: 28,
  ruleChangeNoticeDays: 30,
};
/** LoyaltyAccount.pointsExpiry — null when expiry is off (R30) or nothing can lapse (no visit yet, nothing positive held). */
export function pointsExpiryOf(
  lastVisitOn: IsoDate | null,
  balance: number,
  policy: LoyaltyPolicy = DEFAULT_LOYALTY_POLICY,
): { readonly expiresOn: IsoDate; readonly noticeFrom: IsoDate } | null {
  if (!policy.expiry.enabled || lastVisitOn === null || balance <= 0)
    return null;
  const [y, m, d] = lastVisitOn.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const months = m - 1 + policy.expiry.afterMonthsWithoutVisit;
  const lastDay = new Date(
    Date.UTC(y + Math.floor(months / 12), (months % 12) + 1, 0),
  ).getUTCDate(); // clamp 31 → 30/28
  const expires = new Date(
    Date.UTC(y + Math.floor(months / 12), months % 12, Math.min(d, lastDay)),
  );
  const notice = new Date(
    expires.getTime() - policy.expiry.noticeDays * DAY_MS,
  );
  return {
    expiresOn: expires.toISOString().slice(0, 10) as IsoDate,
    noticeFrom: notice.toISOString().slice(0, 10) as IsoDate,
  };
}
/** loyaltyAccounts/{uid} — projection; owner-read + worksTheBook-read, server-write. Also the per-CLIENT
 *  serialisation point: every write path reads and bumps `seq`, so two transactions on one client never interleave. */
export interface LoyaltyAccount {
  readonly userId: UserId;
  /** balance = Σ points effects = lifetimeEarned + lifetimeAdjusted − lifetimeSpent. Negative only through a
   *  correction's compensation (T2, R27): staff read «Дължи 40 т.», the client the honest figure; never clamped. */
  readonly balance: number;
  readonly lifetimeEarned: number; // rule, migration and system points, net of their reversals; feeds client.points.lifetime
  readonly lifetimeAdjusted: number; // manual points, net of their reversals — never a lifetime metric (R40)
  readonly lifetimeSpent: number; // redemptions, net of their reversals
  readonly tier: TierState;
  readonly streaks: { readonly [streakId: string]: StreakState };
  /** A2 «7/10», titled by what the last stamp pays («Безплатно подстригване»). CHANGED (client-card-redesign
   *  §4.1): no `badges` summary — the card reads the family progress documents (≤ one per family) and derives the
   *  latest and closest levels at read, so the glance and the achievements page can never disagree. */
  readonly punchCards: readonly {
    readonly ruleId: RuleId;
    readonly filled: number;
    readonly size: number;
    readonly title: LocalizedText;
  }[];
  readonly records: readonly PersonalRecord[]; // «Рекорди» (§4.1)
  readonly pointsExpiry: {
    readonly expiresOn: IsoDate;
    readonly noticeFrom: IsoDate;
  } | null; // = pointsExpiryOf(last visit, balance)
  readonly seq: number;
  readonly version: number;
  readonly updatedAt: IsoInstant; // seq = last journal entry folded in
}

// ── Achievements: families, seasons, progress, standing (client-card-redesign.md §4) ──
/** A shelf of «Постижения» (badgeCategories/{id}); `records` holds no families — it is the personal-records rail. */
export type BadgeCategoryKind =
  'milestones' | 'mastery' | 'barbers' | 'rhythm' | 'special' | 'records';
export interface BadgeCategory {
  readonly id: BadgeCategoryId;
  readonly kind: BadgeCategoryKind;
  readonly title: LocalizedText;
  readonly order: number;
}
/** What a level paid, for «донесе …»: a summary of its rule's `awards`, so the card never reads a rule. */
export type AwardSummary =
  | { readonly kind: 'points'; readonly points: number }
  | { readonly kind: 'coupon'; readonly title: LocalizedText }
  | { readonly kind: 'freeze'; readonly count: number }
  | {
      readonly kind: 'perk';
      readonly perkId: PerkId;
      readonly forDays: number | null;
    };
/** The catalogue thing a family is about; its art (the barber's face, the service's or shop's cover) comes from it. */
export type BadgeSubject =
  | { readonly kind: 'service'; readonly serviceId: ServiceId }
  | { readonly kind: 'barber'; readonly barberId: BarberId }
  | { readonly kind: 'location'; readonly locationId: LocationId };
/** One level of a family, drawn «I»…«V». Each level is its own once-rule under its own award key (badgeNeedsOnce
 *  holds per level), so the summary counts LEVELS and a level never pays twice. */
export interface BadgeLevel {
  readonly level: number;
  readonly ruleId: RuleId;
  readonly target: number | null; // on the family's metric; null = a one-off act, then the family's only level
  readonly requirement: LocalizedText; // «25 посещения с фейд»
  readonly awards: readonly AwardSummary[]; // [] = recognition only
}
/** badgeSeries/{id} — ONE medal family, the unit the card draws; it lives in a category or a season. `metric` is null
 *  for a one-off act and for the rhythm family, whose value is the cadence streak's best run, not a registry count. */
export interface BadgeSeries {
  readonly id: BadgeSeriesId;
  readonly categoryId: BadgeCategoryId | null;
  readonly seasonId: SeasonId | null;
  readonly title: LocalizedText; // «Фейд»
  readonly requirement: LocalizedText; // the family's sentence without a figure: «Посещения с фейд»
  readonly emblem: BadgeEmblem;
  readonly subject: BadgeSubject | null;
  readonly metric: MetricRef | null;
  readonly art: { readonly path: string } | null; // owner art in Storage: wins over the subject's art and the emblem
  readonly levels: readonly BadgeLevel[];
  readonly repeatable: boolean; // earned again every year (the birthday visit); then its only level
  readonly order: number;
  readonly retiredAt: IsoInstant | null;
  readonly version: number;
}
export type BadgeSeriesProblem =
  | 'noLevels'
  | 'levelGap'
  | 'targetsNotRising'
  | 'homeless'
  | 'oneOffWithSeveralLevels'
  | 'repeatableWithSeveralLevels';
/** BadgeSeries.create's checks: levels I…n, positive rising targets, a home, a one-off or yearly family has one level. */
export function badgeSeriesProblems(
  s: BadgeSeries,
): readonly BadgeSeriesProblem[] {
  const out: BadgeSeriesProblem[] = [];
  if (s.levels.length === 0) out.push('noLevels');
  if (s.levels.some((l, i) => l.level !== i + 1)) out.push('levelGap');
  const targets = s.levels.flatMap((l) =>
    l.target === null ? [] : [l.target],
  );
  if (targets.some((t, i) => t <= 0 || (i > 0 && t <= (targets[i - 1] ?? 0))))
    out.push('targetsNotRising');
  if (s.categoryId === null && s.seasonId === null) out.push('homeless');
  if (s.levels.length > 1 && s.levels.some((l) => l.target === null))
    out.push('oneOffWithSeveralLevels');
  if (s.repeatable && s.levels.length > 1)
    out.push('repeatableWithSeveralLevels');
  return out;
}
/** Tenure: nothing a visit does moves it, so it never sits in «Скоро». */
export const isCalendarDriven = (s: BadgeSeries): boolean =>
  s.metric?.metric === 'client.tenure.days';

const SOFIA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Sofia',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
/** The Europe/Sofia calendar day of an instant — the day a level was earned, a season was announced. */
export const sofiaDayOf = (at: IsoInstant): IsoDate =>
  SOFIA_DAY.format(new Date(at)) as IsoDate;

/** A season or event on a day (Europe/Sofia, the window inclusive). */
export type SeasonPhase = 'announced' | 'open' | 'ended';
/** seasons/{id} — a named, dated window. A season has a track (the family its gauge draws); an event is a short
 *  window without one. `seriesIds` are the window's other families, in order — never the track. */
export interface Season {
  readonly id: SeasonId;
  readonly kind: 'season' | 'event';
  readonly title: LocalizedText;
  readonly emblem: BadgeEmblem;
  readonly window: { readonly from: IsoDate; readonly until: IsoDate };
  readonly trackSeriesId: BadgeSeriesId | null;
  readonly seriesIds: readonly BadgeSeriesId[];
  readonly announcedAt: IsoInstant;
  readonly version: number;
}
export type SeasonProblem =
  'windowInverted' | 'eventWithTrack' | 'seasonWithoutTrack' | 'announcedLate';
/** Season.create's checks. A season changes what earns, so it is announced ruleChangeNoticeDays ahead (R29). */
export function seasonProblems(
  s: Season,
  policy: LoyaltyPolicy = DEFAULT_LOYALTY_POLICY,
): readonly SeasonProblem[] {
  const out: SeasonProblem[] = [];
  if (s.window.from > s.window.until) out.push('windowInverted');
  if (s.kind === 'event' && s.trackSeriesId !== null)
    out.push('eventWithTrack');
  if (s.kind === 'season' && s.trackSeriesId === null)
    out.push('seasonWithoutTrack');
  if (
    dayNumber(sofiaDayOf(s.announcedAt)) >
    dayNumber(s.window.from) - policy.ruleChangeNoticeDays
  )
    out.push('announcedLate');
  return out;
}
/** Announced — no progress yet, shown «от 1.11»; open; ended — kept in the archive, only its earned families listed. */
export const seasonPhaseOn = (s: Season, today: IsoDate): SeasonPhase =>
  today < s.window.from
    ? 'announced'
    : today > s.window.until
      ? 'ended'
      : 'open';

/** The published catalogue, read and validated as one model (LoyaltyCatalog.create). */
export interface LoyaltyCatalog {
  readonly categories: readonly BadgeCategory[];
  readonly series: readonly BadgeSeries[];
  readonly seasons: readonly Season[];
  readonly tiers: readonly TierDefinition[];
  readonly rewards: readonly RewardCatalogItem[];
  readonly streaks: readonly StreakDefinition[];
}
/** `costNotPositive` spells out §4.1's «costs positive». */
export type LoyaltyCatalogProblem =
  | 'danglingCategory'
  | 'danglingSeason'
  | 'duplicateId'
  | 'tiersNotRising'
  | 'costNotPositive';
export function loyaltyCatalogProblems(
  c: LoyaltyCatalog,
): readonly LoyaltyCatalogProblem[] {
  const out: LoyaltyCatalogProblem[] = [];
  const categoryIds = new Set<string>(c.categories.map((x) => x.id));
  const seasonIds = new Set<string>(c.seasons.map((x) => x.id));
  const seriesIds = new Set<string>(c.series.map((x) => x.id));
  if (
    c.series.some(
      (s) => s.categoryId !== null && !categoryIds.has(s.categoryId),
    )
  )
    out.push('danglingCategory');
  const seasonFamilies = c.seasons.flatMap((x) =>
    x.trackSeriesId === null ? x.seriesIds : [x.trackSeriesId, ...x.seriesIds],
  );
  if (
    c.series.some((s) => s.seasonId !== null && !seasonIds.has(s.seasonId)) ||
    seasonFamilies.some((id) => !seriesIds.has(id))
  ) {
    out.push('danglingSeason');
  }
  const collections: readonly (readonly { readonly id: string }[])[] = [
    c.categories,
    c.series,
    c.seasons,
    c.tiers,
    c.rewards,
    c.streaks,
  ];
  if (collections.some((xs) => new Set(xs.map((x) => x.id)).size !== xs.length))
    out.push('duplicateId');
  const tiers = [...c.tiers].sort((a, b) => a.rank - b.rank);
  if (
    tiers.some(
      (t, i) =>
        i > 0 && t.qualify.atLeast <= (tiers[i - 1]?.qualify.atLeast ?? 0),
    )
  )
    out.push('tiersNotRising');
  if (c.rewards.some((r) => !Number.isInteger(r.cost) || r.cost <= 0))
    out.push('costNotPositive');
  return out;
}

/** loyaltyAccounts/{uid}/badgeProgress/{seriesId} — absent = not started. `value` is on the family's metric, as of
 *  today (a windowed count falls); each level once, lowest first; `count` is how often a repeatable level was
 *  earned, `earnedAt` the latest. */
export interface BadgeProgress {
  readonly seriesId: BadgeSeriesId;
  readonly value: number;
  readonly earned: readonly {
    readonly level: number;
    readonly earnedAt: IsoInstant;
    readonly via: 'rule' | 'manual';
    readonly count: number;
  }[];
}
/** loyaltyAccounts/{uid}/seasonProgress/{seasonId} — the season's track at a glance: its family's value and highest level. */
export interface SeasonProgress {
  readonly seasonId: SeasonId;
  readonly trackValue: number;
  readonly trackLevel: number;
}
export type PersonalRecordKind =
  'longestRhythm' | 'mostVisitsInYear' | 'favouriteService' | 'firstVisit';
/** `longestRhythm` dates the run's last visit (`on`), `mostVisitsInYear` names the `year`, `favouriteService` the
 *  service and its visits, `firstVisit` is value 1 on its day. */
export interface PersonalRecord {
  readonly kind: PersonalRecordKind;
  readonly value: number;
  readonly on: IsoDate | null;
  readonly year: number | null;
  readonly serviceId: ServiceId | null;
}
/** A point-moving row as «Движение на точките» reads it (visibility = client, effect.kind = points, §6.1). */
export interface LedgerEntry {
  readonly id: JournalEntryId;
  readonly seq: number;
  readonly at: IsoInstant;
  readonly delta: number;
  readonly label: PublicLabel;
  readonly reverses: JournalEntryId | null;
}
export const ledgerEntryOf = (e: ClientJournalEntry): LedgerEntry | null =>
  e.visibility === 'client' && e.effect.kind === 'points'
    ? {
        id: e.id,
        seq: e.seq,
        at: e.at,
        delta: e.effect.delta,
        label: e.publicLabel,
        reverses: e.reverses,
      }
    : null;

export type MedalState = 'notStarted' | 'inProgress' | 'earned';
/** A family for one client: the rim numeral is `highestLevel` (0 = none, no numeral), the caption `value`/`target`. */
export interface SeriesStanding {
  readonly state: MedalState; // earned = at least one level
  readonly highestLevel: number;
  readonly next: BadgeLevel | null; // null = complete (a repeatable family once earned, too)
  readonly value: number;
  readonly target: number | null;
}
export function seriesStanding(
  s: BadgeSeries,
  progress: BadgeProgress | null,
): SeriesStanding {
  const highestLevel =
    progress?.earned.reduce((top, e) => Math.max(top, e.level), 0) ?? 0;
  const next = s.levels.find((l) => l.level > highestLevel) ?? null;
  const state: MedalState =
    highestLevel > 0
      ? 'earned'
      : progress !== null
        ? 'inProgress'
        : 'notStarted';
  return {
    state,
    highestLevel,
    next,
    value: progress?.value ?? 0,
    target: next?.target ?? null,
  };
}
const NUMERALS: readonly (readonly [number, string])[] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];
/** 1 → «I» … 10 → «X»; '' for no level. Levels are numerals, never Бронз/Сребро/Злато (those are tiers). */
export function levelNumeral(level: number): string {
  if (!Number.isInteger(level) || level < 1) return '';
  let rest = level;
  let out = '';
  for (const [value, glyph] of NUMERALS) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}
/** The summary's unit (§3.3.3): each earned level once — a yearly level counts once however often it was earned. */
export const earnedLevelCount = (
  progress: ReadonlyMap<string, BadgeProgress>,
): number => [...progress.values()].reduce((n, p) => n + p.earned.length, 0);

export type FamilyScope =
  | { readonly kind: 'category'; readonly categoryId: string }
  | { readonly kind: 'season'; readonly seasonId: string }
  | { readonly kind: 'archive' }
  | { readonly kind: 'day'; readonly day: IsoDate };
/** The families a scope page draws. A retired family stays only where the client started it; a season's grid is its
 *  `seriesIds` (its track is the gauge above the grid); the archive, the ended seasons' families; a day, the families
 *  with a level earned on it. */
function familiesIn(
  catalog: LoyaltyCatalog,
  progress: ReadonlyMap<string, BadgeProgress>,
  scope: FamilyScope,
  today: IsoDate,
): readonly BadgeSeries[] {
  const shown = (s: BadgeSeries): boolean =>
    s.retiredAt === null || progress.has(s.id);
  switch (scope.kind) {
    case 'category':
      return catalog.series.filter(
        (s) => s.categoryId === scope.categoryId && shown(s),
      );
    case 'season': {
      const season = catalog.seasons.find((x) => x.id === scope.seasonId);
      return season === undefined
        ? []
        : catalog.series.filter(
            (s) => season.seriesIds.includes(s.id) && shown(s),
          );
    }
    case 'archive': {
      const ended = new Set<string>(
        catalog.seasons
          .filter((x) => seasonPhaseOn(x, today) === 'ended')
          .map((x) => x.id),
      );
      return catalog.series.filter(
        (s) => s.seasonId !== null && ended.has(s.seasonId) && shown(s),
      );
    }
    case 'day':
      return catalog.series.filter(
        (s) =>
          progress
            .get(s.id)
            ?.earned.some((e) => sofiaDayOf(e.earnedAt) === scope.day) === true,
      );
  }
}
/** Shelves and scope pages count FAMILIES, the unit they draw (§3.3.3): started / total. */
export function familyCounts(
  catalog: LoyaltyCatalog,
  progress: ReadonlyMap<string, BadgeProgress>,
  scope: FamilyScope,
  today: IsoDate,
): { readonly started: number; readonly total: number } {
  const families = familiesIn(catalog, progress, scope, today);
  return {
    started: families.filter((s) => progress.has(s.id)).length,
    total: families.length,
  };
}

export interface ClosestLevel {
  readonly seriesId: string;
  readonly level: number;
  readonly value: number;
  readonly target: number;
}
/** The counts one worked visit moves by one — the families a single visit can complete together (step 3 below). */
const PER_VISIT: ReadonlySet<Metric> = new Set<Metric>([
  'client.visits.completed',
  'client.visits.earlyBird',
  'client.visits.onTime',
]);
const SPECIFICITY: Readonly<Record<BadgeSubject['kind'] | 'none', number>> = {
  service: 3,
  barber: 2,
  location: 1,
  none: 0,
};
/** «Скоро», the diversity rule (one visit moves four to six families; without it the rail is four clones of «24/25»):
 *  1. candidates: not complete, not retired, not in a season that is not open, not calendar-driven, with a known next
 *     target; ranked by value / target, descending;
 *  2. at most one family per category (a season's families count as that season);
 *  3. among CATEGORY families whose next level completes on the same next worked visit (equal target − value on a
 *     per-visit count the client's visits already move — a family not started yet is moved by none of them), only
 *     the most specific subject stays: service › barber › location › none; ties by category order, then series
 *     order. A season's families are outside step 3: the season is its own clock, so its track sits beside the
 *     service it shares a visit with (§4.6: «Фейд III 24/25 · Онлайн III 7/10 · Есен 2026 III 2/3»);
 *  4. fill to `limit` in rank order. */
export function closestLevels(
  catalog: LoyaltyCatalog,
  progress: ReadonlyMap<string, BadgeProgress>,
  today: IsoDate,
  limit: number,
): readonly ClosestLevel[] {
  const categoryOrder = new Map<string, number>(
    catalog.categories.map((c) => [c.id, c.order]),
  );
  const seasons = new Map<string, Season>(
    catalog.seasons.map((x) => [x.id, x]),
  );
  const shelfOrder = (s: BadgeSeries): number =>
    s.categoryId === null
      ? Infinity
      : (categoryOrder.get(s.categoryId) ?? Infinity);
  const candidates = catalog.series.flatMap((s) => {
    const season =
      s.seasonId === null ? null : (seasons.get(s.seasonId) ?? null);
    if (
      s.retiredAt !== null ||
      isCalendarDriven(s) ||
      (season !== null && seasonPhaseOn(season, today) !== 'open')
    )
      return [];
    const standing = seriesStanding(s, progress.get(s.id) ?? null);
    if (standing.next === null || standing.target === null) return [];
    return [
      {
        s,
        level: standing.next.level,
        value: standing.value,
        target: standing.target,
      },
    ];
  });
  type Candidate = (typeof candidates)[number];
  const bySubject = (a: Candidate, b: Candidate): number =>
    SPECIFICITY[b.s.subject?.kind ?? 'none'] -
      SPECIFICITY[a.s.subject?.kind ?? 'none'] ||
    shelfOrder(a.s) - shelfOrder(b.s) ||
    a.s.order - b.s.order;
  const sameVisit = new Map<number, Candidate[]>();
  for (const c of candidates) {
    if (
      c.value === 0 ||
      c.s.categoryId === null ||
      c.s.metric === null ||
      !PER_VISIT.has(c.s.metric.metric)
    )
      continue;
    sameVisit.set(c.target - c.value, [
      ...(sameVisit.get(c.target - c.value) ?? []),
      c,
    ]);
  }
  const yielded = new Set<Candidate>();
  for (const group of sameVisit.values()) {
    const [keep] = [...group].sort(bySubject);
    for (const c of group) if (c !== keep) yielded.add(c);
  }
  const ranked = candidates
    .filter((c) => !yielded.has(c))
    .sort(
      (a, b) =>
        b.value / b.target - a.value / a.target ||
        a.target - a.value - (b.target - b.value) ||
        shelfOrder(a.s) - shelfOrder(b.s) ||
        a.s.order - b.s.order ||
        a.s.id.localeCompare(b.s.id),
    );
  const shelves = new Set<string>();
  const out: ClosestLevel[] = [];
  for (const c of ranked) {
    if (out.length >= limit) break;
    const shelf = c.s.categoryId ?? `season:${c.s.seasonId ?? ''}`;
    if (shelves.has(shelf)) continue;
    shelves.add(shelf);
    out.push({
      seriesId: c.s.id,
      level: c.level,
      value: c.value,
      target: c.target,
    });
  }
  return out;
}

export interface EarnedDay {
  readonly day: IsoDate;
  readonly levels: readonly {
    readonly seriesId: string;
    readonly level: number;
    readonly earnedAt: IsoInstant;
  }[];
}
/** «Последни»: earned levels grouped by their Europe/Sofia day, newest day first, newest level first within a day;
 *  a day with several levels is one rail item (§3.3 AE). */
export function recentLevelsByDay(
  progress: ReadonlyMap<string, BadgeProgress>,
  limit: number,
): readonly EarnedDay[] {
  const days = new Map<
    IsoDate,
    {
      readonly seriesId: string;
      readonly level: number;
      readonly earnedAt: IsoInstant;
    }[]
  >();
  for (const p of progress.values()) {
    for (const e of p.earned) {
      const day = sofiaDayOf(e.earnedAt);
      days.set(day, [
        ...(days.get(day) ?? []),
        { seriesId: p.seriesId, level: e.level, earnedAt: e.earnedAt },
      ]);
    }
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, limit)
    .map(([day, levels]) => ({
      day,
      levels: [...levels].sort(
        (a, b) =>
          Date.parse(b.earnedAt) - Date.parse(a.earnedAt) || b.level - a.level,
      ),
    }));
}
/** «Ново» (§3.3.2 AE): earned after the previous visit began; before a first visit everything is new. */
export const isNewSince = (
  earnedAt: IsoInstant,
  previousVisitAtMs: number | null,
): boolean =>
  previousVisitAtMs === null || Date.parse(earnedAt) > previousVisitAtMs;
const redeemableOn = (
  item: RewardCatalogItem,
  balance: number,
  today: IsoDate,
): RedeemProblem | null =>
  redeemProblem(item, { balance, today, paused: false, recent: [] });
/** The costliest reward the balance buys today (enabled, in its window, in stock); ties by catalogue order. */
export function bestAffordable(
  rewards: readonly RewardCatalogItem[],
  balance: number,
  today: IsoDate,
): RewardCatalogItem | null {
  return (
    [...rewards]
      .filter((r) => redeemableOn(r, balance, today) === null)
      .sort((a, b) => b.cost - a.cost || a.order - b.order)[0] ?? null
  );
}
/** The cheapest reward the balance does not reach yet — only one points alone keep from the client. */
export function nextAffordable(
  rewards: readonly RewardCatalogItem[],
  balance: number,
  today: IsoDate,
): RewardCatalogItem | null {
  return (
    [...rewards]
      .filter((r) => redeemableOn(r, balance, today) === 'insufficientPoints')
      .sort((a, b) => a.cost - b.cost || a.order - b.order)[0] ?? null
  );
}
/** The tier track (§3.2 LH): every tier a step by rank; the current one honours an override; `remaining` is the account's. */
export function tierSteps(
  state: TierState,
  tiers: readonly TierDefinition[],
): {
  readonly steps: readonly {
    readonly tierId: TierId;
    readonly atLeast: number;
    readonly name: LocalizedText;
  }[];
  readonly value: number;
  readonly currentTierId: TierId;
  readonly nextTierId: TierId | null;
  readonly remaining: number | null;
} {
  const steps = [...tiers]
    .sort((a, b) => a.rank - b.rank)
    .map((t) => ({ tierId: t.id, atLeast: t.qualify.atLeast, name: t.name }));
  return {
    steps,
    value: state.qualifying,
    currentTierId: state.override?.tierId ?? state.current,
    nextTierId: state.next,
    remaining: state.remaining,
  };
}

// ── The journal (clientJournal/{uid}_{seq:06}) ───────────────────────────────
/** Client ledger copy (R18): points.goodwill «Бонус от салона», points.serviceIssue «Компенсация от салона»,
 *  points.correction «Корекция от салона», points.reversed «Анулирано», points.debtCleared «Изчистен дълг» (R27). */
export type PublicLabelCode =
  | 'points.opening'
  | 'points.rule'
  | 'points.goodwill'
  | 'points.serviceIssue'
  | 'points.correction'
  | 'points.accountMerge'
  | 'points.redeemed'
  | 'points.redemptionReversed'
  | 'points.expired'
  | 'points.debtCleared'
  | 'points.reversed'
  | 'achievement.earned'
  | 'achievement.revoked'
  | 'streak.changed'
  | 'freeze.changed'
  | 'tier.changed'
  | 'reward.granted'
  | 'reward.reinstated'
  | 'reward.revoked'
  | 'redemption.changed'
  | 'pause.changed'
  | 'visit.outcomeCorrected'
  | 'preview.stat'
  | 'choice.awardNoLongerMet'
  | 'choice.manualPause'
  | 'choice.upcomingBooking';
/** Client-visible copy key + non-PII params (i18n resolves); NEVER carries a note or a name (T5). */
export interface PublicLabel {
  readonly code: PublicLabelCode;
  readonly params: Readonly<Record<string, string | number>>;
}
export type PauseScope = 'selfService' | 'allBookings';
export type PauseTerm =
  | { readonly kind: 'temporary'; readonly until: IsoInstant }
  | { readonly kind: 'permanent' };

export type JournalEffect =
  | { readonly kind: 'points'; readonly delta: number } // the ONLY effect that moves the balance (merges too: points.accountMerge, R49)
  | {
      readonly kind: 'streak';
      readonly streakId: StreakId;
      readonly op:
        | 'extended'
        | 'broken'
        | 'repaired'
        | 'extendedDue'
        | 'excused'
        | 'reset'
        | 'set'
        | 'recomputed';
      readonly from: number;
      readonly to: number;
      readonly dueBy: IsoDate | null;
    }
  | {
      readonly kind: 'freeze';
      readonly streakId: StreakId;
      readonly op: 'earned' | 'granted' | 'applied';
      readonly count: number;
      readonly bankedAfter: number;
    }
  | {
      readonly kind: 'achievement';
      readonly rule: RuleRef;
      readonly awardKey: AwardKey;
      readonly op: 'granted' | 'revoked';
    }
  | {
      readonly kind: 'tier';
      readonly op: 'changed' | 'granted' | 'overridden' | 'overrideCleared';
      readonly from: TierId;
      readonly to: TierId;
      readonly until: IsoDate | null;
    }
  | {
      readonly kind: 'reward';
      readonly op: 'granted' | 'reinstated' | 'revoked';
      readonly ref: RewardRef;
    }
  | {
      readonly kind: 'redemption';
      readonly op: 'redeemed' | 'reversed' | 'expired';
      readonly redemptionId: RedemptionId;
      readonly rewardId: RewardId;
      readonly cost: number;
      readonly grant: RewardRef | null;
    }
  | {
      readonly kind: 'pause';
      readonly op: 'applied' | 'edited' | 'lifted' | 'expired';
      readonly pauseId: PauseId;
      readonly term: PauseTerm;
      readonly scope: PauseScope;
      readonly prior: {
        readonly term: PauseTerm;
        readonly scope: PauseScope;
      } | null;
    } // before → after on every pause row; null on 'applied'
  | {
      readonly kind: 'visitOutcome';
      readonly appointmentId: AppointmentId;
      readonly seatId: SeatId;
      readonly from: SeatOutcomeKind;
      readonly to: SeatOutcomeKind;
      readonly revision: number;
    };
/** Scheduled/derived writers. No job ever APPLIES a pause: a threshold only suggests (B1, R25). */
export type SystemJob =
  'streak' | 'tier' | 'pauseExpiry' | 'pointsExpiry' | 'rewardExpiry';
/** rule = the engine paid; manual = what a human asked for directly; correction = what the system
 *  recomputed or compensated BECAUSE of a correction (cascade lines, reversals). */
export type JournalSource =
  | {
      readonly kind: 'rule';
      readonly rule: RuleRef;
      readonly awardKey: AwardKey;
      readonly eventId: LoyaltyEventId;
    }
  | {
      readonly kind: 'manual' | 'correction';
      readonly adjustmentId: AdjustmentId;
    }
  | { readonly kind: 'system'; readonly job: SystemJob }
  | { readonly kind: 'migration'; readonly batchId: string }
  | { readonly kind: 'redemption'; readonly redemptionId: RedemptionId };
/** clientJournal/{entryId} — append-only, never updated or deleted; entryId = `${userId}_${seq:06}` (R48).
 *  Reads: `client` rows by the owner and worksTheBook(); `staff` rows (pauses, outcome corrections) by frontDesk().
 *  `actor` carries ids only (T5, R36); the client UI never renders it; erasure pseudonymises the row. */
export interface ClientJournalEntry {
  readonly id: JournalEntryId;
  readonly userId: UserId;
  readonly seq: number; // dense per user; assigned in the transaction that bumps loyaltyAccounts.seq
  readonly at: IsoInstant;
  readonly effect: JournalEffect;
  readonly source: JournalSource;
  readonly actor: Actor;
  /** The entry this one compensates; an entry is reversed at most once and a reversal is never itself reversed. */
  readonly reverses: JournalEntryId | null;
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: IdempotencyKey; // traceability; exactly-once is enforced by the guard doc
  readonly visibility: 'client' | 'staff';
  readonly publicLabel: PublicLabel;
  readonly balanceAfter: number;
}
/** T2, R27: only a compensation written by a correction may take the balance below zero (the account then owes). */
export const mayOverdraw = (source: JournalSource): boolean =>
  source.kind === 'correction';
/** R27: a manual debit is bounded by the balance, the maximum stated before input (A8); refused beyond, never clamped. */
export const manualDebitProblem = (
  points: number,
  balance: number,
): 'balanceShortfall' | null =>
  points > Math.max(0, balance) ? 'balanceShortfall' : null;
/** R53: the client ledger folds a reversal and its original into one struck row only within undoWindowMinutes;
 *  staff always see both (T3). */
export const foldsInClientLedger = (
  original: ClientJournalEntry,
  reversal: ClientJournalEntry,
  undoWindowMinutes: number,
): boolean =>
  reversal.reverses === original.id &&
  Date.parse(reversal.at) - Date.parse(original.at) <=
    undoWindowMinutes * 60_000;

// ── Support toolkit (adjustments/{requestId}) ────────────────────────────────
export type ReasonCode =
  | 'goodwill'
  | 'service_issue'
  | 'staff_error'
  | 'system_fault'
  | 'missed_award'
  | 'duplicate_account'
  | 'wrong_client'
  | 'fraud_or_abuse'
  | 'client_request'
  | 'policy_exception'
  | 'migration_fix'
  | 'other'
  | 'policy_enforcement'; // the reason for APPLYING a pause
export type Reason =
  | { readonly code: Exclude<ReasonCode, 'other'>; readonly note?: string }
  | { readonly code: 'other'; readonly note: string };
export type PauseReasonCategory =
  | BlockReason
  | 'no_show_pattern'
  | 'late_cancellation_pattern'
  | 'conduct'
  | 'payment_issue';
export interface PauseChange {
  readonly term?: PauseTerm;
  readonly scope?: PauseScope;
  readonly category?: PauseReasonCategory;
  readonly clientVisible?: boolean;
  readonly reviewOn?: IsoDate;
}
/** R49: the true outcome with what SeatOutcome needs. From `no_show` a cancellation is stamped `no_show_converted`;
 *  `attribution` says who caused it (R33) — only a client-caused one counts as a late cancel. */
export type OutcomeTarget =
  | { readonly kind: 'worked' }
  | { readonly kind: 'no_show' }
  | {
      readonly kind: 'cancelled';
      readonly by: 'client' | 'staff';
      readonly reason: CancellationReason;
      readonly attribution: 'client' | 'shop';
    };

/** Every manual act (R45). All but `client.merge` go through previewAdjustment → commitAdjustment;
 *  `client.merge` is the record commitMerge writes (F7). Replays are replayRule, not an adjustment. */
export type AdjustmentKind =
  | {
      readonly kind: 'points.credit';
      readonly points: number;
      readonly reverses?: JournalEntryId; // T6 row-level «Сторнирай»
      readonly missedAward?: {
        readonly ruleId: RuleId;
        readonly factKey: string;
      };
    } // R28: names the visit, writes the rule's own award key
  | {
      readonly kind: 'points.debit';
      readonly points: number;
      readonly reverses?: JournalEntryId;
    }
  | {
      readonly kind: 'streak.repair';
      readonly streakId: StreakId;
      readonly period: IsoDate;
    }
  | {
      readonly kind: 'streak.extend';
      readonly streakId: StreakId;
      readonly days: number;
    } // ≤ one cadence period for a receptionist
  | {
      readonly kind: 'streak.freezeGrant';
      readonly streakId: StreakId;
      readonly count: number;
    }
  | { readonly kind: 'streak.reset'; readonly streakId: StreakId }
  | {
      readonly kind: 'streak.set';
      readonly streakId: StreakId;
      readonly current: number;
    }
  | { readonly kind: 'achievement.grant'; readonly ruleId: RuleId }
  | { readonly kind: 'achievement.revoke'; readonly awardKey: AwardKey }
  | {
      readonly kind: 'tier.override';
      readonly tierId: TierId;
      readonly until: IsoDate | null;
    }
  | { readonly kind: 'tier.clear' }
  | {
      readonly kind: 'reward.reinstate';
      readonly ref: Extract<RewardRef, { kind: 'couponGrant' | 'giftVoucher' }>;
      readonly drawId?: string;
    } // drawId = one recorded voucherRedemptions[] draw, `${appointmentId}#${index}` (§6.7)
  | { readonly kind: 'redemption.reverse'; readonly redemptionId: RedemptionId }
  | {
      readonly kind: 'pause.apply';
      readonly scope: PauseScope;
      readonly term: PauseTerm;
      readonly category: PauseReasonCategory;
      readonly clientVisible: boolean;
      readonly basis: readonly AppointmentId[];
      readonly reviewOn: IsoDate;
      readonly fromSuggestion: boolean; // B1, R25
    }
  | {
      readonly kind: 'pause.edit';
      readonly pauseId: PauseId;
      readonly change: PauseChange;
    }
  | { readonly kind: 'pause.lift'; readonly pauseId: PauseId }
  | {
      readonly kind: 'visit.outcome';
      readonly appointmentId: AppointmentId;
      readonly seatId: SeatId;
      readonly from: SeatOutcomeKind;
      readonly to: OutcomeTarget;
    }
  | { readonly kind: 'client.merge'; readonly duplicateUserId: UserId }
  | {
      readonly kind: 'adjustment.reverse';
      readonly original: {
        readonly id: AdjustmentId;
        readonly kind: AdjustmentKind;
      };
    };
export type AdjustmentKindTag = AdjustmentKind['kind'];

const CREDIT: readonly ReasonCode[] = [
  'goodwill',
  'service_issue',
  'missed_award',
  'system_fault',
  'staff_error',
  'client_request',
  'policy_exception',
  'migration_fix',
  'other',
];
const DEBIT: readonly ReasonCode[] = [
  'staff_error',
  'system_fault',
  'duplicate_account',
  'wrong_client',
  'fraud_or_abuse',
  'client_request',
  'migration_fix',
  'other',
];
const RESTORE: readonly ReasonCode[] = [
  'staff_error',
  'system_fault',
  'missed_award',
  'service_issue',
  'goodwill',
  'policy_exception',
  'other',
];
const REMOVE: readonly ReasonCode[] = [
  'staff_error',
  'system_fault',
  'wrong_client',
  'fraud_or_abuse',
  'client_request',
  'other',
];
/** Closed per kind and direction-filtered (A7); `other` needs a note (type-enforced by `Reason`). */
export const REASONS_BY_KIND: Readonly<
  Record<AdjustmentKindTag, readonly ReasonCode[]>
> = {
  'points.credit': CREDIT,
  'points.debit': DEBIT,
  'streak.repair': RESTORE,
  'streak.extend': RESTORE,
  'streak.freezeGrant': RESTORE,
  'streak.reset': REMOVE,
  'streak.set': [
    'staff_error',
    'system_fault',
    'migration_fix',
    'policy_exception',
    'other',
  ],
  'achievement.grant': RESTORE,
  'achievement.revoke': REMOVE,
  'tier.override': [
    'policy_exception',
    'goodwill',
    'service_issue',
    'staff_error',
    'other',
  ],
  'tier.clear': REMOVE,
  'reward.reinstate': RESTORE,
  'redemption.reverse': [
    'client_request',
    'staff_error',
    'wrong_client',
    'system_fault',
    'other',
  ],
  'pause.apply': ['policy_enforcement', 'fraud_or_abuse', 'other'], // R49: no client_request
  'pause.edit': ['staff_error', 'client_request', 'policy_exception', 'other'],
  'pause.lift': [
    'client_request',
    'goodwill',
    'policy_exception',
    'staff_error',
    'other',
  ],
  'visit.outcome': [
    'staff_error',
    'wrong_client',
    'system_fault',
    'client_request',
    'other',
  ],
  'client.merge': ['duplicate_account'],
  'adjustment.reverse': [
    'staff_error',
    'wrong_client',
    'system_fault',
    'client_request',
    'other',
  ],
};
/** The client-visible label of a manual points entry (R18) — never the note, never an accusation. */
export const REASON_PUBLIC_LABEL: Readonly<
  Record<ReasonCode, PublicLabelCode>
> = {
  goodwill: 'points.goodwill',
  service_issue: 'points.serviceIssue',
  duplicate_account: 'points.accountMerge',
  staff_error: 'points.correction',
  system_fault: 'points.correction',
  missed_award: 'points.correction',
  wrong_client: 'points.correction',
  fraud_or_abuse: 'points.correction',
  client_request: 'points.correction',
  policy_exception: 'points.correction',
  migration_fix: 'points.correction',
  other: 'points.correction',
  policy_enforcement: 'points.correction',
};
/** A8 «Уведоми клиента» default: on for gestures, off for our own mistakes. */
export const notifyByDefault = (code: ReasonCode): boolean =>
  code === 'goodwill' ||
  code === 'service_issue' ||
  code === 'missed_award' ||
  code === 'client_request';

/** R2: barbers file no requests, so only a limit or a staff-related subject sends an act to approval. */
export type ApprovalReason = 'overLimit' | 'staffRelated';
export type ApprovalState =
  | { readonly kind: 'notRequired' }
  | {
      readonly kind: 'pending';
      readonly reason: ApprovalReason;
      readonly requestedAt: IsoInstant;
      readonly expiresAt: IsoInstant;
    }
  | {
      readonly kind: 'approved';
      readonly reason: ApprovalReason;
      readonly requestedAt: IsoInstant;
      readonly decidedBy: Actor;
      readonly decidedAt: IsoInstant;
    }
  | {
      readonly kind: 'rejected';
      readonly reason: ApprovalReason;
      readonly requestedAt: IsoInstant;
      readonly decidedBy: Actor;
      readonly decidedAt: IsoInstant;
      readonly rejection: string;
    }
  | {
      readonly kind: 'withdrawn' | 'expired';
      readonly reason: ApprovalReason;
      readonly requestedAt: IsoInstant;
      readonly at: IsoInstant;
    };
/** adjustments/{id}.anomalies (R48): computed at commit, never block, shown to front desk and admin in Дейност. */
export type AnomalyFlag =
  | 'self_adjacent'
  | 'velocity'
  | 'repeat_subject'
  | 'pre_redemption'
  | 'dormant_subject'
  | 'large'
  | 'owner_override'
  | 'break_glass'
  | 'reversal_chain'
  | 'shared_contact'
  | 'manual_then_rule';
export type ChoiceOption = 'keep' | 'revoke' | 'lift' | 'cancel';
export interface ChoiceAnswer {
  readonly choiceId: ChoiceId;
  readonly option: ChoiceOption;
}
/** Client-minted request ids (F2): 16–64 [A-Za-z0-9_-], the commitBooking attemptId precedent (commit-booking.ts:92-96). */
export const isRequestId = (raw: string): boolean =>
  /^[A-Za-z0-9_-]{16,64}$/.test(raw);
/** adjustments/{requestId} — receptionist+admin read (sec-03 §3.6.2); sysadmin via listClientActivity only (logged, notes
 *  stripped, R15). The home of the reason and «Бележка на екипа» (reason.note; a pause.* note is also written to its
 *  ClientPauseNote, R56). The doc id IS the request id (F2), READ first in the transaction (P2): present → a retry,
 *  and the stored result returns; absent → create().
 *  create()'s ALREADY_EXISTS (a lost race) is refused, and a retry resolves it by reading. Lifecycle fields only move
 *  forward, each move a CAS in a transaction that also writes its auditLog row (F1). No TTL, ever (F6, R48). */
export interface Adjustment {
  readonly id: AdjustmentId;
  readonly subjectUserId: UserId;
  readonly input: AdjustmentKind;
  readonly reason: Reason;
  readonly notifyClient: boolean;
  readonly actor: Actor;
  readonly requestedAt: IsoInstant; // the requester
  readonly previewDigest: string;
  readonly stateVersion: StateVersion; // what was confirmed; CAS re-checked at commit
  readonly choices: readonly ChoiceAnswer[];
  readonly approval: ApprovalState;
  readonly anomalies: readonly AnomalyFlag[];
  readonly committedAt: IsoInstant | null;
  readonly resultingEntryIds: readonly JournalEntryId[];
  readonly reverses: AdjustmentId | null;
  readonly reversedBy: AdjustmentId | null;
}
/** The uid behind an actor (null for the system). */
export function actorUid(a: Actor): UserId | null {
  switch (a.kind) {
    case 'system':
      return null;
    case 'user':
    case 'staff':
      return a.userId;
    case 'admin':
    case 'impersonator':
      return a.adminUserId;
  }
}
export type DecisionProblem =
  'notPending' | 'expired' | 'ownRequest' | 'ownRecord';
/** decideAdjustment's guard (H3, R38), read in the deciding transaction: approver ≠ requester ≠ subject; a second
 *  approve, an approve racing a withdraw and a late approve all refuse. */
export function decisionProblem(
  a: Adjustment,
  deciderUid: UserId,
  now: IsoInstant,
): DecisionProblem | null {
  if (a.approval.kind !== 'pending') return 'notPending';
  if (now >= a.approval.expiresAt) return 'expired';
  if (actorUid(a.actor) === deciderUid) return 'ownRequest';
  if (a.subjectUserId === deciderUid) return 'ownRecord';
  return null;
}
/** H4 (R38): the admins who may decide. None → the request is refused at preview (`noEligibleApprover`), never
 *  left pending — so in a single-admin shop nobody manually adjusts the owner's own record. */
export const eligibleApprovers = (
  admins: readonly UserId[],
  requester: UserId,
  subject: UserId,
): readonly UserId[] => admins.filter((a) => a !== requester && a !== subject);
/** R6's receipt undo (sec-03 §3.2.1, §3.2.3), @creativo/domain/support (R50): the four facts, read from redemptions/{id} in the
 *  transaction; 'admitted' feeds CapabilityProbe.receiptUndo. 'lapsed' = the caller's own on-behalf redemption past the
 *  window or no longer active (`support.outside_window`, §3.6.4); 'notOwn' needs loyalty.redemption.reverse. */
export type ReceiptUndo = 'admitted' | 'lapsed' | 'notOwn';
export function receiptUndoOf(
  r: Redemption,
  callerUid: UserId,
  now: IsoInstant,
  policy: SupportPolicy,
): ReceiptUndo {
  if (actorUid(r.by) !== callerUid || r.channel !== 'onBehalf') return 'notOwn';
  const inWindow =
    Date.parse(now) - Date.parse(r.at) <= policy.undoWindowMinutes * 60_000;
  return inWindow && r.state.kind === 'active' ? 'admitted' : 'lapsed';
}
export type ReversalProblem = 'notCommitted' | 'alreadyReversed' | 'isReversal';
/** adjustment.reverse's guard, read in the reversing transaction, which also writes `original.reversedBy`: two
 *  racing undos (the toast and the Activity row) contend on the original doc and the loser sees `alreadyReversed`. */
export function reversalProblem(original: Adjustment): ReversalProblem | null {
  if (original.committedAt === null) return 'notCommitted';
  if (original.reversedBy !== null) return 'alreadyReversed';
  if (original.input.kind === 'adjustment.reverse') return 'isReversal'; // a re-do is a fresh adjustment
  return null;
}
/** One before → after line (ui-value-change). `effect` = the entry it will write; null = projection-only. */
export interface PreviewLine {
  readonly label: PublicLabel;
  readonly effect: JournalEffect | null;
  readonly before: string | number | boolean | null;
  readonly after: string | number | boolean | null;
}
/** Manual state never changes silently: every award, pause and (allBookings) upcoming booking the cascade touches
 *  is a visible choice. Awards and bookings default to keep; a pause to lift only per `pauseChoiceDefault` (R25).
 *  `lines` are the entries written when the answer is NOT keep. */
export interface Choice {
  readonly id: ChoiceId;
  readonly label: PublicLabel;
  readonly subject:
    | { readonly kind: 'award'; readonly awardKey: AwardKey }
    | { readonly kind: 'pause'; readonly pauseId: PauseId }
    | {
        readonly kind: 'booking';
        readonly appointmentId: AppointmentId;
        readonly seatId: SeatId;
      }; // R49
  readonly options: readonly ChoiceOption[];
  readonly defaultOption: 'keep' | 'lift';
  readonly lines: readonly PreviewLine[];
}
export type WarningCode =
  | 'subjectPaused'
  | 'staffRelatedSubject'
  | 'dormantSubject'
  | 'nearDailyLimit'
  | 'rewardAlreadyUsed'
  | 'similarPending' // the same kind on the same client pending or committed in 24 h: two request ids, one intent?
  | 'balanceShortfall' // a manual debit above the balance — refused, the bound stated (R27)
  | 'balanceOwed' // a correction's compensation takes the balance below zero — allowed, shown as owed (R27)
  | 'noEligibleApprover'; // H4: refused, nothing to submit
/** previewAdjustment(input) — the engine in simulation mode; nothing is written. */
export interface CascadePreview {
  readonly direct: readonly PreviewLine[];
  readonly derived: readonly PreviewLine[]; // recomputed: streaks, tiers, counters, stats
  readonly ruleEffects: readonly PreviewLine[]; // awards issued or compensated
  readonly choices: readonly Choice[];
  readonly warnings: readonly {
    readonly code: WarningCode;
    readonly params: Readonly<Record<string, string | number>>;
  }[];
  readonly approval:
    | { readonly kind: 'notRequired' }
    | { readonly kind: 'required'; readonly reason: ApprovalReason };
  readonly balance: { readonly before: number; readonly after: number };
  readonly stateVersion: StateVersion;
  readonly confirmation: 'receipt' | 'alert' | 'alertWithWindow'; // R39 friction tier, decided server-side from the preview
}
/** The decider's card (route → Корекции); the preview is RE-RUN at view and at decision time (A12). */
export interface ApprovalRequest {
  readonly adjustmentId: AdjustmentId;
  readonly input: AdjustmentKind;
  readonly reason: Reason;
  readonly subject: { readonly userId: UserId; readonly displayName: string };
  readonly requester: {
    readonly userId: UserId;
    readonly displayName: string;
    readonly roles: readonly UserRole[];
  };
  readonly state: ApprovalState;
  readonly preview: CascadePreview;
  readonly anomalies: readonly AnomalyFlag[];
  readonly viewerMayDecide: boolean;
}
/** approvals/{requestId} — the decision queue: the only approval doc with a TTL (closed + 30 d, F6, R48). */
export interface ApprovalQueueItem {
  readonly adjustmentId: AdjustmentId;
  readonly subjectUserId: UserId;
  readonly requestedBy: UserId;
  readonly state: 'open' | 'closed';
  readonly expiresAt: IsoInstant;
  readonly purgeAt: FirestoreTimestamp | null;
}
/** heldNotifications/{requestId} (T1, R31) — written in the commit transaction; released after undoWindowMinutes
 *  unless the undo dropped it. A compensation sends a neutral follow-up only if the original was released.
 *  P2 holds an allBookings pause's booking cancellations (`appointment_changed`, R58); P4 adds `loyalty_corrected`. */
export interface HeldNotification {
  readonly userId: UserId;
  readonly kind: Extract<
    NotificationKind,
    'appointment_changed' | 'loyalty_corrected'
  >;
  readonly payload: PublicLabel;
  readonly releaseAt: IsoInstant;
  readonly state: 'held' | 'released' | 'dropped';
  readonly purgeAt: FirestoreTimestamp | null;
}
/** auditLog/{id} — the EXISTING shape (audit-log-document.ts:34-45); support rows name the client in targetUserId.
 *  Written INSIDE the transaction that writes the journal and the adjustment (F1, R26), rules `create: if false`;
 *  id = the request id, `${requestId}~decision` / `~commit` for later steps (F2). Ids and codes only (T5, R36). */
export interface AuditRow {
  readonly actor: Actor;
  readonly action: string;
  readonly at: IsoInstant;
  readonly targetUserId: UserId | null;
  readonly resourceId: string | null;
  readonly context: Readonly<Record<string, string>> | null;
}
type Underscored<K extends string> = K extends `${infer A}.${infer B}`
  ? `${A}_${B}`
  : K;
/** R45's audit vocabulary plus the sec-03 §3.6.3 addendum (`support.rhythm_protected` is the action of R58's `protectRhythm`). */
export type SupportAuditAction =
  | `support.${Underscored<AdjustmentKindTag>}`
  | 'support.rule_replay'
  | 'support.reward_redeemed'
  | 'support.profile_updated'
  | 'support.rhythm_protected'
  | `support.approval_${'requested' | 'approved' | 'rejected' | 'withdrawn' | 'expired'}`
  | `support.bulk_${'scheduled' | 'cancelled' | 'executed' | 'reversed'}`
  | `support.claim_${'submitted' | 'resolved'}`
  | `privacy.${'export' | 'erasure_scheduled' | 'erasure_done'}`
  | 'client.viewed_break_glass';
export const auditActionOf = (kind: AdjustmentKindTag): SupportAuditAction =>
  `support.${kind.replace('.', '_')}` as SupportAuditAction;

// ── Activity (listClientActivity: a read model assembled per call, never persisted) ──
/** The route's Дейност filter (5B.5.5); `profile` exists only for audit.read.all holders. */
export type ActivityFilter =
  | 'all'
  | 'points'
  | 'rhythm'
  | 'badges'
  | 'tier'
  | 'pause'
  | 'visits'
  | 'profile';
/** The brief's UNIFIED adjustment/audit event (P9), assembled by listClientActivity within the caller's
 *  capabilities: source, actor, before → after and the entry links come from clientJournal; reason, approval and
 *  anomalies from adjustments; profile and support-view rows from auditLog (audit.read.all only). One row per
 *  adjustment (its cascade grouped by correlationId, a pending request included) or per rule, system, migration
 *  or redemption entry. */
export interface ClientActivityEntry {
  readonly id: string; // the adjustment id, else the journal entry id, else the auditLog row id
  readonly at: IsoInstant;
  readonly correlationId: CorrelationId;
  /** An adjustment row takes its kind tag; any other journal row its effect's kind; an auditLog-only row is
   *  `profile.updated` (field names only, R36) or `support.viewed` (a `client.viewed_break_glass` row, R45). */
  readonly kind:
    | AdjustmentKindTag
    | JournalEffect['kind']
    | 'profile.updated'
    | 'support.viewed';
  readonly source: JournalSource | null; // null on an auditLog-only row: the actor says who
  readonly actor: Actor;
  /** From the adjustment; `publicLabel` is what the client ledger reads; `note` («Бележка на екипа») is omitted for sysadmin (R15). */
  readonly reason: {
    readonly code: ReasonCode;
    readonly publicLabel: PublicLabelCode | null;
    readonly note?: string;
  } | null;
  readonly changes: readonly {
    readonly quantity:
      | 'points'
      | 'streak'
      | 'protection'
      | 'tier'
      | 'pause'
      | 'visit.outcome'
      | 'badge'
      | 'reward';
    readonly before: string | number | null;
    readonly after: string | number | null;
  }[];
  readonly fields: readonly string[]; // profile.updated: the changed field names, never values (R36); [] otherwise
  /** The adjustment this row compensates / that compensated it (a row without an adjustment: its journal entry's). */
  readonly reverses: string | null;
  readonly reversedBy: string | null;
  readonly approval: ApprovalState | null;
  readonly anomalies: readonly AnomalyFlag[];
  readonly visibility: 'client' | 'staff'; // `staff` for pending requests and auditLog rows
  readonly adjustmentId: AdjustmentId | null;
  readonly journalEntryIds: readonly JournalEntryId[];
}
/** listClientActivity (R45, R48): gated by audit.read.client; newest first; `before` is the previous page's cursor. */
export interface ListClientActivityRequest {
  readonly subjectUserId: UserId;
  readonly kinds: ActivityFilter;
  readonly before: string | null;
  readonly limit: number;
} // limit 50 (5B.5.7)
export interface ListClientActivityResponse {
  readonly entries: readonly ClientActivityEntry[];
  readonly nextCursor: string | null;
  readonly totals: Readonly<Record<ActivityFilter, number>>; // each filter option's count (5B.5.5), never the loaded page's
}

// ── Pauses (clientPauses/{pauseId}; users/{uid}.status and clientProfiles.pauseSummary are projections) ──
/** clientPauses/{pauseId} — frontDesk()-read, sysadmin included (R48): who paused, the category, the basis ids and the
 *  history, never free text; «Бележка на екипа» is the `ClientPauseNote` sub-document (R56).
 *  Every pause is a person's decision (B1, R25); `basis` = the appointments it relied on, `reviewOn` its review date. */
export interface ClientPause {
  readonly id: PauseId;
  readonly userId: UserId;
  readonly scope: PauseScope;
  readonly term: PauseTerm;
  readonly reason: {
    readonly category: PauseReasonCategory;
    readonly clientVisible: boolean;
  }; // no note (R56)
  readonly adjustmentId: AdjustmentId; // the pause.apply that created it
  readonly basis: readonly AppointmentId[]; // [] for conduct and the like
  readonly fromSuggestion: boolean;
  readonly reviewOn: IsoDate;
  readonly appliedBy: Actor;
  readonly appliedAt: IsoInstant;
  readonly state: 'active' | 'lifted' | 'expired';
  readonly history: readonly {
    readonly op: 'applied' | 'edited' | 'lifted' | 'expired';
    readonly at: IsoInstant;
    readonly by: Actor;
    readonly adjustmentId: AdjustmentId | null;
    readonly journalEntryId: JournalEntryId;
    readonly change: PauseChange | null;
  }[];
  readonly version: number;
}
/** clientPauses/{pauseId}/private/note — «Бележка на екипа» (R56): read hasAnyRole(['receptionist','admin']) only, so
 *  R15 holds in the rules (they do not cascade from the frontDesk() parent). Written by the pause.* commits in the
 *  pause's own transaction, beside the adjustment's `reason.note`; absent without a note; redactable (T5, audited). */
export interface ClientPauseNote {
  readonly text: string;
  readonly authorUid: UserId;
  readonly writtenAt: IsoInstant;
}
/** users/{uid}.status — existing persisted shape (profile.adapter.ts:78-93) with `reason` widened and `scope`
 *  added: the client's refusal copy differs by scope (B2). */
export type AccountStatusDoc =
  | { readonly kind: 'active' }
  | {
      readonly kind: 'blocked';
      readonly reason: PauseReasonCategory;
      readonly untilIso: string | null;
      readonly scope: PauseScope;
    };
const pauseEnd = (p: ClientPause): string =>
  p.term.kind === 'permanent' ? '9999' : p.term.until;
/** The latest-ending live pause (self-service is refused until the LAST pause ends). */
function topLivePause(
  pauses: readonly ClientPause[],
  now: IsoInstant,
): { readonly top: ClientPause; readonly scope: PauseScope } | null {
  const live = pauses.filter((p) => p.state === 'active' && pauseEnd(p) > now);
  if (live.length === 0) return null;
  const top = live.reduce((a, b) => (pauseEnd(b) > pauseEnd(a) ? b : a));
  return {
    top,
    scope: live.some((p) => p.scope === 'allBookings')
      ? 'allBookings'
      : 'selfService',
  }; // strongest live scope
}
/** A category the client may not see is projected as 'manual' (this doc is owner- and staff-readable). */
export function projectAccountStatus(
  pauses: readonly ClientPause[],
  now: IsoInstant,
): AccountStatusDoc {
  const t = topLivePause(pauses, now);
  if (t === null) return { kind: 'active' };
  return {
    kind: 'blocked',
    reason: t.top.reason.clientVisible ? t.top.reason.category : 'manual',
    untilIso: t.top.term.kind === 'permanent' ? null : t.top.term.until,
    scope: t.scope,
  };
}
/** clientProfiles/{uid}.pauseSummary (R48) — what a barber reads of a pause: term, scope, the client-visible
 *  category or a neutral one, basis count, since. Never who paused, never the note. */
export interface PauseSummary {
  readonly term: PauseTerm;
  readonly scope: PauseScope;
  readonly category: PauseReasonCategory;
  readonly basisCount: number;
  readonly since: IsoInstant;
}
export function pauseSummaryOf(
  pauses: readonly ClientPause[],
  now: IsoInstant,
): PauseSummary | null {
  const t = topLivePause(pauses, now);
  return t === null
    ? null
    : {
        term: t.top.term,
        scope: t.scope,
        category: t.top.reason.clientVisible ? t.top.reason.category : 'manual',
        basisCount: t.top.basis.length,
        since: t.top.appliedAt,
      };
}
/** clientStats/{uid}.pauseSuggestion (R25) — «3 неявявания за 60 дни · Спри онлайн записването?». Shown to
 *  client.pause.confirmSuggestion holders while `dismissedAt` is null; «Не сега» and every lift stamp
 *  clientProfiles.pauseSuggestionDismissedAt (R49), which hides it until a newer no-show raises it again. */
export interface PauseSuggestion {
  readonly noShows: number;
  readonly windowDays: number;
  readonly basis: readonly AppointmentId[];
  readonly raisedAt: IsoInstant;
  readonly dismissedAt: IsoInstant | null;
}
export function suggestPause(
  noShows: readonly VisitFact[],
  activePauses: number,
  now: IsoInstant,
  policy: SupportPolicy,
  dismissedAt: IsoInstant | null,
): PauseSuggestion | null {
  if (activePauses > 0) return null;
  const inWindow = noShows.filter(
    (n) =>
      n.at <= now &&
      Date.parse(now) - Date.parse(n.at) <
        policy.suggestPauseWindowDays * DAY_MS,
  );
  if (inWindow.length < policy.suggestPauseNoShows) return null;
  const raisedAt = inWindow.reduce(
    (a, n) => (n.at > a ? n.at : a),
    inWindow[0]?.at ?? now,
  );
  return {
    noShows: inWindow.length,
    windowDays: policy.suggestPauseWindowDays,
    basis: inWindow.map((n) => n.appointmentId),
    raisedAt,
    dismissedAt:
      dismissedAt !== null && dismissedAt >= raisedAt ? dismissedAt : null,
  };
}
/** R25 in an outcome correction: a PATTERN pause whose basis held the corrected visit defaults to «Вдигни» when
 *  the rest no longer holds — below suggestPauseNoShows for a no-show pattern; a late-cancel pattern (no policy
 *  threshold) holds only while every fact it named stands. Every other pause defaults to «Запази». */
export function pauseChoiceDefault(
  p: ClientPause,
  corrected: AppointmentId,
  policy: SupportPolicy,
): 'keep' | 'lift' {
  if (!p.basis.includes(corrected)) return 'keep';
  const rest = p.basis.filter((a) => a !== corrected).length;
  if (p.reason.category === 'no_show_pattern')
    return rest < policy.suggestPauseNoShows ? 'lift' : 'keep';
  if (p.reason.category === 'late_cancellation_pattern')
    return rest < p.basis.length ? 'lift' : 'keep';
  return 'keep';
}

// ── Clientele (staff-only siblings of users/{uid}) ───────────────────────────
/** One VISIT (the client's seats in one appointment, counted once — R33) at the appointment's start. */
export interface VisitFact {
  readonly appointmentId: AppointmentId;
  readonly at: IsoInstant;
}
export interface VisitRef {
  readonly appointmentId: AppointmentId;
  readonly at: IsoInstant;
  /** «Същото» copies these (sec. 5A D-5); `label` is the service name snapshot. */
  readonly legs: readonly {
    readonly serviceId: ServiceId;
    readonly variantId: string | null;
    readonly minutes: number;
    readonly barberId: BarberId;
    readonly label: string;
  }[];
}
/** clientStats/{uid} — worksTheBook-read, write false; materialised by the appointments trigger per VISIT per
 *  subject (appointments.subjectUserIds, R33), by the correction's own transaction, and backfilled once. Holds no
 *  money (a barber reads it whole). Windows are computed at read from the bounded instants (`statWindows`). */
export interface ClientStats {
  readonly userId: UserId;
  /** clientCancels = client-attributable cancellations at any lead time (R35); lateCancels = those inside
   *  bookingPolicy.cancellationWindowHours. Shop-caused cancellations are never counted. */
  readonly lifetime: {
    readonly visitsCompleted: number;
    readonly noShows: number;
    readonly lateCancels: number;
    readonly clientCancels: number;
  };
  readonly last365: {
    readonly visitsCompleted: readonly VisitFact[];
    readonly noShows: readonly VisitFact[];
    readonly lateCancels: readonly VisitFact[];
  };
  readonly firstVisitAt: IsoInstant | null;
  readonly lastVisit: VisitRef | null;
  readonly nextVisit: VisitRef | null;
  /** R34: mean interval between worked visits once there are ≥ 3, shop-caused gaps excluded; else null. */
  readonly avgCadenceDays: number | null;
  readonly preferredBarberId: BarberId | null;
  readonly usualServiceIds: readonly ServiceId[]; // services in ≥ 3 of the last 5 visits (§11)
  readonly pauseSuggestion: PauseSuggestion | null;
  readonly version: number;
  readonly updatedAt: IsoInstant;
}
export interface WindowedCount {
  readonly lifetime: number;
  readonly last12m: number;
  readonly last90d: number;
}
export function statWindows(
  s: ClientStats,
  now: IsoInstant,
): {
  readonly visitsCompleted: WindowedCount;
  readonly noShows: WindowedCount;
  readonly lateCancels: WindowedCount;
} {
  const within = (facts: readonly VisitFact[], days: number): number =>
    facts.filter(
      (f) => f.at <= now && Date.parse(now) - Date.parse(f.at) < days * DAY_MS,
    ).length;
  const w = (lifetime: number, facts: readonly VisitFact[]): WindowedCount => ({
    lifetime,
    last12m: within(facts, 365),
    last90d: within(facts, 90),
  });
  return {
    visitsCompleted: w(s.lifetime.visitsCompleted, s.last365.visitsCompleted),
    noShows: w(s.lifetime.noShows, s.last365.noShows),
    lateCancels: w(s.lifetime.lateCancels, s.last365.lateCancels),
  };
}
/** R33, §11: the client caused it: a `client_*` reason whoever recorded it, `unspecified`/`other` only when `by: 'client'` (2026-09-25),
 *  a converted no-show by the correction's attribution (from the `visit.outcome` adjustment). Also excuses shop-caused rhythm gaps (A5). */
export function clientCaused(
  c: { readonly reason: CancellationReason; readonly by: 'client' | 'staff' },
  correctionAttribution: 'client' | 'shop' | null,
): boolean {
  if (c.reason.kind === 'no_show_converted')
    return correctionAttribution === 'client';
  if (c.reason.kind === 'unspecified' || c.reason.kind === 'other')
    return c.by === 'client';
  return (
    c.reason.kind === 'client_changed_plans' ||
    c.reason.kind === 'client_unwell'
  );
}
/** R34 due cue: last visit + personal cadence (or the policy default); suppressed while a next visit exists. */
export function dueCueOn(
  s: ClientStats,
  policy: LoyaltyPolicy,
): IsoDate | null {
  if (s.nextVisit !== null || s.lastVisit === null) return null;
  return new Date(
    Date.parse(s.lastVisit.at) +
      (s.avgCadenceDays ?? policy.defaultCadenceDays) * DAY_MS,
  )
    .toISOString()
    .slice(0, 10) as IsoDate;
}
/** R57 lapsed line (P1, route Обзор, the due cue's slot): no next visit and today ≥ last visit + max(2 × cadence,
 *  90 days), cadence as dueCueOn reads it, so `since` is never earlier than the due cue. `weeks` = whole weeks since
 *  the last visit; `personalCadenceDays` null (< 3 visits) drops the rhythm clause (`clientCard.fact.lapsedNoRhythm`). */
export interface Lapse {
  readonly since: IsoDate;
  readonly weeks: number;
  readonly personalCadenceDays: number | null;
}
export function lapsedSince(
  s: ClientStats,
  policy: LoyaltyPolicy,
  today: IsoDate,
): Lapse | null {
  if (s.nextVisit !== null || s.lastVisit === null) return null;
  const days = Math.max(
    2 * (s.avgCadenceDays ?? policy.defaultCadenceDays),
    90,
  );
  const since = new Date(Date.parse(s.lastVisit.at) + days * DAY_MS)
    .toISOString()
    .slice(0, 10) as IsoDate;
  if (today < since) return null;
  const weeks = Math.floor(
    (dayNumber(today) - dayNumber(s.lastVisit.at.slice(0, 10) as IsoDate)) / 7,
  );
  return { since, weeks, personalCadenceDays: s.avgCadenceDays };
}
/** clientStats/{uid}/restricted/money — read hasAnyRole(['admin']) only (client.stats.money, R33); same trigger, same version. */
export interface ClientMoneyStats {
  readonly userId: UserId;
  readonly lifetimeSpendMinor: number;
  readonly version: number;
  readonly updatedAt: IsoInstant;
}
/** clientProfiles/{uid} — worksTheBook-read, write false: updateClientProfile, the pause.* commits, the approval
 *  path and commitMerge write it. `flags` are the restricted tags (admin-set). */
export interface ClientProfile {
  readonly userId: UserId;
  readonly tags: readonly TagId[];
  readonly flags: { readonly staffRelated: boolean };
  readonly preferences: { readonly preferredBarberId: BarberId | null };
  readonly pauseSummary: PauseSummary | null;
  readonly pauseSuggestionDismissedAt: IsoInstant | null; // R49: «Не сега», also written on every lift
  /** A12, R38: pending requests as the staff ledger shows them — no requester (front desk reads it on `adjustments`). */
  readonly pendingAdjustments: readonly {
    readonly adjustmentId: AdjustmentId;
    readonly kind: AdjustmentKindTag;
    readonly points: number;
    readonly requestedAt: IsoInstant;
    readonly expiresAt: IsoInstant;
  }[];
  readonly mergedInto: UserId | null;
  readonly version: number;
  readonly updatedAt: IsoInstant;
  readonly updatedBy: Actor;
}
/** settings/clientTags — the owner-curated vocabulary of unrestricted tags; worksTheBook-read, admin-write (P1, R51). */
export interface ClientTagDefinition {
  readonly id: TagId;
  readonly label: LocalizedText;
  readonly order: number;
} // label ≤ 20 chars
/** clientNotes/{uid} — «Бележка за клиента» + «Закачена бележка» (≤ 80). Direct write by writesClientNotes()
 *  (barber, receptionist, admin; not sysadmin); rules pin `writtenAt == request.time`, `authorUid == auth.uid` and
 *  `version == resource.version + 1`, so a stale editor is refused; empty text and pin delete (R48). */
export interface ClientNote {
  readonly text: string;
  readonly pinned: string | null;
  readonly authorUid: UserId;
  readonly writtenAt: FirestoreTimestamp;
  readonly version: number;
}
/** clientNotes/{uid}/versions/{v} — prior texts, written by the client_note.updated trigger (whose audit row is ids
 *  only), staff-read, redactable on erasure or at retention (R36). */
export interface ClientNoteVersion extends ClientNote {
  readonly redactedAt: IsoInstant | null;
}

// ── Capabilities (libs/domain/accounts, beside BOOK_ROLES / MONEY_ROLES) ─────
export const CAPABILITIES = [
  'client.view',
  'client.notes.write',
  'client.tags.write',
  'client.tags.restricted.write',
  'client.identity.edit',
  'client.list',
  'client.stats.money',
  'client.pause.viewDetail',
  'client.pause.confirmSuggestion',
  'visit.outcome.correct',
  'booking.placePaused',
  'loyalty.redeem.onBehalf',
  'loyalty.points.adjust',
  'loyalty.streak.repair',
  'loyalty.streak.freeze.grant',
  'loyalty.streak.set',
  'loyalty.achievement.grant',
  'loyalty.achievement.revoke',
  'loyalty.tier.override',
  'loyalty.reward.reinstate',
  'loyalty.redemption.reverse',
  'loyalty.explain',
  'loyalty.replay',
  'client.pause.temporary',
  'client.pause.permanent',
  'client.pause.edit',
  'client.pause.lift',
  'client.merge',
  'audit.read.client',
  'audit.read.all',
  'audit.export',
  'approvals.decide',
  'rules.draft',
  'rules.publish',
  'rules.simulate',
  'adjust.bulk',
  'client.export',
  'client.erase',
  'settings.supportPolicy.write',
  'roles.assign',
  'ops.backfill',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** settings/supportPolicy — worksTheBook-read, admin-write (per-docId split, R48); defaults-as-floor parser in
 *  the port layer. Key names are canonical (R47); ranges in §3.3. */
export interface SupportPolicy {
  readonly receptionistPointsPerAction: number;
  readonly receptionistPointsPerDay: number;
  readonly perSubjectPoints30d: number;
  readonly adminDigestThreshold: number;
  readonly maxTemporaryPauseDays: number;
  readonly approvalExpiryDays: number;
  readonly undoWindowMinutes: number;
  readonly outcomeCorrectionDays: number;
  readonly barberOutcomeCorrectionDays: number;
  readonly receptionistStreakRepairsPerClientPerYear: number;
  readonly receptionistFreezeGrantsPerClientPerYear: number;
  readonly receptionistReinstateDays: number;
  readonly receptionistStreakExtendMaxDays: number;
  readonly stepUpMaxAgeMinutes: number;
  readonly suggestPauseNoShows: number;
  readonly suggestPauseWindowDays: number; // B1: suggest, never apply
  readonly reliabilityCapsuleNoShows: number;
  readonly reliabilityCapsuleWindowDays: number; // A14 capsule
  readonly anomalyVelocityPerDay: number;
  readonly anomalyRepeatSubject: number;
  readonly anomalyRepeatSubjectDays: number;
  readonly anomalyPreRedemptionHours: number;
  readonly anomalyDormantDays: number;
  readonly maxOpenClaimsPerClient: number;
}
export const DEFAULT_SUPPORT_POLICY: SupportPolicy = {
  receptionistPointsPerAction: 50,
  receptionistPointsPerDay: 150,
  perSubjectPoints30d: 100,
  adminDigestThreshold: 250,
  maxTemporaryPauseDays: 30,
  approvalExpiryDays: 7,
  undoWindowMinutes: 10,
  outcomeCorrectionDays: 30,
  barberOutcomeCorrectionDays: 0, // 0 = the same Sofia business day (R46)
  receptionistStreakRepairsPerClientPerYear: 1,
  receptionistFreezeGrantsPerClientPerYear: 1,
  receptionistReinstateDays: 30,
  receptionistStreakExtendMaxDays: 42,
  stepUpMaxAgeMinutes: 5,
  suggestPauseNoShows: 3,
  suggestPauseWindowDays: 60,
  reliabilityCapsuleNoShows: 2,
  reliabilityCapsuleWindowDays: 90,
  anomalyVelocityPerDay: 5,
  anomalyRepeatSubject: 3,
  anomalyRepeatSubjectDays: 30,
  anomalyPreRedemptionHours: 24,
  anomalyDormantDays: 365,
  maxOpenClaimsPerClient: 3,
};

/** alone = ✔; breakGlass = allowed, logged, flagged `break_glass`, digested (R15). No request-only mode (R2). */
export type CapabilityMode = 'alone' | 'breakGlass';
/** Limits NAME SupportPolicy keys (numbers live in settings); exceeding one routes to approval or refuses. */
export interface CapabilityLimits {
  readonly pointsPerAction?: keyof SupportPolicy;
  readonly pointsPerDay?: keyof SupportPolicy;
  readonly pointsPerSubject30d?: keyof SupportPolicy;
  readonly daysBack?: keyof SupportPolicy;
  readonly perClientPerYear?: keyof SupportPolicy;
  readonly pauseDays?: keyof SupportPolicy;
  readonly ageDays?: keyof SupportPolicy;
  readonly extendDays?: keyof SupportPolicy;
  readonly temporaryOnly?: true;
  readonly onExceed: 'approval' | 'refuse';
}
export interface CapabilityGrant {
  readonly capability: Capability;
  readonly mode: CapabilityMode;
  readonly limits?: CapabilityLimits;
}
const grant = (
  capability: Capability,
  mode: CapabilityMode = 'alone',
  limits?: CapabilityLimits,
): CapabilityGrant =>
  limits === undefined ? { capability, mode } : { capability, mode, limits };

/** §3.2.1. `client` holds none: self-service rides ownership (uid === subject), not capabilities. */
export const ROLE_CAPABILITIES: Readonly<
  Record<UserRole, readonly CapabilityGrant[]>
> = {
  client: [],
  content_manager: [grant('rules.draft')], // no client data at all (R37)
  barber: [
    // R2: no request grants
    grant('client.view'),
    grant('client.notes.write'),
    grant('client.tags.write'),
    grant('visit.outcome.correct', 'alone', {
      daysBack: 'barberOutcomeCorrectionDays',
      onExceed: 'refuse',
    }),
    grant('booking.placePaused'), // selfService pauses only: commitBooking refuses allBookings to non-admins (spine §7)
    grant('loyalty.redeem.onBehalf'), // P5 (R6)
  ],
  receptionist: [
    grant('client.view'),
    grant('client.notes.write'),
    grant('client.tags.write'),
    grant('client.list'),
    grant('client.identity.edit'),
    grant('client.pause.viewDetail'),
    grant('client.pause.confirmSuggestion'),
    grant('visit.outcome.correct', 'alone', {
      daysBack: 'outcomeCorrectionDays',
      onExceed: 'refuse',
    }),
    grant('booking.placePaused'),
    grant('loyalty.redeem.onBehalf'),
    grant('loyalty.points.adjust', 'alone', {
      pointsPerAction: 'receptionistPointsPerAction',
      pointsPerDay: 'receptionistPointsPerDay',
      pointsPerSubject30d: 'perSubjectPoints30d',
      onExceed: 'approval',
    }),
    grant('loyalty.streak.repair', 'alone', {
      perClientPerYear: 'receptionistStreakRepairsPerClientPerYear',
      extendDays: 'receptionistStreakExtendMaxDays',
      onExceed: 'approval',
    }),
    grant('loyalty.streak.freeze.grant', 'alone', {
      perClientPerYear: 'receptionistFreezeGrantsPerClientPerYear',
      onExceed: 'approval',
    }),
    grant('loyalty.achievement.grant'),
    grant('loyalty.reward.reinstate', 'alone', {
      ageDays: 'receptionistReinstateDays',
      onExceed: 'approval',
    }),
    grant('loyalty.redemption.reverse', 'alone', {
      ageDays: 'receptionistReinstateDays',
      onExceed: 'approval',
    }),
    grant('loyalty.explain'),
    grant('loyalty.replay'),
    grant('client.pause.temporary', 'alone', {
      pauseDays: 'maxTemporaryPauseDays',
      onExceed: 'approval',
    }),
    grant('client.pause.lift', 'alone', {
      temporaryOnly: true,
      onExceed: 'refuse',
    }),
    grant('audit.read.client'),
  ],
  admin: CAPABILITIES.filter((c) => c !== 'ops.backfill').map((c) =>
    c === 'visit.outcome.correct'
      ? grant(c, 'alone', {
          daysBack: 'outcomeCorrectionDays',
          onExceed: 'refuse',
        })
      : grant(c),
  ),
  sysadmin: [
    // R15: read-only on the route; points only as break-glass; never decides approvals
    grant('client.view', 'breakGlass'),
    grant('client.list'),
    grant('client.pause.viewDetail', 'breakGlass'),
    grant('loyalty.explain'),
    grant('loyalty.points.adjust', 'breakGlass'),
    grant('audit.read.client'),
    grant('audit.read.all'),
    grant('audit.export', 'breakGlass'),
    grant('roles.assign', 'breakGlass'),
    grant('ops.backfill'),
  ],
};
/** H1: acts ON a client record — refused on one's own record, for every role. */
export const CLIENT_MUTATIONS: ReadonlySet<Capability> = new Set<Capability>([
  'client.tags.restricted.write',
  'visit.outcome.correct',
  'booking.placePaused',
  'loyalty.redeem.onBehalf',
  'loyalty.points.adjust',
  'loyalty.streak.repair',
  'loyalty.streak.freeze.grant',
  'loyalty.streak.set',
  'loyalty.achievement.grant',
  'loyalty.achievement.revoke',
  'loyalty.tier.override',
  'loyalty.reward.reinstate',
  'loyalty.redemption.reverse',
  'loyalty.replay',
  'client.pause.temporary',
  'client.pause.confirmSuggestion',
  'client.pause.permanent',
  'client.pause.edit',
  'client.pause.lift',
  'client.merge',
]);
/** H2: on a staff-related subject a non-admin's act becomes a request. A placement, an on-behalf redemption and a
 *  replay create no value and have no request path, so they are never routed (H1 still binds them). */
const NEVER_ROUTED: ReadonlySet<Capability> = new Set<Capability>([
  'booking.placePaused',
  'loyalty.redeem.onBehalf',
  'loyalty.replay',
]);
/** R40: the admin-set flag, or a staff role on the subject (implicit). Read inside the transaction. */
export const isStaffRelated = (
  flags: { readonly staffRelated: boolean },
  subjectRoles: readonly UserRole[],
): boolean =>
  flags.staffRelated || subjectRoles.some((r) => STAFF_ROLES.includes(r));
export function capabilityFor(k: AdjustmentKind): Capability {
  switch (k.kind) {
    case 'points.credit':
    case 'points.debit':
      return 'loyalty.points.adjust';
    case 'streak.repair':
    case 'streak.extend':
      return 'loyalty.streak.repair';
    case 'streak.freezeGrant':
      return 'loyalty.streak.freeze.grant';
    case 'streak.reset':
    case 'streak.set':
      return 'loyalty.streak.set';
    case 'achievement.grant':
      return 'loyalty.achievement.grant';
    case 'achievement.revoke':
      return 'loyalty.achievement.revoke';
    case 'tier.override':
    case 'tier.clear':
      return 'loyalty.tier.override';
    case 'reward.reinstate':
      return 'loyalty.reward.reinstate';
    case 'redemption.reverse':
      return 'loyalty.redemption.reverse'; // the redeemer's receipt undo: decide() via probe.receiptUndo (R6)
    // a `fromSuggestion` apply also needs client.pause.confirmSuggestion (the notice's gate)
    case 'pause.apply':
      return k.term.kind === 'permanent' || k.scope === 'allBookings'
        ? 'client.pause.permanent'
        : 'client.pause.temporary';
    case 'pause.edit':
      return 'client.pause.edit';
    case 'pause.lift':
      return 'client.pause.lift';
    case 'visit.outcome':
      return 'visit.outcome.correct';
    case 'client.merge':
      return 'client.merge';
    case 'adjustment.reverse':
      return capabilityFor(k.original.kind); // undo needs what the original needed
  }
}

/** What the callable knows about THIS request when it checks limits (all read inside the transaction). */
export interface CapabilityProbe {
  readonly actorUid: UserId;
  readonly subject?: { readonly uid: UserId; readonly staffRelated: boolean };
  readonly points?: number; // |Σ points| this act writes — a manual grant's payout and an undo's inverse included
  readonly pointsToday?: number; // pointsToday(): the actor's rolling 24 h, from supportActors/{actorUid}
  readonly pointsOnSubject30d?: number; // pointsOnSubject30d(): non-admin manual points on this subject, 30 days (R40)
  readonly daysBack?: number;
  readonly pauseDays?: number;
  readonly pauseTerm?: 'temporary' | 'permanent';
  readonly perClientThisYear?: number; // same act on this client in the last 365 days, INCLUDING this one
  readonly ageDays?: number; // of the redemption / grant being reversed or reinstated
  readonly extendDays?: number; // streak.extend
  readonly requesterUid?: UserId; // approvals.decide (with `subject` = the request's client)
  readonly receiptUndo?: boolean; // R6: receiptUndoOf(…) === 'admitted' on the redemption a redemption.reverse names, read in the transaction
}
export type CapabilityDecision =
  | { readonly kind: 'allowed' | 'breakGlass' | 'absent' }
  | { readonly kind: 'approval'; readonly reason: ApprovalReason }
  | {
      readonly kind: 'refused';
      readonly reason: 'self' | 'ownRequest' | 'overLimit';
    };
const RANK: Readonly<Record<CapabilityDecision['kind'], number>> = {
  absent: 0,
  refused: 1,
  approval: 2,
  breakGlass: 3,
  allowed: 4,
};
function exceeds(
  l: CapabilityLimits,
  p: CapabilityProbe,
  policy: SupportPolicy,
): boolean {
  const cap = (k: keyof SupportPolicy | undefined): number =>
    k === undefined ? Infinity : policy[k];
  return (
    (p.points ?? 0) > cap(l.pointsPerAction) ||
    (p.pointsToday ?? 0) > cap(l.pointsPerDay) ||
    (p.pointsOnSubject30d ?? 0) > cap(l.pointsPerSubject30d) ||
    (p.daysBack ?? 0) > cap(l.daysBack) ||
    (p.perClientThisYear ?? 0) > cap(l.perClientPerYear) ||
    (p.pauseDays ?? 0) > cap(l.pauseDays) ||
    (p.ageDays ?? 0) > cap(l.ageDays) ||
    (p.extendDays ?? 0) > cap(l.extendDays) ||
    (l.temporaryOnly === true && p.pauseTerm === 'permanent')
  );
}
function decideGrant(
  g: CapabilityGrant,
  p: CapabilityProbe,
  policy: SupportPolicy,
): CapabilityDecision {
  if (g.limits !== undefined && exceeds(g.limits, p, policy)) {
    return g.limits.onExceed === 'approval'
      ? { kind: 'approval', reason: 'overLimit' }
      : { kind: 'refused', reason: 'overLimit' };
  }
  return { kind: g.mode === 'breakGlass' ? 'breakGlass' : 'allowed' };
}
/** The one authorisation function (callables authoritative, with FRESH roles, F3; the UI uses it only to decide
 *  ABSENCE). Roles are a set: most permissive wins. H1 covers deciding an approval whose subject is the decider. */
export function decide(
  roles: readonly UserRole[],
  capability: Capability,
  probe: CapabilityProbe,
  policy: SupportPolicy = DEFAULT_SUPPORT_POLICY,
): CapabilityDecision {
  if (
    capability === 'loyalty.redemption.reverse' &&
    probe.receiptUndo === true
  ) {
    // R6: decided as the act it compensates (H1 binds; row 20 is never routed) or as the reversal, whichever admits more
    const plain: CapabilityProbe = { ...probe, receiptUndo: false };
    const asUndo = decide(roles, 'loyalty.redeem.onBehalf', plain, policy);
    const asReverse = decide(roles, capability, plain, policy);
    return RANK[asUndo.kind] >= RANK[asReverse.kind] ? asUndo : asReverse;
  }
  const onSubject =
    CLIENT_MUTATIONS.has(capability) && probe.subject !== undefined;
  const selfBound = onSubject || capability === 'approvals.decide';
  if (selfBound && probe.subject?.uid === probe.actorUid)
    return { kind: 'refused', reason: 'self' };
  if (
    capability === 'approvals.decide' &&
    probe.requesterUid === probe.actorUid
  )
    return { kind: 'refused', reason: 'ownRequest' };
  let best: CapabilityDecision = { kind: 'absent' };
  for (const role of roles) {
    const g = ROLE_CAPABILITIES[role].find((x) => x.capability === capability);
    const d: CapabilityDecision =
      g === undefined ? best : decideGrant(g, probe, policy);
    if (RANK[d.kind] > RANK[best.kind]) best = d;
  }
  const permitted = best.kind === 'allowed' || best.kind === 'breakGlass';
  if (
    permitted &&
    onSubject &&
    !NEVER_ROUTED.has(capability) &&
    probe.subject?.staffRelated === true &&
    !roles.includes('admin')
  ) {
    return { kind: 'approval', reason: 'staffRelated' };
  }
  return best;
}

/** supportActors/{uid} — the per-ACTOR serialisation point: every manual act reads and rewrites it in its
 *  transaction. Two requests by one actor on DIFFERENT clients touch different loyaltyAccounts docs, so without it
 *  both could pass the rolling day cap. Keeps anomalyRepeatSubjectDays of committed acts; feeds velocity/repeat flags. */
export interface SupportActorUsage {
  readonly userId: UserId;
  readonly version: number;
  readonly recent: readonly {
    readonly adjustmentId: AdjustmentId;
    readonly at: IsoInstant;
    readonly subjectUserId: UserId;
    readonly kind: AdjustmentKindTag;
    readonly points: number;
    readonly compensatesOwn: boolean; // an undo of the actor's own entry frees nothing and costs nothing
  }[];
}
const rollingPoints = (
  rows: readonly { readonly at: IsoInstant; readonly points: number }[],
  now: IsoInstant,
  days: number,
  thisPoints: number,
): number =>
  rows.reduce(
    (sum, r) =>
      Date.parse(r.at) > Date.parse(now) - days * DAY_MS ? sum + r.points : sum,
    thisPoints,
  );
/** The actor's rolling-24 h Σ|points| INCLUDING this request (`CapabilityProbe.pointsToday`). */
export const pointsToday = (
  u: SupportActorUsage,
  now: IsoInstant,
  thisPoints: number,
): number =>
  rollingPoints(
    u.recent.filter((r) => !r.compensatesOwn),
    now,
    1,
    thisPoints,
  );
/** R40: Σ|points| of non-admin manual acts on the subject in 30 days (adjustments by subjectUserId), this one included. */
export const pointsOnSubject30d = (
  rows: readonly {
    readonly at: IsoInstant;
    readonly points: number;
    readonly byAdmin: boolean;
  }[],
  now: IsoInstant,
  thisPoints: number,
): number =>
  rollingPoints(
    rows.filter((r) => !r.byAdmin),
    now,
    30,
    thisPoints,
  );

// ── Idempotency keys (pure) ──────────────────────────────────────────────────
/** R28: the per-visit occurrence is the SEAT FACT, never the revisioned event id. */
export const seatFactKey = (
  appointmentId: AppointmentId,
  seatId: SeatId,
): string => `appt:${appointmentId}:seat:${seatId}`;
export type OccurrenceError = 'needsEveryNth' | 'needsReferee';
/** Recurrence → occurrence key (spine §8). `nth` = the metric and the multiple the rule's everyNth node crossed. */
export function occurrenceKey(
  r: Recurrence,
  input: {
    readonly trigger: Pick<Trigger, 'factKey' | 'localDate' | 'event'>;
    readonly nth: { readonly metric: Metric; readonly multiple: number } | null;
  },
): Result<string, OccurrenceError> {
  switch (r.kind) {
    case 'once':
      return ok('once');
    case 'perOccurrence':
      return input.nth === null
        ? fail('needsEveryNth')
        : ok(`${input.nth.metric}:${input.nth.multiple}`);
    case 'perEvent':
      return ok(input.trigger.factKey);
    case 'perPeriod':
      return ok(input.trigger.localDate.slice(0, r.period === 'year' ? 4 : 7));
    case 'perReferee': {
      const e = input.trigger.event;
      return e.kind === 'referral.redeemed' ||
        e.kind === 'referral.refereeVisitCompleted'
        ? ok(e.refereeUserId)
        : fail('needsReferee');
    }
  }
}
/** awards/{awardKey} = `${ruleId}:${subject}:${occurrenceKey}`, no prefix (R28). Shop-scope rules key on 'shop'. */
export const awardKey = (
  ruleId: RuleId,
  subject: UserId | 'shop',
  occurrence: string,
): AwardKey => `${ruleId}:${subject}:${occurrence}` as AwardKey;
/** Journal idempotency keys: `award:` for engine payouts (one per award index, plus the badge), `adj:` for adjustments. */
export const awardEntryKey = (
  key: AwardKey,
  slot: number | 'badge',
): IdempotencyKey => `award:${key}#${slot}` as IdempotencyKey;
export const adjustmentEntryKey = (
  id: AdjustmentId,
  index: number,
): IdempotencyKey => `adj:${id}#${index}` as IdempotencyKey;
