import type { Result } from './result.data';
import { defect } from '../primitives/defect';
import type { DurationMinutes } from '../primitives/duration-minutes.primitive';
import { Currency } from '../primitives/currency.primitive';
import type {
  AppointmentId,
  BarberId,
  SeatId,
  ServiceId,
  ServiceVariantId,
  UserId,
} from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import type { MinuteOfDay } from '../primitives/minute-of-day.primitive';
import {
  EpochSeconds,
  SubsecondNanos,
} from '../primitives/precise-instant.primitive';
import { PriceCents } from '../primitives/price-cents.primitive';
import type { PrimitiveError } from '../primitives/primitive-errors.data';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

const NANOS_PER_MS = 1_000_000;

/** A brand the arithmetic above already proved — a broken one is a defect. */
function proven<T>(result: Result<T, PrimitiveError>, what: string): T {
  return result.ok
    ? result.value
    : defect(`${what}: ${result.error.errorCode}`);
}

/**
 * An instant at FULL precision — whole epoch seconds plus the nanoseconds
 * inside that second, the representation §9 D17 picks for both sides of the
 * policy-pass comparison (`PolicyRecomputeJob.changedAtSeconds/Nanos` and
 * `PolicyPass.changedAt`). A Firestore event's time is stamped in
 * microseconds and a document's `updateTime` in nanoseconds, so two settings
 * writes inside one millisecond must not compare as simultaneous: epoch ms
 * alone would break the ordering, and an RFC 3339 string would need a
 * parser in a system. Integer compare, no parser. A VALUE type for system
 * I/O (flatten-spec §3.4): a stored occurrence flattens to `<x>Seconds` +
 * `<x>Nanos`.
 */
export type PreciseInstant = {
  readonly seconds: EpochSeconds;
  readonly nanos: SubsecondNanos;
};

export const PreciseInstant = {
  /**
   * The edge guard: integral seconds and nanos in `[0, 1e9)`, or `null` —
   * an adapter builds one from a Timestamp's `{ seconds, nanoseconds }`.
   */
  of(seconds: number, nanos: number): PreciseInstant | null {
    const wholeSeconds = EpochSeconds.of(seconds);
    const subsecond = SubsecondNanos.of(nanos);
    return wholeSeconds.ok && subsecond.ok
      ? { seconds: wholeSeconds.value, nanos: subsecond.value }
      : null;
  },

  /** An epoch-ms instant at millisecond precision (floored seconds, so pre-1970 stays ordered). */
  fromEpochMs(utcEpochMs: UtcEpochMs): PreciseInstant {
    const seconds = Math.floor(utcEpochMs / 1000);
    return {
      seconds: proven(EpochSeconds.of(seconds), 'PreciseInstant seconds'),
      nanos: proven(
        SubsecondNanos.of((utcEpochMs - seconds * 1000) * NANOS_PER_MS),
        'PreciseInstant nanos',
      ),
    };
  },

  /**
   * Truncated to the millisecond — for display and coarse arithmetic, never
   * for ordering; `null` past the window a `UtcEpochMs` holds.
   */
  toEpochMs(instant: PreciseInstant): UtcEpochMs | null {
    const ms = UtcEpochMs.of(
      instant.seconds * 1000 + Math.floor(instant.nanos / NANOS_PER_MS),
    );
    return ms.ok ? ms.value : null;
  },

  /** `-1`, `0` or `1` as `a` is before, at or after `b` — to the nanosecond. */
  compare(a: PreciseInstant, b: PreciseInstant): -1 | 0 | 1 {
    if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
    if (a.nanos !== b.nanos) return a.nanos < b.nanos ? -1 : 1;
    return 0;
  },

  equals(a: PreciseInstant, b: PreciseInstant): boolean {
    return a.seconds === b.seconds && a.nanos === b.nanos;
  },
} as const;

