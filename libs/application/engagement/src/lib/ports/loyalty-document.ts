import type { UserRole } from '@creativo/domain/accounts';
import { LocalizedText } from '@creativo/domain/catalog';
import {
  type ActivityEffect,
  type ActivityEntry,
  type ActivityKind,
  BADGE_CATEGORY_KINDS,
  BADGE_EMBLEMS,
  BadgeCategory,
  type BadgeCategoryKind,
  type BadgeEmblem,
  type BadgeProgress,
  BadgeSeries,
  type BadgeSeriesProps,
  type IsoDate,
  type LedgerEntry,
  type LoyaltyAccount,
  LoyaltyCatalog,
  METRICS,
  type Metric,
  PERK_IDS,
  PERSONAL_RECORD_KINDS,
  type PerkId,
  type PersonalRecord,
  type PersonalRecordKind,
  type RewardCatalogItem,
  type RewardGrant,
  STREAK_EXCUSES,
  STREAK_INTERVAL_KINDS,
  STREAK_ON_BREAK,
  STREAK_QUALIFIER_KINDS,
  STREAK_TRANSITIONS,
  Season,
  type SeasonProgress,
  StreakDefinition,
  type StreakDefinitionProps,
  StreakDefinitionSchedule,
  type StreakExcuse,
  type StreakHold,
  type StreakIntervalProps,
  type StreakIntervalSource,
  type StreakOnBreak,
  type StreakPeriodFact,
  type StreakPeriodTerms,
  type StreakPhase,
  type StreakQualifierProps,
  type StreakRuleChange,
  type StreakRuleDirection,
  type StreakState,
  type StreakTransition,
  type TierDefinition,
  type TierState,
  isIsoDate,
  isOneOf,
} from '@creativo/domain/engagement';
import { type Result, fail, ok } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';

/**
 * The persisted shapes of the loyalty read model — the achievements
 * catalogue, a client's account and progress, and the client journal
 * (client-card-redesign.md §4.4–§4.5) — defined here, in the port layer,
 * because three writers and readers share them: the functions and the dev
 * seed write through `firebase-admin`, the web reads through
 * `firebase/firestore`, and the fixtures under `@creativo/application/
 * engagement/testing` are parsed by both sides' specs. One definition, so
 * the wire cannot drift between them. Plain objects, no SDK.
 *
 * Wire rules, stated once:
 * - A document's id is its Firestore id and is NOT repeated in its body —
 *   except `userId` on `loyaltyAccounts` and `clientJournal`, which the
 *   rules and the ledger query read.
 * - Instants are ISO-8601 UTC strings (`2026-09-04T07:12:00.000Z`), never
 *   Timestamps; calendar dates are Europe/Sofia `YYYY-MM-DD`; points are
 *   integers; every text a person reads is a `{ bg, en }` pair.
 * - Arrays keep their model names (`levels`, `earned`, `records`,
 *   `punchCards`, `seriesIds`); the journal's `effect` is ONE tagged object,
 *   so `effect.kind` is queryable.
 * - The rhythm's rule is judged by DAY: a version's `effectiveFrom` is a
 *   Europe/Sofia date, never an instant, and a reader resolves the rule in
 *   force by date (client-card-revision-3.md §4.3).
 *
 * The closed vocabularies are the domain's own unions (`@creativo/domain/
 * engagement`), spelled the same on the wire; the few the domain does not
 * model yet stay below. Reads parse every one of them; an unknown value
 * makes the document malformed, never a guess.
 *
 * The readers at the foot (`*FromDocument`) go through the domain's
 * factories, so a document the domain would refuse never becomes a model.
 */

// ── Collections ─────────────────────────────────────────────────────────

/** `badgeCategories/{categoryId}` — the «Постижения» shelves. */
export const BADGE_CATEGORIES_COLLECTION = 'badgeCategories';
/** `badgeSeries/{seriesId}` — one medal family each. */
export const BADGE_SERIES_COLLECTION = 'badgeSeries';
/** `seasons/{seasonId}` — seasons and events, dated windows. */
export const SEASONS_COLLECTION = 'seasons';
/** `tierDefinitions/{tierId}` */
export const TIER_DEFINITIONS_COLLECTION = 'tierDefinitions';
/** `rewardsCatalog/{rewardId}` */
export const REWARDS_CATALOG_COLLECTION = 'rewardsCatalog';
/** `streakDefinitions/{streakId}` — the head: the rule in force and the one that waits. */
export const STREAK_DEFINITIONS_COLLECTION = 'streakDefinitions';
/**
 * `streakDefinitions/{streakId}/versions/{version:06}`
 * (`streakDefinitionVersionId`) — one document per publish, immutable. The
 * history is the admin page's; it is no part of the catalogue a card reads.
 */
export const STREAK_DEFINITION_VERSIONS_COLLECTION = 'versions';
/** `loyaltyAccounts/{uid}` — one per client; staff-read, server-written. */
export const LOYALTY_ACCOUNTS_COLLECTION = 'loyaltyAccounts';
/** `loyaltyAccounts/{uid}/badgeProgress/{seriesId}` — absent = not started. */
export const BADGE_PROGRESS_COLLECTION = 'badgeProgress';
/** `loyaltyAccounts/{uid}/seasonProgress/{seasonId}` — a season's track only. */
export const SEASON_PROGRESS_COLLECTION = 'seasonProgress';
/** `clientJournal/{uid}_{seq:06}` — append-only. */
export const CLIENT_JOURNAL_COLLECTION = 'clientJournal';

/**
 * The six catalogue collections, in the order a reader loads them. They are
 * presentation, not personal data: any signed-in person reads them, and
 * the dev seed writes all six under `--catalog-only`.
 */
export const LOYALTY_CATALOG_COLLECTIONS = [
  BADGE_CATEGORIES_COLLECTION,
  BADGE_SERIES_COLLECTION,
  SEASONS_COLLECTION,
  TIER_DEFINITIONS_COLLECTION,
  REWARDS_CATALOG_COLLECTION,
  STREAK_DEFINITIONS_COLLECTION,
] as const;

/**
 * A journal entry's document id: the client, then the entry's dense
 * per-client sequence padded to six digits, so ids sort as the ledger does.
 */
export function clientJournalEntryId(userId: string, seq: number): string {
  return `${userId}_${String(seq).padStart(6, '0')}`;
}

/**
 * A rule version's document id: the version padded to six digits, so the
 * history sorts by document id and needs no index.
 */
export function streakDefinitionVersionId(version: number): string {
  return String(version).padStart(6, '0');
}

// ── Vocabularies the domain does not model yet ─────────────────────────

type SeatOutcomeKind = 'scheduled' | 'worked' | 'no_show' | 'cancelled';

type PauseScope = 'selfService' | 'allBookings';

/** Client-visible copy keys; i18n resolves them with the row's `params`. */
const PUBLIC_LABEL_CODES = [
  'points.opening',
  'points.rule',
  'points.goodwill',
  'points.serviceIssue',
  'points.correction',
  'points.accountMerge',
  'points.redeemed',
  'points.redemptionReversed',
  'points.expired',
  'points.debtCleared',
  'points.reversed',
  'achievement.earned',
  'achievement.revoked',
  'streak.changed',
  'freeze.changed',
  'tier.changed',
  'reward.granted',
  'reward.reinstated',
  'reward.revoked',
  'redemption.changed',
  'pause.changed',
  'visit.outcomeCorrected',
  'preview.stat',
  'choice.awardNoLongerMet',
  'choice.manualPause',
  'choice.upcomingBooking',
] as const;
type PublicLabelCode = (typeof PUBLIC_LABEL_CODES)[number];

// ── Shared parts ────────────────────────────────────────────────────────

/** Both locales, both non-empty. */
export interface LocalizedTextDocument {
  readonly bg: string;
  readonly en: string;
}

/** A rule version a journal entry cites (`ruleId@version`). */
export interface RuleRefDocument {
  readonly ruleId: string;
  readonly version: number;
}

/** What a family counts. A season's families count inside its window, so they carry none. */
export interface MetricRefDocument {
  readonly metric: Metric;
  readonly window?: { readonly lastDays: number };
  /** Narrows a visit count to one service, barber or location. */
  readonly where?: {
    readonly serviceId?: string;
    readonly barberId?: string;
    readonly locationId?: string;
  };
}

