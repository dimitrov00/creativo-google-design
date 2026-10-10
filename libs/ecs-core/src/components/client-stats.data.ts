import type { AppointmentId } from '../entities/appointment.entity';
import type { BarberId } from '../entities/barber.entity';
import type { ServiceId } from '../entities/service.entity';
import type { UserId } from '../entities/user.entity';
import { Currency, type Money } from './money.data';
import type { SeatId } from './seat.data';
import type { ServiceVariantId } from './service-terms.data';

const NANOS_PER_SECOND = 1_000_000_000;
const NANOS_PER_MS = 1_000_000;

/**
 * An instant at FULL precision — whole epoch seconds plus nanoseconds
 * (0..999 999 999), the representation §9 D17 picks for both sides of the
 * policy-pass comparison (`PolicyRecomputeJobEntity.changedAt` and
 * `PolicyPass.changedAt`). A Firestore event's time is stamped in
 * microseconds and a document's `updateTime` in nanoseconds, so two settings
 * writes inside one millisecond must not compare as simultaneous: epoch ms
 * alone would break the ordering, and an RFC 3339 string would need a
 * parser in a system. Integer compare, no parser.
 */
export type PreciseInstant = {
  readonly seconds: number;
  readonly nanos: number;
};

export const PreciseInstant = {
  /**
   * The edge guard: integral seconds and nanos in `[0, 1e9)`, or `null` —
   * an adapter builds one from a Timestamp's `{ seconds, nanoseconds }`.
   */
  of(seconds: number, nanos: number): PreciseInstant | null {
    if (
      !Number.isSafeInteger(seconds) ||
      !Number.isInteger(nanos) ||
      nanos < 0 ||
      nanos >= NANOS_PER_SECOND
    ) {
      return null;
    }
    // `+ 0` folds a negative zero.
    return { seconds: seconds + 0, nanos: nanos + 0 };
  },

  /** An epoch-ms instant at millisecond precision (floored seconds, so pre-1970 stays ordered). */
  fromEpochMs(epochMs: number): PreciseInstant {
    const seconds = Math.floor(epochMs / 1000);
    return {
      seconds: seconds + 0,
      nanos: (epochMs - seconds * 1000) * NANOS_PER_MS,
    };
  },

  /** Truncated to the millisecond — for display and coarse arithmetic, never for ordering. */
  toEpochMs(instant: PreciseInstant): number {
    return instant.seconds * 1000 + Math.floor(instant.nanos / NANOS_PER_MS);
  },

  /** Negative, zero or positive as `a` is before, at or after `b` — to the nanosecond. */
  compare(a: PreciseInstant, b: PreciseInstant): number {
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
 * the appointment's start. A party of three is three visits; a cut and a
 * beard trim for one client is one.
 */
export type VisitFact = {
  readonly appointmentId: AppointmentId;
  readonly atMs: number;
};

/** One service of a visit — enough to book it again («Същото»). */
export type VisitLeg = {
  readonly seatId: SeatId;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId;
  readonly minutes: number;
};

/** A visit with what the rebook needs — what `lastVisit`/`nextVisit` hold. */
export type VisitRef = VisitFact & {
  /** Distinct, in seat order. */
  readonly serviceIds: readonly ServiceId[];
  /** Distinct, in seat order. */
  readonly barberIds: readonly BarberId[];
  readonly legs: readonly VisitLeg[];
};

/**
 * «3 неявявания за 60 дни» — a SUGGESTION to pause, never a pause (R25, B1):
 * no code path turns it into one. A dismissal lives on the client's profile,
 * so a recompute can never undo it.
 */
export type PauseSuggestion = {
  readonly noShows: number;
  readonly windowDays: number;
  /** The no-shows it rests on, oldest first — what a reviewer checks. */
  readonly basis: readonly AppointmentId[];
  /** The newest no-show in the basis: a later one raises it anew. */
  readonly raisedAtMs: number;
};

/**
 * What the shop knows about one client's visits — a projection of their
 * appointments, recomputed whole on every relevant change, never edited
 * (`client-stats.ts:26-106`). Counts are per VISIT per subject (R33). Only
 * the last `ClientStatsPolicy.BOUNDED_DAYS` days keep their instants; windows
 * are computed at read, so a no-show leaves the 90-day count without a
 * rewrite. Money is deliberately absent — a barber reads this whole; spend is
 * `ClientMoneyStats`, in its own admin-only document.
 */
export type ClientStats = {
  readonly userId: UserId;
  readonly lifetime: {
    readonly visitsCompleted: number;
    readonly noShows: number;
    /** Client-caused cancellations inside the free window in force when each was made. */
    readonly lateCancels: number;
    /** Client-caused cancellations at any lead time (R35); shop-caused never count. */
    readonly clientCancels: number;
  };
  readonly last365: {
    readonly visitsCompleted: readonly VisitFact[];
    readonly noShows: readonly VisitFact[];
    readonly lateCancels: readonly VisitFact[];
  };
  readonly firstVisitAtMs: number | null;
  readonly lastVisit: VisitRef | null;
  /** The earliest open visit not yet over; a reader re-checks it against its own now. */
  readonly nextVisit: VisitRef | null;
  /** R34: mean days between worked visits once there are ≥ 3, shop-caused gaps excluded. */
  readonly avgCadenceDays: number | null;
  /** Asked for by name on ≥ 2 of the last 3 visits — never inferred from who was free. */
  readonly preferredBarberId: BarberId | null;
  /** Services on ≥ 3 of the last 5 visits, most frequent first. */
  readonly usualServiceIds: readonly ServiceId[];
  readonly pauseSuggestion: PauseSuggestion | null;
};

/**
 * Lifetime spend, tips excluded (a tip is not the shop's money), as a nested
 * `Money` — the declared rename of today's flat `lifetimeSpendMinor` +
 * `currencyCode: 'EUR'` (`client-stats.ts:106-110`, blueprint §2.5). Its own
 * type because it lives in its own admin-only document: rules cannot hide a
 * field (R33).
 */
export type ClientMoneyStats = {
  readonly userId: UserId;
  readonly lifetimeSpend: Money;
};

/**
 * The bookkeeping BOTH documents carry, bumped together on every change —
 * the revision guard writes only when the answer differs, and a stored pair
 * that disagrees on `version` is rewritten (`planClientStatsWrite`).
 */
export type ClientStatsMeta = {
  readonly version: number;
  readonly updatedAtMs: number;
};

/**
 * THE POLICY PASS a stored answer was judged by (`client-stats-document.ts:
 * 364-395`): a pass stamps every client it judges with its generation and
 * change instant, and a pass whose change is OLDER than the stamp it finds
 * writes nothing — a superseded pass's late write never overwrites a newer
 * answer. Writers that are not a pass carry the stamp forward.
 */
export type PolicyPass = {
  /** The pass's job generation (`PolicyRecomputeJobEntity.generation`). */
  readonly generation: string;
  /** The settings write it answers — what orders two passes (§9 D17). */
  readonly changedAt: PreciseInstant;
};

export const PolicyPass = {
  of(generation: string, changedAt: PreciseInstant): PolicyPass {
    return { generation, changedAt };
  },
} as const;

export const ClientStats = {
  /** A person with no history — what a first recompute starts from. */
  empty(userId: UserId): ClientStats {
    return {
      userId,
      lifetime: {
        visitsCompleted: 0,
        noShows: 0,
        lateCancels: 0,
        clientCancels: 0,
      },
      last365: { visitsCompleted: [], noShows: [], lateCancels: [] },
      firstVisitAtMs: null,
      lastVisit: null,
      nextVisit: null,
      avgCadenceDays: null,
      preferredBarberId: null,
      usualServiceIds: [],
      pauseSuggestion: null,
    };
  },
} as const;

export const ClientMoneyStats = {
  /** Nothing spent yet, in the shop's currency. */
  zero(userId: UserId): ClientMoneyStats {
    return {
      userId,
      lifetimeSpend: { amountMinorUnits: 0, currencyCode: Currency.EUR },
    };
  },
} as const;