/**
 * One VISIT — a person's seats in one appointment, counted once (R33) — at
 * the appointment's start on the shop's wall clock (Law 7: windows are
 * `LocalDate` arithmetic, T8). A party of three is three visits; a cut and
 * a beard trim for one client is one. Array element.
 */
export type VisitFact = {
  readonly appointmentId: AppointmentId;
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
};

/** One service of a visit — enough to book it again («Същото»). Array element. */
export type VisitLeg = {
  readonly seatId: SeatId;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId;
  readonly durationMinutes: DurationMinutes;
};

/**
 * What the shop knows about one client's visits — a projection of their
 * appointments, recomputed whole on every relevant change, never edited
 * (`client-stats.ts:26-106`). One flat slice (Law 6): the lifetime counts,
 * the bounded facts, the first/last/next visit and the pause suggestion
 * are root fields, each 1-to-1 group under its own prefix.
 *
 * Counts are per VISIT per subject (R33). Only the last
 * `ClientStatsPolicy.BOUNDED_DAYS` days keep their facts; windows are
 * computed at read, so a no-show leaves the 90-day count without a
 * rewrite. Money is deliberately absent — a barber reads this whole; spend
 * is `ClientMoneyStats`, in its own admin-only document.
 *
 * Invariants of the nullable groups (N9, stated here and kept by the
 * companion and `ClientStatsSystem`): `firstVisitLocalDate` and
 * `firstVisitStartMinutes` are `null` together; `lastVisitAppointmentId`,
 * `lastVisitLocalDate` and `lastVisitStartMinutes` are `null` together, and
 * then `lastVisitServiceIds`, `lastVisitBarberIds` and `lastVisitLegs` are
 * `[]` (likewise every `nextVisit*`); `pauseSuggestedNoShows`,
 * `pauseSuggestedWindowDays` and `pauseSuggestedAtUtcMs` are `null`
 * together, and then `pauseSuggestionBasis` is `[]`.
 */
export type ClientStats = {
  /** The client's account — `UserId` until flip (1) re-keys the record to `CustomerId` (D29, §5.5). */
  readonly userId: UserId;
  readonly lifetimeVisitsCompleted: number;
  readonly lifetimeNoShows: number;
  /** Client-caused cancellations inside the free window in force when each was made. */
  readonly lifetimeLateCancels: number;
  /** Client-caused cancellations at any lead time (R35); shop-caused never count. */
  readonly lifetimeClientCancels: number;
  readonly last365VisitsCompleted: readonly VisitFact[];
  readonly last365NoShows: readonly VisitFact[];
  readonly last365LateCancels: readonly VisitFact[];
  readonly firstVisitLocalDate: LocalDate | null;
  readonly firstVisitStartMinutes: MinuteOfDay | null;
  readonly lastVisitAppointmentId: AppointmentId | null;
  readonly lastVisitLocalDate: LocalDate | null;
  readonly lastVisitStartMinutes: MinuteOfDay | null;
  /** Distinct, in seat order. */
  readonly lastVisitServiceIds: readonly ServiceId[];
  /** Distinct, in seat order. */
  readonly lastVisitBarberIds: readonly BarberId[];
  readonly lastVisitLegs: readonly VisitLeg[];
  /** The earliest open visit not yet over; a reader re-checks it against its own now. */
  readonly nextVisitAppointmentId: AppointmentId | null;
  readonly nextVisitLocalDate: LocalDate | null;
  readonly nextVisitStartMinutes: MinuteOfDay | null;
  readonly nextVisitServiceIds: readonly ServiceId[];
  readonly nextVisitBarberIds: readonly BarberId[];
  readonly nextVisitLegs: readonly VisitLeg[];
  /** R34: mean days between worked visits once there are ≥ 3, shop-caused gaps excluded. */
  readonly avgCadenceDays: number | null;
  /** Asked for by name on ≥ 2 of the last 3 visits — never inferred from who was free. */
  readonly preferredBarberId: BarberId | null;
  /** Services on ≥ 3 of the last 5 visits, most frequent first. */
  readonly usualServiceIds: readonly ServiceId[];
  /**
   * «3 неявявания за 60 дни» — a SUGGESTION to pause, never a pause (R25,
   * B1): no code path turns it into one. A dismissal lives on the client's
   * profile, so a recompute can never undo it.
   */
  readonly pauseSuggestedNoShows: number | null;
  readonly pauseSuggestedWindowDays: number | null;
  /** The no-shows it rests on, oldest first — what a reviewer checks. */
  readonly pauseSuggestionBasis: readonly AppointmentId[];
  /** The newest no-show's start instant: a later one raises it anew. */
  readonly pauseSuggestedAtUtcMs: UtcEpochMs | null;
};