/** What a level paid, for «донесе …»: a summary of the awarding rule's awards. */
export type AwardSummaryDocument =
  | { readonly kind: 'points'; readonly points: number }
  | { readonly kind: 'coupon'; readonly title: LocalizedTextDocument }
  | { readonly kind: 'freeze'; readonly count: number }
  | {
      readonly kind: 'perk';
      readonly perkId: PerkId;
      readonly forDays: number | null;
    };

/** The catalogue thing a family is about; its art comes from it. */
export type BadgeSubjectDocument =
  | { readonly kind: 'service'; readonly serviceId: string }
  | { readonly kind: 'barber'; readonly barberId: string }
  | { readonly kind: 'location'; readonly locationId: string };

// ── The catalogue ───────────────────────────────────────────────────────

/** `badgeCategories/{categoryId}` */
export interface BadgeCategoryDocument {
  readonly kind: BadgeCategoryKind;
  readonly title: LocalizedTextDocument;
  readonly order: number;
}

/** One level of a family: 1-based, contiguous, drawn «I»…«V». */
export interface BadgeLevelDocument {
  readonly level: number;
  /** The once-rule that awards this level (one award key per level). */
  readonly ruleId: string;
  /** On the family's metric; `null` = a one-off act (the family's only level). */
  readonly target: number | null;
  /** «25 посещения с фейд» */
  readonly requirement: LocalizedTextDocument;
  /** Empty for a recognition-only level. */
  readonly awards: readonly AwardSummaryDocument[];
}

/**
 * `badgeSeries/{seriesId}` — ONE medal family, the unit the card draws. It
 * lives in a category or in a season, never in neither.
 */
export interface BadgeSeriesDocument {
  readonly categoryId: string | null;
  readonly seasonId: string | null;
  /** «Фейд» */
  readonly title: LocalizedTextDocument;
  /** The family's sentence without a figure: «Посещения с фейд». */
  readonly requirement: LocalizedTextDocument;
  readonly emblem: BadgeEmblem;
  readonly subject: BadgeSubjectDocument | null;
  /**
   * `null` for a one-off act, and for the rhythm family, whose value is the
   * cadence streak's best run rather than a registry metric.
   */
  readonly metric: MetricRefDocument | null;
  /** Owner art in Storage; wins over the subject's art and the emblem. */
  readonly art: { readonly path: string } | null;
  readonly levels: readonly BadgeLevelDocument[];
  /** Earned again every year (the birthday visit); then the only level. */
  readonly repeatable: boolean;
  readonly order: number;
  readonly retiredAt: string | null;
  readonly version: number;
}

/**
 * `seasons/{seasonId}` — a named, dated window, Europe/Sofia, inclusive. A
 * season has a track (the family its gauge draws); an event is a short
 * window without one.
 */
export interface SeasonDocument {
  readonly kind: 'season' | 'event';
  readonly title: LocalizedTextDocument;
  readonly emblem: BadgeEmblem;
  readonly window: { readonly from: string; readonly until: string };
  readonly trackSeriesId: string | null;
  /** The window's other families, in order — never the track. */
  readonly seriesIds: readonly string[];
  readonly announcedAt: string;
  readonly version: number;
}

/** `tierDefinitions/{tierId}` — qualifying is counted in visits, never points. */
export interface TierDefinitionDocument {
  readonly name: LocalizedTextDocument;
  readonly rank: number;
  readonly benefits: readonly PerkId[];
  readonly version: number;
  readonly effectiveFrom: string;
  readonly qualify: {
    readonly metric: Metric;
    readonly atLeast: number;
    readonly window: { readonly lastDays: number };
  };
}

/** What a redeemed reward mints. */
export type RewardGrantDocument =
  | { readonly kind: 'coupon'; readonly couponId: string }
  | {
      readonly kind: 'voucher';
      readonly amountMinor: number;
      readonly expiresInDays: number;
    }
  | {
      readonly kind: 'perk';
      readonly perkId: PerkId;
      readonly forDays: number | null;
    };

/** `rewardsCatalog/{rewardId}` */
export interface RewardCatalogItemDocument {
  readonly name: LocalizedTextDocument;
  readonly cost: number;
  readonly enabled: boolean;
  readonly order: number;
  readonly grants: RewardGrantDocument;
  /** Europe/Sofia dates, inclusive; `null` = open-ended. */
  readonly available: {
    readonly from: string | null;
    readonly until: string | null;
  };
  readonly limits: {
    readonly perClient: {
      readonly count: number;
      readonly windowDays: number;
    } | null;
    readonly total: number | null;
  };
  /** Kept inside the redemption transaction. */
  readonly redeemedCount: number;
}

/** How long a period lasts (P5): one number for everyone, or the person's own habit between a floor and a ceiling. */
export type StreakIntervalDocument =
  | { readonly kind: 'fixed'; readonly days: number }
  | {
      readonly kind: 'personal';
      readonly tolerancePct: number;
      readonly minDays: number;
      readonly maxDays: number;
      /** A new client's interval, while nobody knows the habit. */
      readonly fallbackDays: number;
    };

/** Which visit keeps the rhythm (P2). A list names at least one id. */
export type StreakQualifierDocument =
  | { readonly kind: 'anyVisit' }
  | { readonly kind: 'services'; readonly serviceIds: readonly string[] }
  | { readonly kind: 'categories'; readonly categoryIds: readonly string[] };

/**
 * ONE VERSION of the rhythm's rule, «Посещения в ритъм», as the admin
 * publishes it (client-card-revision-3.md §4.1, P1–P12): what the head
 * holds as `current` and `scheduled`, what a version document starts with,
 * and the draft the publish callable takes. It carries neither the rule's
 * id (the document's) nor its name (the head's): every version of a rule
 * is a version of the same thing. Every figure is whole days or a count.
 */
export interface StreakDefinitionBodyDocument {
  /** Rises by one with every publish. */
  readonly version: number;
  /** The first Europe/Sofia DAY this version judges by. */
  readonly effectiveFrom: string;
  readonly enabled: boolean;
  readonly qualifier: StreakQualifierDocument;
  readonly minGapDays: number;
  readonly bookingHold: {
    readonly enabled: boolean;
    readonly maxDaysPastDue: number;
  };
  readonly interval: StreakIntervalDocument;
  readonly graceDays: number;
  readonly riskLeadDays: number;
  /** The UI word is «защита». A protection applies by itself and costs nothing: that is no field. */
  readonly protections: {
    readonly enabled: boolean;
    readonly maxBanked: number;
    readonly earnEvery: number;
    readonly startWith: number;
  };
  readonly excuses: readonly StreakExcuse[];
  readonly clientPause: {
    readonly enabled: boolean;
    readonly maxDaysPerYear: number;
  };
  readonly repair: {
    readonly enabled: boolean;
    readonly windowDays: number;
    readonly perYear: number;
  };
  readonly onBreak: StreakOnBreak;
}

/** The version that waits for its day, and what it will do to the runs that exist. */
export interface StreakDefinitionScheduledDocument extends StreakDefinitionBodyDocument {
  readonly transition: StreakTransition;
}

/**
 * `streakDefinitions/{streakId}` — the HEAD, what every reader loads: the
 * version in force and at most ONE that waits. A reader resolves the rule
 * by date (`scheduled` from its own day on), so nothing has to run at
 * midnight to flip it. Written by the publish callable only.
 */
export interface StreakDefinitionHeadDocument {
  readonly name: LocalizedTextDocument;
  readonly current: StreakDefinitionBodyDocument;
  readonly scheduled: StreakDefinitionScheduledDocument | null;
  readonly updatedAt: string;
}

/**
 * `streakDefinitions/{streakId}/versions/{version:06}` — one publish,
 * immutable: the body, and how it came to be. `publishedBy` is a uid,
 * `requestId` the intent that made it (a retry writes nothing), and
 * `withdrawnAt` the one field that is ever set later: a scheduled version
 * that was called off, or replaced, before its day.
 */
export interface StreakDefinitionVersionDocument extends StreakDefinitionBodyDocument {
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly transition: StreakTransition;
  /** Whom the change favoured, against the version before it. */
  readonly direction: StreakRuleDirection;
  /** The parameters that differ from the version before it; never a version's identity. */
  readonly changed: readonly StreakRuleParameter[];
  readonly requestId: string;
  readonly withdrawnAt: string | null;
}

/** A parameter of the rule a change can list: every one of them, and the name. */
export type StreakRuleParameter = Exclude<
  keyof StreakDefinitionProps,
  'id' | 'version' | 'effectiveFrom'
>;

// ── A client's account ──────────────────────────────────────────────────

/** The account's tier: computed, with an optional manual override. */
export interface TierStateDocument {
  readonly current: string;
  readonly definitionVersion: number;
  readonly since: string;
  /** Visits in the qualifying window. */
  readonly qualifying: number;
  readonly next: string | null;
  readonly remaining: number | null;
  readonly override: {
    readonly tierId: string;
    readonly until: string | null;
    readonly source:
      | { readonly kind: 'award'; readonly awardKey: string }
      | { readonly kind: 'adjustment'; readonly adjustmentId: string };
  } | null;
}

export type StreakPhaseDocument =
  | { readonly kind: 'active' }
  | { readonly kind: 'atRisk'; readonly dueBy: string }
  | { readonly kind: 'inGrace'; readonly graceUntil: string }
  | {
      readonly kind: 'frozen';
      readonly until: string;
      /** `excuse`: the open period runs on a miss that was the shop's. */
      readonly reason: 'freeze' | 'pause' | 'clientPause' | 'excuse';
    }
  | {
      readonly kind: 'broken';
      readonly brokenAt: string;
      readonly repairableUntil: string;
    };

/**
 * One closed period of the rhythm, as the track draws it. `kept` and
 * `repaired` are dated by the visit's day; `protected` and `missed` by the
 * due date nobody met. `reason` says what covered a `protected` period and
 * is `null` on every other mark.
 */
export interface StreakPeriodFactDocument {
  readonly mark: 'kept' | 'protected' | 'repaired' | 'missed';
  readonly on: string;
  readonly reason: 'freeze' | StreakExcuse | 'pause' | 'clientPause' | null;
}

/**
 * The open period's terms, pinned when it opened. `habitDays` is the
 * person's own interval to one decimal (the only figure of the wire that
 * is not whole), known only where `source` is `personal`.
 */
export interface StreakPeriodTermsDocument {
  readonly intervalDays: number;
  readonly graceDays: number;
  readonly source: StreakIntervalSource;
  readonly habitDays: number | null;
}

/**
 * One streak's projection, recomputed from visit facts. The last four
 * fields are OPTIONAL on the wire: a state written before revision 3
 * holds none of them, and reads as no pinned terms, no closed periods, no
 * hold and no day the run began. A writer always writes all four.
 */
export interface StreakStateDocument {
  readonly streakId: string;
  readonly definitionVersion: number;
  readonly phase: StreakPhaseDocument;
  readonly current: number;
  readonly best: number;
  readonly lastQualifiedAt: string | null;
  readonly dueBy: string | null;
  readonly freezesBanked: number;
  /** `null` while no period is open (`broken`). */
  readonly period?: StreakPeriodTermsDocument | null;
  /** The newest twelve closed periods, oldest first. */
  readonly periods?: readonly StreakPeriodFactDocument[];
  /** The visit on the book that holds the open period; `null` when none does. */
  readonly heldBy?: {
    readonly appointmentId: string;
    readonly on: string;
  } | null;
  /**
   * The Europe/Sofia day the run in progress began, however long ago;
   * `null` while `current` is 0.
   */
  readonly runStartedOn?: string | null;
}

/** A stamp card («4 от 10»), titled by what its last stamp pays. */
export interface PunchCardDocument {
  readonly ruleId: string;
  readonly filled: number;
  readonly size: number;
  readonly title: LocalizedTextDocument;
}

/**
 * A personal best. `longestRhythm` dates the run's last visit (`on`);
 * `mostVisitsInYear` names the `year`; `favouriteService` names the
 * `serviceId` and its visits; `firstVisit` is `value` 1 on its day.
 */
export interface PersonalRecordDocument {
  readonly kind: PersonalRecordKind;
  readonly value: number;
  readonly on: string | null;
  readonly year: number | null;
  readonly serviceId: string | null;
}

/**
 * `loyaltyAccounts/{uid}` — the per-client projection. `balance` is the sum
 * of every points effect: `lifetimeEarned + lifetimeAdjusted −
 * lifetimeSpent`. `seq` is the last journal entry folded in; `version` bumps
 * with every write.
 */
export interface LoyaltyAccountDocument {
  readonly userId: string;
  readonly balance: number;
  readonly lifetimeEarned: number;
  readonly lifetimeAdjusted: number;
  readonly lifetimeSpent: number;
  readonly tier: TierStateDocument;
  /** Keyed by streak id. */
  readonly streaks: Readonly<Record<string, StreakStateDocument>>;
  readonly punchCards: readonly PunchCardDocument[];
  readonly records: readonly PersonalRecordDocument[];
  /** `null` while expiry is off, or when nothing can lapse. */
  readonly pointsExpiry: {
    readonly expiresOn: string;
    readonly noticeFrom: string;
  } | null;
  readonly seq: number;
  readonly version: number;
  readonly updatedAt: string;
}

/**
 * `loyaltyAccounts/{uid}/badgeProgress/{seriesId}` — one family's progress.
 * `earned` lists each level once, lowest first; `count` is how many times a
 * repeatable level was earned, and `earnedAt` the latest of them.
 */
export interface BadgeProgressDocument {
  readonly value: number;
  readonly earned: readonly {
    readonly level: number;
    readonly earnedAt: string;
    readonly via: 'rule' | 'manual';
    readonly count: number;
  }[];
}

/** `loyaltyAccounts/{uid}/seasonProgress/{seasonId}` — the season's track at a glance. */
export interface SeasonProgressDocument {
  readonly trackValue: number;
  /** The track's highest earned level; 0 = none yet. */
  readonly trackLevel: number;
}

// ── The journal ─────────────────────────────────────────────────────────

/** Who wrote an entry — `serializeActor`'s shape, ids only. */
export type JournalActorDocument =
  | { readonly kind: 'system'; readonly source: string }
  | { readonly kind: 'user'; readonly userId: string }
  | {
      readonly kind: 'staff';
      readonly userId: string;
      readonly roles: readonly UserRole[];
    }
  | { readonly kind: 'admin'; readonly adminUserId: string }
  | {
      readonly kind: 'impersonator';
      readonly adminUserId: string;
      readonly targetUserId: string;
      readonly sessionId: string;
      readonly scope: 'read' | 'write';
    };

/** A reward a client holds. */
export type RewardRefDocument =
  | { readonly kind: 'couponGrant'; readonly id: string }
  | { readonly kind: 'giftVoucher'; readonly id: string }
  | { readonly kind: 'perk'; readonly perkId: PerkId }
  | { readonly kind: 'cosmetic'; readonly cosmeticId: 'frame.welcome' };

export type PauseTermDocument =
  | { readonly kind: 'temporary'; readonly until: string }
  | { readonly kind: 'permanent' };

/** What an entry changed. `points` is the only effect that moves the balance. */
export type JournalEffectDocument =
  | { readonly kind: 'points'; readonly delta: number }
  | {
      readonly kind: 'streak';
      readonly streakId: string;
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
      readonly dueBy: string | null;
    }
  | {
      readonly kind: 'freeze';
      readonly streakId: string;
      readonly op: 'earned' | 'granted' | 'applied';
      readonly count: number;
      readonly bankedAfter: number;
    }
  | {
      readonly kind: 'achievement';
      readonly rule: RuleRefDocument;
      readonly awardKey: string;
      readonly op: 'granted' | 'revoked';
    }
  | {
      readonly kind: 'tier';
      readonly op: 'changed' | 'granted' | 'overridden' | 'overrideCleared';
      readonly from: string;
      readonly to: string;
      readonly until: string | null;
    }
  | {
      readonly kind: 'reward';
      readonly op: 'granted' | 'reinstated' | 'revoked';
      readonly ref: RewardRefDocument;
    }
  | {
      readonly kind: 'redemption';
      readonly op: 'redeemed' | 'reversed' | 'expired';
      readonly redemptionId: string;
      readonly rewardId: string;
      readonly cost: number;
      readonly grant: RewardRefDocument | null;
    }
  | {
      readonly kind: 'pause';
      readonly op: 'applied' | 'edited' | 'lifted' | 'expired';
      readonly pauseId: string;
      readonly term: PauseTermDocument;
      readonly scope: PauseScope;
      /** Before → after on every pause row; `null` on `applied`. */
      readonly prior: {
        readonly term: PauseTermDocument;
        readonly scope: PauseScope;
      } | null;
    }
  | {
      readonly kind: 'visitOutcome';
      readonly appointmentId: string;
      readonly seatId: string;
      readonly from: SeatOutcomeKind;
      readonly to: SeatOutcomeKind;
      readonly revision: number;
    };