/** The last visit's fields — what «Пак същото» rebooks. */
export type LastVisit = Pick<
  ClientStats,
  | 'lastVisitAppointmentId'
  | 'lastVisitLocalDate'
  | 'lastVisitStartMinutes'
  | 'lastVisitServiceIds'
  | 'lastVisitBarberIds'
  | 'lastVisitLegs'
>;

/** The next visit's fields. */
export type NextVisit = Pick<
  ClientStats,
  | 'nextVisitAppointmentId'
  | 'nextVisitLocalDate'
  | 'nextVisitStartMinutes'
  | 'nextVisitServiceIds'
  | 'nextVisitBarberIds'
  | 'nextVisitLegs'
>;

/** The pause suggestion's fields — all empty when none stands. */
export type PauseSuggestion = Pick<
  ClientStats,
  | 'pauseSuggestedNoShows'
  | 'pauseSuggestedWindowDays'
  | 'pauseSuggestionBasis'
  | 'pauseSuggestedAtUtcMs'
>;

const NO_LAST_VISIT: LastVisit = {
  lastVisitAppointmentId: null,
  lastVisitLocalDate: null,
  lastVisitStartMinutes: null,
  lastVisitServiceIds: [],
  lastVisitBarberIds: [],
  lastVisitLegs: [],
};

const NO_NEXT_VISIT: NextVisit = {
  nextVisitAppointmentId: null,
  nextVisitLocalDate: null,
  nextVisitStartMinutes: null,
  nextVisitServiceIds: [],
  nextVisitBarberIds: [],
  nextVisitLegs: [],
};

const NO_PAUSE_SUGGESTION: PauseSuggestion = {
  pauseSuggestedNoShows: null,
  pauseSuggestedWindowDays: null,
  pauseSuggestionBasis: [],
  pauseSuggestedAtUtcMs: null,
};

export const LastVisit = {
  /** No worked visit yet. */
  NONE: NO_LAST_VISIT,
} as const;

export const NextVisit = {
  /** No open visit ahead. */
  NONE: NO_NEXT_VISIT,
} as const;

export const PauseSuggestion = {
  /** No suggestion stands. */
  NONE: NO_PAUSE_SUGGESTION,

  /** A suggestion stands — the three scalars are set together (N9). */
  isRaised(suggestion: PauseSuggestion): boolean {
    return suggestion.pauseSuggestedAtUtcMs !== null;
  },
} as const;

/**
 * Lifetime spend, tips excluded (a tip is not the shop's money), in the
 * cents of `currency` — the flat `lifetimeSpendMinor` + `currencyCode` the
 * document stores today, branded (N6). Its own slice because it lives in its
 * own admin-only document: rules cannot hide a field (R33).
 */
export type ClientMoneyStats = {
  /** The client's account — `UserId` until flip (1) (D29, §5.5). */
  readonly userId: UserId;
  readonly lifetimeSpendCents: PriceCents;
  readonly currency: Currency;
};

/**
 * The bookkeeping BOTH documents carry, bumped together on every change —
 * the revision guard writes only when the answer differs, and a stored pair
 * that disagrees on `version` is rewritten (`ClientStatsSystem.planWrite`).
 */