/** Why an entry was written: a rule paid, a person asked, a job ran, a migration, a redemption. */
export type JournalSourceDocument =
  | {
      readonly kind: 'rule';
      readonly rule: RuleRefDocument;
      readonly awardKey: string;
      readonly eventId: string;
    }
  | {
      readonly kind: 'manual' | 'correction';
      readonly adjustmentId: string;
    }
  | {
      readonly kind: 'system';
      readonly job:
        'streak' | 'tier' | 'pauseExpiry' | 'pointsExpiry' | 'rewardExpiry';
    }
  | { readonly kind: 'migration'; readonly batchId: string }
  | { readonly kind: 'redemption'; readonly redemptionId: string };

/**
 * `clientJournal/{uid}_{seq:06}` (`clientJournalEntryId`) — append-only,
 * never updated. `seq` is dense per client; `balanceAfter` is the balance
 * once this entry is folded in. The ledger reads `visibility == 'client'`
 * point rows only; the label carries a copy key and non-personal params,
 * never a note or a name.
 */
export interface ClientJournalEntryDocument {
  readonly userId: string;
  readonly seq: number;
  readonly at: string;
  readonly effect: JournalEffectDocument;
  readonly source: JournalSourceDocument;
  readonly actor: JournalActorDocument;
  /** The entry this one compensates; a reversal is never itself reversed. */
  readonly reverses: string | null;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly visibility: 'client' | 'staff';
  readonly publicLabel: {
    readonly code: PublicLabelCode;
    readonly params: Readonly<Record<string, string | number>>;
  };
  readonly balanceAfter: number;
}

// ── Reading: document → domain ──────────────────────────────────────────
//
// Every reader takes the document's id and its data as Firestore hands it
// (`unknown`: a reader trusts nothing it did not check) and answers a
// `Result`. A field of the wrong kind, an unknown vocabulary value, an
// instant that is not a UTC ISO string: the document is malformed and the
// error names the field. What parses goes through the domain's factories,
// so a document the domain would refuse is refused here too.

/** The six catalogue collections, each keyed by document id — what `loyaltyCatalogFromDocuments` reads. */
export type LoyaltyCatalogDocuments = {
  readonly [C in (typeof LOYALTY_CATALOG_COLLECTIONS)[number]]: Readonly<
    Record<string, unknown>
  >;
};

/** `badgeCategories/{id}` → a shelf. */
export function badgeCategoryFromDocument(
  id: string,
  data: unknown,
): Result<BadgeCategory, RepositoryError> {
  return read(`${BADGE_CATEGORIES_COLLECTION}/${id}`, data, (doc) =>
    built(
      doc,
      BadgeCategory.create({
        id,
        kind: doc.oneOf('kind', BADGE_CATEGORY_KINDS),
        title: doc.textPair('title'),
        order: doc.int('order'),
      }),
    ),
  );
}

/** `badgeSeries/{id}` → a medal family, its levels checked together. */
export function badgeSeriesFromDocument(
  id: string,
  data: unknown,
): Result<BadgeSeries, RepositoryError> {
  return read(`${BADGE_SERIES_COLLECTION}/${id}`, data, (doc) => {
    const props: BadgeSeriesProps = {
      id,
      categoryId: doc.nullableText('categoryId'),
      seasonId: doc.nullableText('seasonId'),
      title: doc.textPair('title'),
      requirement: doc.textPair('requirement'),
      emblem: doc.oneOf('emblem', BADGE_EMBLEMS),
      subject: doc.nullable('subject', subjectProps),
      metric: doc.nullable('metric', metricRefProps),
      art: doc.nullable('art', (art) => ({ path: art.text('path') })),
      levels: doc.list('levels', (level) => ({
        level: level.int('level', 1),
        ruleId: level.text('ruleId'),
        target: level.nullableInt('target', 1),
        requirement: level.textPair('requirement'),
        awards: level.list('awards', awardProps),
      })),
      repeatable: doc.bool('repeatable'),
      order: doc.int('order'),
      retiredAt: doc.nullableInstant('retiredAt'),
      version: doc.int('version', 1),
    };
    return built(doc, BadgeSeries.create(props));
  });
}

/** `seasons/{id}` → a season or an event. */
export function seasonFromDocument(
  id: string,
  data: unknown,
): Result<Season, RepositoryError> {
  return read(`${SEASONS_COLLECTION}/${id}`, data, (doc) => {
    const window = doc.object('window');
    return built(
      doc,
      Season.create({
        id,
        kind: doc.oneOf('kind', SEASON_KINDS),
        title: doc.textPair('title'),
        emblem: doc.oneOf('emblem', BADGE_EMBLEMS),
        window: { from: window.date('from'), until: window.date('until') },
        trackSeriesId: doc.nullableText('trackSeriesId'),
        seriesIds: doc.texts('seriesIds'),
        announcedAt: doc.instant('announcedAt'),
        version: doc.int('version', 1),
      }),
    );
  });
}

/** `tierDefinitions/{id}` → a tier. */
export function tierDefinitionFromDocument(
  id: string,
  data: unknown,
): Result<TierDefinition, RepositoryError> {
  return read(`${TIER_DEFINITIONS_COLLECTION}/${id}`, data, (doc) => {
    const qualify = doc.object('qualify');
    return ok({
      id,
      name: doc.localizedText('name'),
      rank: doc.int('rank'),
      benefits: doc.oneOfList('benefits', PERK_IDS),
      version: doc.int('version', 1),
      effectiveFrom: doc.instant('effectiveFrom'),
      qualify: {
        metric: qualify.oneOf('metric', METRICS),
        atLeast: qualify.int('atLeast'),
        window: { lastDays: qualify.object('window').int('lastDays', 1) },
      },
    });
  });
}

/** `rewardsCatalog/{id}` → what points buy. The catalogue checks the cost. */
export function rewardCatalogItemFromDocument(
  id: string,
  data: unknown,
): Result<RewardCatalogItem, RepositoryError> {
  return read(`${REWARDS_CATALOG_COLLECTION}/${id}`, data, (doc) => {
    const available = doc.object('available');
    const limits = doc.object('limits');
    return ok({
      id,
      name: doc.localizedText('name'),
      cost: doc.int('cost', Number.NEGATIVE_INFINITY),
      enabled: doc.bool('enabled'),
      order: doc.int('order'),
      grants: rewardGrant(doc.object('grants')),
      available: {
        from: available.nullableDate('from'),
        until: available.nullableDate('until'),
      },
      limits: {
        perClient: limits.nullable('perClient', (per) => ({
          count: per.int('count', 1),
          windowDays: per.int('windowDays', 1),
        })),
        total: limits.nullableInt('total'),
      },
      redeemedCount: doc.int('redeemedCount'),
    });
  });
}

/**
 * `streakDefinitions/{id}` → the head as a model: the rule in force and
 * the one that waits, each through `StreakDefinition.create`, the two
 * together through `StreakDefinitionSchedule.create`. A figure outside its
 * range, a grace longer than the interval, a scheduled version that does
 * not rise: the document is refused, by the domain's own code. So is a
 * document in the flat shape of before revision 3: it has no version in
 * force.
 */
export function streakScheduleFromDocument(
  id: string,
  data: unknown,
): Result<StreakDefinitionSchedule, RepositoryError> {
  return read(`${STREAK_DEFINITIONS_COLLECTION}/${id}`, data, (doc) => {
    const name = doc.textPair('name');
    const current = streakDefinitionOf(id, name, doc.object('current'));
    if (current.isFailure()) return fail(current.error);
    const scheduled = doc.nullable('scheduled', (body) => ({
      definition: streakDefinitionOf(id, name, body),
      transition: body.oneOf('transition', STREAK_TRANSITIONS),
    }));
    if (scheduled !== null && scheduled.definition.isFailure()) {
      return fail(scheduled.definition.error);
    }
    // The head says when it was last written; nothing is decided from it.
    doc.instant('updatedAt');
    return built(
      doc,
      StreakDefinitionSchedule.create({
        current: current.value,
        scheduled:
          scheduled === null || scheduled.definition.isFailure()
            ? null
            : {
                definition: scheduled.definition.value,
                transition: scheduled.transition,
              },
      }),
    );
  });
}

/**
 * One published version of a rule, read: the rule itself and how it came
 * to be. What the admin's «История» lists.
 */
export interface StreakDefinitionVersionRecord {
  readonly definition: StreakDefinition;
  readonly publishedAt: Date;
  /** The uid of whoever published it. */
  readonly publishedBy: string;
  readonly transition: StreakTransition;
  /** Whom the change favoured, against the version before it: `StreakRuleChange`'s two halves. */
  readonly direction: StreakRuleDirection;
  readonly changed: StreakRuleChange['changed'];
  /** The intent that made it; a retry of the same intent writes nothing. */
  readonly requestId: string;
  /** Set on a scheduled version that was called off, or replaced, before its day. */
  readonly withdrawnAt: Date | null;
}

/**
 * `streakDefinitions/{streakId}/versions/{versionId}` → one publish. A
 * version document holds no name (the head does, once, for every version),
 * so the caller hands the head's over. The document id IS the version: a
 * body numbered otherwise is malformed, not re-pointed.
 */
export function streakDefinitionVersionFromDocument(
  streakId: string,
  versionId: string,
  data: unknown,
  name: LocalizedTextDocument,
): Result<StreakDefinitionVersionRecord, RepositoryError> {
  const path = `${STREAK_DEFINITIONS_COLLECTION}/${streakId}/${STREAK_DEFINITION_VERSIONS_COLLECTION}/${versionId}`;
  return read(path, data, (doc) => {
    if (streakDefinitionVersionId(doc.int('version', 1)) !== versionId) {
      throw new MalformedField(doc.pathOf('version'));
    }
    const definition = streakDefinitionOf(streakId, name, doc);
    if (definition.isFailure()) return fail(definition.error);
    return ok({
      definition: definition.value,
      publishedAt: doc.instant('publishedAt'),
      publishedBy: doc.text('publishedBy'),
      transition: doc.oneOf('transition', STREAK_TRANSITIONS),
      direction: doc.oneOf('direction', STREAK_RULE_DIRECTIONS),
      changed: doc.oneOfList('changed', STREAK_RULE_PARAMETERS),
      requestId: doc.text('requestId'),
      withdrawnAt: doc.nullableInstant('withdrawnAt'),
    });
  });
}

/**
 * The whole catalogue, validated as one model: every document through its
 * reader, then `LoyaltyCatalog.create` over them all. One malformed or
 * inconsistent document fails the catalogue — half a catalogue would draw
 * a season around families that are not there.
 *
 * The rhythm is read as its heads (`streakSchedules`); the rule in force
 * is resolved by date when a reader asks (`streakInForce`), so the
 * catalogue itself belongs to no day.
 */
export function loyaltyCatalogFromDocuments(
  documents: LoyaltyCatalogDocuments,
): Result<LoyaltyCatalog, RepositoryError> {
  const categories = all(documents.badgeCategories, badgeCategoryFromDocument);
  const series = all(documents.badgeSeries, badgeSeriesFromDocument);
  const seasons = all(documents.seasons, seasonFromDocument);
  const tiers = all(documents.tierDefinitions, tierDefinitionFromDocument);
  const rewards = all(documents.rewardsCatalog, rewardCatalogItemFromDocument);
  const schedules = all(
    documents.streakDefinitions,
    streakScheduleFromDocument,
  );
  if (categories.isFailure()) return fail(categories.error);
  if (series.isFailure()) return fail(series.error);
  if (seasons.isFailure()) return fail(seasons.error);
  if (tiers.isFailure()) return fail(tiers.error);
  if (rewards.isFailure()) return fail(rewards.error);
  if (schedules.isFailure()) return fail(schedules.error);
  const catalog = LoyaltyCatalog.create({
    categories: categories.value,
    series: series.value,
    seasons: seasons.value,
    tiers: tiers.value,
    rewards: rewards.value,
    streakSchedules: schedules.value,
  });
  return catalog.isSuccess()
    ? ok(catalog.value)
    : fail(
        new RepositoryError(
          `Inconsistent loyalty catalogue: ${codesOf(catalog.error)}`,
          catalog.error,
        ),
      );
}

/**
 * `loyaltyAccounts/{uid}` → the client's account. The document id is the
 * client; a body naming anyone else is malformed, not re-pointed.
 */
export function loyaltyAccountFromDocument(
  userId: string,
  data: unknown,
): Result<LoyaltyAccount, RepositoryError> {
  return read(`${LOYALTY_ACCOUNTS_COLLECTION}/${userId}`, data, (doc) => {
    if (userId.trim().length === 0 || doc.text('userId') !== userId) {
      throw new MalformedField(doc.pathOf('userId'));
    }
    return ok({
      userId,
      balance: doc.int('balance', Number.NEGATIVE_INFINITY),
      lifetimeEarned: doc.int('lifetimeEarned', Number.NEGATIVE_INFINITY),
      lifetimeAdjusted: doc.int('lifetimeAdjusted', Number.NEGATIVE_INFINITY),
      lifetimeSpent: doc.int('lifetimeSpent', Number.NEGATIVE_INFINITY),
      tier: tierState(doc.object('tier')),
      streaks: doc.entries('streaks', streakState),
      punchCards: doc.list('punchCards', (card) => ({
        ruleId: card.text('ruleId'),
        filled: card.int('filled'),
        size: card.int('size', 1),
        title: card.localizedText('title'),
      })),
      records: doc.list('records', personalRecord),
      pointsExpiry: doc.nullable('pointsExpiry', (expiry) => ({
        expiresOn: expiry.date('expiresOn'),
        noticeFrom: expiry.date('noticeFrom'),
      })),
      seq: doc.int('seq'),
      version: doc.int('version'),
      updatedAt: doc.instant('updatedAt'),
    });
  });
}

/** `loyaltyAccounts/{uid}/badgeProgress/{seriesId}` → one family's progress. */
export function badgeProgressFromDocument(
  seriesId: string,
  data: unknown,
): Result<BadgeProgress, RepositoryError> {
  return read(`${BADGE_PROGRESS_COLLECTION}/${seriesId}`, data, (doc) => {
    if (seriesId.trim().length === 0) throw new MalformedField(doc.pathOf(''));
    const earned = doc.list('earned', (entry) => ({
      level: entry.int('level', 1),
      earnedAt: entry.instant('earnedAt'),
      via: entry.oneOf('via', EARNED_VIA),
      count: entry.int('count', 1),
    }));
    // Each level once, lowest first — what «I…V» and the counts assume.
    if (
      earned.some((e, i) => i > 0 && e.level <= (earned[i - 1]?.level ?? 0))
    ) {
      throw new MalformedField(doc.pathOf('earned'));
    }
    return ok({ seriesId, value: doc.int('value'), earned });
  });
}

/** `loyaltyAccounts/{uid}/seasonProgress/{seasonId}` → the season's track at a glance. */
export function seasonProgressFromDocument(
  seasonId: string,
  data: unknown,
): Result<SeasonProgress, RepositoryError> {
  return read(`${SEASON_PROGRESS_COLLECTION}/${seasonId}`, data, (doc) => {
    if (seasonId.trim().length === 0) throw new MalformedField(doc.pathOf(''));
    return ok({
      seasonId,
      trackValue: doc.int('trackValue'),
      trackLevel: doc.int('trackLevel'),
    });
  });
}

/**
 * `clientJournal/{entryId}` → a ledger row. Only a client-visible row that
 * moves points IS one («Движение на точките»); any other entry is refused
 * here rather than drawn as a row without a figure.
 */
export function ledgerEntryFromDocument(
  entryId: string,
  data: unknown,
): Result<LedgerEntry, RepositoryError> {
  return read(`${CLIENT_JOURNAL_COLLECTION}/${entryId}`, data, (doc) => {
    if (entryId.trim().length === 0) throw new MalformedField(doc.pathOf(''));
    if (doc.oneOf('visibility', VISIBILITIES) !== 'client') {
      throw new MalformedField(doc.pathOf('visibility'));
    }
    const effect = doc.object('effect');
    if (effect.text('kind') !== 'points') {
      throw new MalformedField(effect.pathOf('kind'));
    }
    const label = doc.object('publicLabel');
    return ok({
      id: entryId,
      seq: doc.int('seq'),
      at: doc.instant('at'),
      delta: effect.int('delta', Number.NEGATIVE_INFINITY),
      label: {
        code: label.oneOf('code', PUBLIC_LABEL_CODES),
        params: label.params('params'),
      },
      reverses: doc.nullableText('reverses'),
    });
  });
}