export type ClientStatsMeta = {
  readonly version: number;
  readonly updatedAtUtcMs: UtcEpochMs;
};

/**
 * THE POLICY PASS a stored answer was judged by (`client-stats-document.ts:
 * 364-395`): a pass stamps every client it judges with its generation and
 * change instant, and a pass whose change is OLDER than the stamp it finds
 * writes nothing — a superseded pass's late write never overwrites a newer
 * answer. Writers that are not a pass carry the stamp forward. A VALUE type
 * for `PolicyRecomputeJobSystem.judgePolicyPass`; stored, it is the flat
 * {@link PolicyPassStamp}.
 */
export type PolicyPass = {
  /** The pass's job generation (`PolicyRecomputeJob.generation`). */
  readonly generation: string;
  /** The settings write it answers — what orders two passes (§9 D17). */
  readonly changedAt: PreciseInstant;
};

export const PolicyPass = {
  of(generation: string, changedAt: PreciseInstant): PolicyPass {
    return { generation, changedAt };
  },
} as const;

/**
 * The policy pass as the stats document stores it — the 1-to-1 nullable
 * `policyPass` flattened by prefix (N9), the D17 instant as its two branded
 * halves. The three fields are `null` together: no pass has judged this
 * answer yet (most documents, today).
 */
export type PolicyPassStamp = {
  readonly policyPassGeneration: string | null;
  readonly policyPassChangedAtSeconds: EpochSeconds | null;
  readonly policyPassChangedAtNanos: SubsecondNanos | null;
};

const NO_POLICY_PASS: PolicyPassStamp = {
  policyPassGeneration: null,
  policyPassChangedAtSeconds: null,
  policyPassChangedAtNanos: null,
};

export const PolicyPassStamp = {
  /** No pass has judged the answer. */
  NONE: NO_POLICY_PASS,

  /** The stamp a pass leaves — {@link NONE} for no pass. */
  of(judgedBy: PolicyPass | null): PolicyPassStamp {
    if (judgedBy === null) return NO_POLICY_PASS;
    return {
      policyPassGeneration: judgedBy.generation,
      policyPassChangedAtSeconds: judgedBy.changedAt.seconds,
      policyPassChangedAtNanos: judgedBy.changedAt.nanos,
    };
  },

  /** The pass a stamp records, or `null` when it records none (any field missing). */
  read(stamp: PolicyPassStamp): PolicyPass | null {
    if (
      stamp.policyPassGeneration === null ||
      stamp.policyPassChangedAtSeconds === null ||
      stamp.policyPassChangedAtNanos === null
    ) {
      return null;
    }
    return {
      generation: stamp.policyPassGeneration,
      changedAt: {
        seconds: stamp.policyPassChangedAtSeconds,
        nanos: stamp.policyPassChangedAtNanos,
      },
    };
  },
} as const;

export const ClientStats = {
  /** A person with no history — what a first recompute starts from. */
  empty(userId: UserId): ClientStats {
    return {
      userId,
      lifetimeVisitsCompleted: 0,
      lifetimeNoShows: 0,
      lifetimeLateCancels: 0,
      lifetimeClientCancels: 0,
      last365VisitsCompleted: [],
      last365NoShows: [],
      last365LateCancels: [],
      firstVisitLocalDate: null,
      firstVisitStartMinutes: null,
      ...NO_LAST_VISIT,
      ...NO_NEXT_VISIT,
      avgCadenceDays: null,
      preferredBarberId: null,
      usualServiceIds: [],
      ...NO_PAUSE_SUGGESTION,
    };
  },
} as const;

export const ClientMoneyStats = {
  /** Nothing spent yet, in the shop's currency. */
  zero(userId: UserId): ClientMoneyStats {
    return {
      userId,
      lifetimeSpendCents: PriceCents.ZERO,
      currency: Currency.EUR,
    };
  },
} as const;