/**
 * The journal effects behind each pill of the activity feed «Движение»
 * (client-card-revision-3.md §4.7) — what a query's `effect.kind in [...]`
 * lists and what an in-memory reader filters by, from one table. Streak,
 * freeze, pause and visit-outcome rows are in none of them: they are never
 * in the feed.
 */
export const ACTIVITY_EFFECT_KINDS = {
  all: ['points', 'achievement', 'tier', 'reward', 'redemption'],
  points: ['points'],
  rewards: ['reward', 'redemption'],
  status: ['tier'],
} as const satisfies Readonly<
  Record<ActivityKind, readonly ActivityEffect['kind'][]>
>;

/**
 * `clientJournal/{entryId}` → a row of the activity feed: the ledger row
 * widened past points. Only a client-visible entry of one of the feed's
 * five effects IS one; any other is refused here rather than drawn as a
 * row that says nothing. Each effect is cut to what a row prints; a point
 * row carries the balance once it is folded in.
 */
export function activityEntryFromDocument(
  entryId: string,
  data: unknown,
): Result<ActivityEntry, RepositoryError> {
  return read(`${CLIENT_JOURNAL_COLLECTION}/${entryId}`, data, (doc) => {
    if (entryId.trim().length === 0) throw new MalformedField(doc.pathOf(''));
    if (doc.oneOf('visibility', VISIBILITIES) !== 'client') {
      throw new MalformedField(doc.pathOf('visibility'));
    }
    const label = doc.object('publicLabel');
    return ok({
      id: entryId,
      seq: doc.int('seq'),
      at: doc.instant('at'),
      correlationId: doc.text('correlationId'),
      effect: activityEffect(doc),
      label: {
        code: label.oneOf('code', PUBLIC_LABEL_CODES),
        params: label.params('params'),
      },
      reverses: doc.nullableText('reverses'),
    });
  });
}

// ── Writing: domain → document ──────────────────────────────────────────
//
// The write halves, kept beside the readers so a field added to one cannot
// be forgotten by the other: the publish callable and the dev seed write
// through these, and what they write reads back through the readers above
// into an EQUAL model.

/** One version of the rule → the body the head and a version document hold. */
export function streakDefinitionToDocument(
  definition: StreakDefinition,
): StreakDefinitionBodyDocument {
  const props = definition.toProps();
  return {
    version: props.version,
    effectiveFrom: props.effectiveFrom,
    enabled: props.enabled,
    qualifier: props.qualifier,
    minGapDays: props.minGapDays,
    bookingHold: props.bookingHold,
    interval: props.interval,
    graceDays: props.graceDays,
    riskLeadDays: props.riskLeadDays,
    protections: props.protections,
    excuses: props.excuses,
    clientPause: props.clientPause,
    repair: props.repair,
    onBreak: props.onBreak,
  };
}

/** The head as a model → `streakDefinitions/{id}`, stamped with when it is written. */
export function streakScheduleToDocument(
  schedule: StreakDefinitionSchedule,
  updatedAt: Date,
): StreakDefinitionHeadDocument {
  const { current, scheduled } = schedule;
  return {
    name: { bg: current.name.bg, en: current.name.en },
    current: streakDefinitionToDocument(current),
    scheduled:
      scheduled === null
        ? null
        : {
            ...streakDefinitionToDocument(scheduled.definition),
            transition: scheduled.transition,
          },
    updatedAt: updatedAt.toISOString(),
  };
}

/** One publish → `streakDefinitions/{id}/versions/{version:06}`. */
export function streakDefinitionVersionToDocument(
  record: StreakDefinitionVersionRecord,
): StreakDefinitionVersionDocument {
  return {
    ...streakDefinitionToDocument(record.definition),
    publishedAt: record.publishedAt.toISOString(),
    publishedBy: record.publishedBy,
    transition: record.transition,
    direction: record.direction,
    // A version's identity is what every revision changes: never listed.
    changed: record.changed.filter((key) =>
      isOneOf(STREAK_RULE_PARAMETERS, key),
    ),
    requestId: record.requestId,
    withdrawnAt: record.withdrawnAt?.toISOString() ?? null,
  };
}

/** One rhythm's projection → the entry of `loyaltyAccounts/{uid}.streaks`, every field written. */
export function streakStateToDocument(state: StreakState): StreakStateDocument {
  return {
    streakId: state.streakId,
    definitionVersion: state.definitionVersion,
    phase: state.phase,
    current: state.current,
    best: state.best,
    lastQualifiedAt: state.lastQualifiedAt?.toISOString() ?? null,
    dueBy: state.dueBy,
    freezesBanked: state.freezesBanked,
    period: state.period === null ? null : { ...state.period },
    periods: state.periods.map((period) => ({ ...period })),
    heldBy: state.heldBy === null ? null : { ...state.heldBy },
    runStartedOn: state.runStartedOn,
  };
}

// ── The journal's parts ─────────────────────────────────────────────────

/** A feed row's effect, cut to what the row prints. */
function activityEffect(doc: FieldReader): ActivityEffect {
  const effect = doc.object('effect');
  switch (effect.oneOf('kind', ACTIVITY_EFFECT_KINDS.all)) {
    case 'points':
      return {
        kind: 'points',
        delta: effect.int('delta', Number.NEGATIVE_INFINITY),
        balanceAfter: doc.int('balanceAfter', Number.NEGATIVE_INFINITY),
      };
    case 'achievement':
      return {
        kind: 'achievement',
        op: effect.oneOf('op', ACHIEVEMENT_OPS),
      };
    case 'tier':
      return {
        kind: 'tier',
        from: effect.text('from'),
        to: effect.text('to'),
      };
    case 'reward':
      return { kind: 'reward', op: effect.oneOf('op', REWARD_OPS) };
    case 'redemption':
      return {
        kind: 'redemption',
        op: effect.oneOf('op', REDEMPTION_OPS),
        cost: effect.int('cost'),
      };
  }
}

// ── The rule's parts ────────────────────────────────────────────────────

/** One body → the rule, through its factory; what the domain refuses fails the document, by code. */
function streakDefinitionOf(
  id: string,
  name: LocalizedTextDocument,
  doc: FieldReader,
): Result<StreakDefinition, RepositoryError> {
  const props: StreakDefinitionProps = {
    id,
    name,
    version: doc.int('version', 1),
    effectiveFrom: doc.date('effectiveFrom'),
    enabled: doc.bool('enabled'),
    qualifier: streakQualifier(doc.object('qualifier')),
    minGapDays: doc.int('minGapDays'),
    bookingHold: switched(doc.object('bookingHold'), (hold) => ({
      maxDaysPastDue: hold.int('maxDaysPastDue'),
    })),
    interval: streakInterval(doc.object('interval')),
    graceDays: doc.int('graceDays'),
    riskLeadDays: doc.int('riskLeadDays'),
    protections: switched(doc.object('protections'), (reserve) => ({
      maxBanked: reserve.int('maxBanked'),
      earnEvery: reserve.int('earnEvery'),
      startWith: reserve.int('startWith'),
    })),
    excuses: doc.oneOfList('excuses', STREAK_EXCUSES),
    clientPause: switched(doc.object('clientPause'), (pause) => ({
      maxDaysPerYear: pause.int('maxDaysPerYear'),
    })),
    repair: switched(doc.object('repair'), (repair) => ({
      windowDays: repair.int('windowDays'),
      perYear: repair.int('perYear'),
    })),
    onBreak: doc.oneOf('onBreak', STREAK_ON_BREAK),
  };
  return built(doc, StreakDefinition.create(props));
}

/** A part of the rule with a switch: `enabled`, then its figures. */
function switched<T>(
  doc: FieldReader,
  figures: (doc: FieldReader) => T,
): { enabled: boolean } & T {
  return { enabled: doc.bool('enabled'), ...figures(doc) };
}

function streakQualifier(doc: FieldReader): StreakQualifierProps {
  switch (doc.oneOf('kind', STREAK_QUALIFIER_KINDS)) {
    case 'anyVisit':
      return { kind: 'anyVisit' };
    case 'services':
      return { kind: 'services', serviceIds: doc.texts('serviceIds') };
    case 'categories':
      return { kind: 'categories', categoryIds: doc.texts('categoryIds') };
  }
}

function streakInterval(doc: FieldReader): StreakIntervalProps {
  switch (doc.oneOf('kind', STREAK_INTERVAL_KINDS)) {
    case 'fixed':
      return { kind: 'fixed', days: doc.int('days') };
    case 'personal':
      return {
        kind: 'personal',
        tolerancePct: doc.int('tolerancePct'),
        minDays: doc.int('minDays'),
        maxDays: doc.int('maxDays'),
        fallbackDays: doc.int('fallbackDays'),
      };
  }
}

// ── The account's parts ─────────────────────────────────────────────────

function tierState(doc: FieldReader): TierState {
  return {
    current: doc.text('current'),
    definitionVersion: doc.int('definitionVersion', 1),
    since: doc.instant('since'),
    qualifying: doc.int('qualifying'),
    next: doc.nullableText('next'),
    remaining: doc.nullableInt('remaining'),
    override: doc.nullable('override', (override) => {
      const source = override.object('source');
      return {
        tierId: override.text('tierId'),
        until: override.nullableDate('until'),
        source:
          source.oneOf('kind', OVERRIDE_SOURCES) === 'award'
            ? { kind: 'award', awardKey: source.text('awardKey') }
            : { kind: 'adjustment', adjustmentId: source.text('adjustmentId') },
      };
    }),
  };
}

function streakState(doc: FieldReader): StreakState {
  return {
    streakId: doc.text('streakId'),
    definitionVersion: doc.int('definitionVersion', 1),
    phase: streakPhase(doc.object('phase')),
    current: doc.int('current'),
    best: doc.int('best'),
    lastQualifiedAt: doc.nullableInstant('lastQualifiedAt'),
    dueBy: doc.nullableDate('dueBy'),
    freezesBanked: doc.int('freezesBanked'),
    // The four a state written before revision 3 does not hold: absent
    // reads as no pinned terms, no closed periods, no hold, no day the run
    // began, so nothing that reads a state has to guess.
    period: doc.maybe('period', streakPeriodTerms),
    periods: doc.has('periods') ? doc.list('periods', streakPeriodFact) : [],
    heldBy: doc.maybe('heldBy', streakHold),
    runStartedOn: doc.has('runStartedOn')
      ? doc.nullableDate('runStartedOn')
      : null,
  };
}

function streakPeriodTerms(doc: FieldReader): StreakPeriodTerms {
  return {
    intervalDays: doc.int('intervalDays', 1),
    graceDays: doc.int('graceDays'),
    source: doc.oneOf('source', STREAK_INTERVAL_SOURCES),
    habitDays: doc.nullablePositive('habitDays'),
  };
}

function streakPeriodFact(doc: FieldReader): StreakPeriodFact {
  return {
    mark: doc.oneOf('mark', STREAK_PERIOD_MARKS),
    on: doc.date('on'),
    reason: doc.nullableOneOf('reason', STREAK_PERIOD_REASONS),
  };
}

function streakHold(doc: FieldReader): StreakHold {
  return { appointmentId: doc.text('appointmentId'), on: doc.date('on') };
}

function streakPhase(doc: FieldReader): StreakPhase {
  switch (doc.oneOf('kind', STREAK_PHASE_KINDS)) {
    case 'active':
      return { kind: 'active' };
    case 'atRisk':
      return { kind: 'atRisk', dueBy: doc.date('dueBy') };
    case 'inGrace':
      return { kind: 'inGrace', graceUntil: doc.date('graceUntil') };
    case 'frozen':
      return {
        kind: 'frozen',
        until: doc.date('until'),
        reason: doc.oneOf('reason', FREEZE_REASONS),
      };
    case 'broken':
      return {
        kind: 'broken',
        brokenAt: doc.date('brokenAt'),
        repairableUntil: doc.date('repairableUntil'),
      };
  }
}

function personalRecord(doc: FieldReader): PersonalRecord {
  return {
    kind: doc.oneOf('kind', PERSONAL_RECORD_KINDS),
    value: doc.int('value'),
    on: doc.nullableDate('on'),
    year: doc.nullableInt('year', 1),
    serviceId: doc.nullableText('serviceId'),
  };
}

// ── The catalogue's parts ───────────────────────────────────────────────

function subjectProps(doc: FieldReader): BadgeSeriesProps['subject'] {
  switch (doc.oneOf('kind', SUBJECT_KINDS)) {
    case 'service':
      return { kind: 'service', serviceId: doc.text('serviceId') };
    case 'barber':
      return { kind: 'barber', barberId: doc.text('barberId') };
    case 'location':
      return { kind: 'location', locationId: doc.text('locationId') };
  }
}

/** `window` and `where` are ABSENT when unused, never null. */
function metricRefProps(doc: FieldReader): BadgeSeriesProps['metric'] {
  const metric = doc.oneOf('metric', METRICS);
  const window = doc.optional('window', (w) => ({
    lastDays: w.int('lastDays', 1),
  }));
  const where = doc.optional('where', (w) => ({
    ...(w.has('serviceId') ? { serviceId: w.text('serviceId') } : {}),
    ...(w.has('barberId') ? { barberId: w.text('barberId') } : {}),
    ...(w.has('locationId') ? { locationId: w.text('locationId') } : {}),
  }));
  return {
    metric,
    ...(window === undefined ? {} : { window }),
    ...(where === undefined ? {} : { where }),
  };
}

function awardProps(
  doc: FieldReader,
): BadgeSeriesProps['levels'][number]['awards'][number] {
  switch (doc.oneOf('kind', AWARD_KINDS)) {
    case 'points':
      return { kind: 'points', points: doc.int('points', 1) };
    case 'coupon':
      return { kind: 'coupon', title: doc.textPair('title') };
    case 'freeze':
      return { kind: 'freeze', count: doc.int('count', 1) };
    case 'perk':
      return {
        kind: 'perk',
        perkId: doc.oneOf('perkId', PERK_IDS),
        forDays: doc.nullableInt('forDays', 1),
      };
  }
}

function rewardGrant(doc: FieldReader): RewardGrant {
  switch (doc.oneOf('kind', GRANT_KINDS)) {
    case 'coupon':
      return { kind: 'coupon', couponId: doc.text('couponId') };
    case 'voucher':
      return {
        kind: 'voucher',
        amountMinor: doc.int('amountMinor', 1),
        expiresInDays: doc.int('expiresInDays', 1),
      };
    case 'perk':
      return {
        kind: 'perk',
        perkId: doc.oneOf('perkId', PERK_IDS),
        forDays: doc.nullableInt('forDays', 1),
      };
  }
}

// ── The small vocabularies the readers check ───────────────────────────

const SEASON_KINDS = ['season', 'event'] as const;
const SUBJECT_KINDS = ['service', 'barber', 'location'] as const;
const AWARD_KINDS = ['points', 'coupon', 'freeze', 'perk'] as const;
const GRANT_KINDS = ['coupon', 'voucher', 'perk'] as const;
const EARNED_VIA = ['rule', 'manual'] as const;
const OVERRIDE_SOURCES = ['award', 'adjustment'] as const;
const STREAK_PHASE_KINDS = [
  'active',
  'atRisk',
  'inGrace',
  'frozen',
  'broken',
] as const;
const FREEZE_REASONS = ['freeze', 'pause', 'clientPause', 'excuse'] as const;
const STREAK_PERIOD_MARKS = [
  'kept',
  'protected',
  'repaired',
  'missed',
] as const satisfies readonly StreakPeriodFact['mark'][];
const STREAK_PERIOD_REASONS = [
  'freeze',
  ...STREAK_EXCUSES,
  'pause',
  'clientPause',
] as const satisfies readonly NonNullable<StreakPeriodFact['reason']>[];
const STREAK_INTERVAL_SOURCES = [
  'fixed',
  'personal',
  'fallback',
] as const satisfies readonly StreakIntervalSource[];
const STREAK_RULE_DIRECTIONS = [
  'looser',
  'stricter',
  'mixed',
  'neutral',
  'switch',
] as const satisfies readonly StreakRuleDirection[];
/** In the rule's own order, as `StreakRuleChange.changed` lists them. */
const STREAK_RULE_PARAMETERS = [
  'name',
  'enabled',
  'qualifier',
  'minGapDays',
  'bookingHold',
  'interval',
  'graceDays',
  'riskLeadDays',
  'protections',
  'excuses',
  'clientPause',
  'repair',
  'onBreak',
] as const satisfies readonly StreakRuleParameter[];
const ACHIEVEMENT_OPS = ['granted', 'revoked'] as const;
const REWARD_OPS = ['granted', 'reinstated', 'revoked'] as const;
const REDEMPTION_OPS = ['redeemed', 'reversed', 'expired'] as const;
const VISIBILITIES = ['client', 'staff'] as const;

// ── The field reader ────────────────────────────────────────────────────

/** A field that is not what the wire says it must be; carries its path. */
class MalformedField extends Error {
  constructor(readonly path: string) {
    super(`Malformed ${path}`);
  }
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isRecord(raw: unknown): raw is Readonly<Record<string, unknown>> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
}

/**
 * Reads one object's fields by the wire rules, throwing `MalformedField`
 * at the first that breaks them. The throw never leaves this module:
 * `read` turns it into the reader's failed `Result`, so a reader's body
 * stays the document's shape rather than a ladder of checks.
 */
class FieldReader {
  private constructor(
    private readonly fields: ReadonlyMap<string, unknown>,
    private readonly path: string,
  ) {}

  static of(raw: unknown, path: string): FieldReader {
    if (!isRecord(raw)) throw new MalformedField(path);
    return new FieldReader(new Map(Object.entries(raw)), path);
  }

  /** `badgeSeries/series-visits.levels[2].target`; `''` is the object itself. */
  pathOf(key: string): string {
    return key === '' ? this.path : `${this.path}.${key}`;
  }

  has(key: string): boolean {
    return this.fields.get(key) !== undefined;
  }

  object(key: string): FieldReader {
    return FieldReader.of(this.fields.get(key), this.pathOf(key));
  }

  /** Required, and may be `null`. */
  nullable<T>(key: string, parse: (doc: FieldReader) => T): T | null {
    return this.fields.get(key) === null ? null : parse(this.object(key));
  }

  /** May be absent — never `null`. */
  optional<T>(key: string, parse: (doc: FieldReader) => T): T | undefined {
    return this.fields.get(key) === undefined
      ? undefined
      : parse(this.object(key));
  }

  /**
   * May be absent, and may be `null`; both read as `null`. For a field a
   * document written before the field existed does not hold.
   */
  maybe<T>(key: string, parse: (doc: FieldReader) => T): T | null {
    const raw = this.fields.get(key);
    return raw === undefined || raw === null ? null : parse(this.object(key));
  }

  /** A non-blank string. */
  text(key: string): string {
    const raw = this.fields.get(key);
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new MalformedField(this.pathOf(key));
    }
    return raw;
  }

  nullableText(key: string): string | null {
    return this.fields.get(key) === null ? null : this.text(key);
  }

  /** A `{ bg, en }` pair as a domain factory takes it; the factory judges the text. */
  textPair(key: string): { bg: string; en: string } {
    const pair = this.object(key);
    const bg = pair.fields.get('bg');
    const en = pair.fields.get('en');
    if (typeof bg !== 'string' || typeof en !== 'string') {
      throw new MalformedField(this.pathOf(key));
    }
    return { bg, en };
  }

  /** A `{ bg, en }` pair made the domain's text — for values that have no factory of their own. */
  localizedText(key: string): LocalizedText {
    const text = LocalizedText.create(this.textPair(key));
    if (text.isFailure()) throw new MalformedField(this.pathOf(key));
    return text.value;
  }

  /** A whole number no smaller than `min` (0 unless said). */
  int(key: string, min = 0): number {
    const raw = this.fields.get(key);
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min) {
      throw new MalformedField(this.pathOf(key));
    }
    return raw;
  }

  nullableInt(key: string, min = 0): number | null {
    return this.fields.get(key) === null ? null : this.int(key, min);
  }

  /** A finite number above zero, whole or not, or `null`: a mean of days. */
  nullablePositive(key: string): number | null {
    const raw = this.fields.get(key);
    if (raw === null) return null;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      throw new MalformedField(this.pathOf(key));
    }
    return raw;
  }

  bool(key: string): boolean {
    const raw = this.fields.get(key);
    if (typeof raw !== 'boolean') throw new MalformedField(this.pathOf(key));
    return raw;
  }

  /** An ISO-8601 UTC instant as `toISOString` spells it — never a Timestamp. */
  instant(key: string): Date {
    const raw = this.fields.get(key);
    const at = typeof raw === 'string' ? new Date(raw) : null;
    if (
      typeof raw !== 'string' ||
      !INSTANT.test(raw) ||
      at === null ||
      Number.isNaN(at.getTime()) ||
      at.toISOString() !== raw
    ) {
      throw new MalformedField(this.pathOf(key));
    }
    return at;
  }

  nullableInstant(key: string): Date | null {
    return this.fields.get(key) === null ? null : this.instant(key);
  }

  /** A Europe/Sofia day, `YYYY-MM-DD`. */
  date(key: string): IsoDate {
    const raw = this.fields.get(key);
    if (!isIsoDate(raw)) throw new MalformedField(this.pathOf(key));
    return raw;
  }

  nullableDate(key: string): IsoDate | null {
    return this.fields.get(key) === null ? null : this.date(key);
  }

  oneOf<const T extends string>(key: string, values: readonly T[]): T {
    const raw = this.fields.get(key);
    if (!isOneOf(values, raw)) throw new MalformedField(this.pathOf(key));
    return raw;
  }

  nullableOneOf<const T extends string>(
    key: string,
    values: readonly T[],
  ): T | null {
    return this.fields.get(key) === null ? null : this.oneOf(key, values);
  }

  /** An array of objects, each read by `parse`. */
  list<T>(key: string, parse: (entry: FieldReader) => T): T[] {
    return this.array(key).map((entry, i) =>
      parse(FieldReader.of(entry, `${this.pathOf(key)}[${i}]`)),
    );
  }

  /** An array of non-blank strings. */
  texts(key: string): string[] {
    return this.array(key).map((entry, i) => {
      if (typeof entry !== 'string' || entry.trim().length === 0) {
        throw new MalformedField(`${this.pathOf(key)}[${i}]`);
      }
      return entry;
    });
  }

  /** An array of one vocabulary's values. */
  oneOfList<const T extends string>(key: string, values: readonly T[]): T[] {
    return this.array(key).map((entry, i) => {
      if (!isOneOf(values, entry)) {
        throw new MalformedField(`${this.pathOf(key)}[${i}]`);
      }
      return entry;
    });
  }

  /** A map of objects keyed by id, each read by `parse`. */
  entries<T>(key: string, parse: (entry: FieldReader) => T): Record<string, T> {
    const map = this.object(key);
    return Object.fromEntries(
      [...map.fields.keys()].map((id) => [id, parse(map.object(id))]),
    );
  }

  /** A copy key's params: strings and finite numbers only. */
  params(key: string): Record<string, string | number> {
    const map = this.object(key);
    return Object.fromEntries(
      [...map.fields].map(([name, value]) => {
        if (
          typeof value !== 'string' &&
          !(typeof value === 'number' && Number.isFinite(value))
        ) {
          throw new MalformedField(map.pathOf(name));
        }
        return [name, value];
      }),
    );
  }

  private array(key: string): readonly unknown[] {
    const raw = this.fields.get(key);
    if (!Array.isArray(raw)) throw new MalformedField(this.pathOf(key));
    return raw;
  }
}

/** Runs one reader: a malformed field becomes its failed `Result`, naming the field. */
function read<T>(
  path: string,
  data: unknown,
  parse: (doc: FieldReader) => Result<T, RepositoryError>,
): Result<T, RepositoryError> {
  try {
    return parse(FieldReader.of(data, path));
  } catch (error) {
    if (error instanceof MalformedField) {
      return fail(new RepositoryError(error.message, error));
    }
    throw error;
  }
}

/** A domain factory's answer as a reader's: what the domain refuses fails the document, codes named. */
function built<T>(
  doc: FieldReader,
  result: Result<T, readonly { readonly code: string }[]>,
): Result<T, RepositoryError> {
  return result.isSuccess()
    ? ok(result.value)
    : fail(
        new RepositoryError(
          `Malformed ${doc.pathOf('')}: ${codesOf(result.error)}`,
          result.error,
        ),
      );
}

function codesOf(errors: readonly { readonly code: string }[]): string {
  return errors.map((e) => e.code).join(', ');
}

/** Every document of one collection through its reader; the first failure fails them all. */
function all<T>(
  documents: Readonly<Record<string, unknown>>,
  parse: (id: string, data: unknown) => Result<T, RepositoryError>,
): Result<T[], RepositoryError> {
  const out: T[] = [];
  for (const [id, data] of Object.entries(documents)) {
    const parsed = parse(id, data);
    if (parsed.isFailure()) return fail(parsed.error);
    out.push(parsed.value);
  }
  return ok(out);
}
