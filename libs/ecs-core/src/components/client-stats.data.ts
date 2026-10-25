import type {
  AppointmentId,
  BarberId,
  LocalDate,
  MinuteOfDay,
  ServiceId,
  UtcEpochMs,
} from '@core/primitives';
import { LastVisit } from './last-visit.data';
import { NextVisit } from './next-visit.data';
import { PauseSuggestion } from './pause-suggestion.data';
import type { VisitFact } from './visit-fact.data';
import type { VisitLeg } from './visit-leg.data';

/*
 * One name per file (pass D, S-21; L-1): the siblings this file used to
 * hold — `PreciseInstant`, `LivePolicyLine`, `VisitFact`, `VisitLeg`,
 * `LastVisit`, `NextVisit`, `PauseSuggestion`, `ClientMoneyStats`,
 * `ClientStatsKey`, `ClientStatsMeta`, `PolicyPass`, `PolicyPassStamp` —
 * live in their own `*.data.ts` files, names kept.
 */

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
 *
 * The CONTENT only: whose stats they are is the record's
 * `ClientStatsKey`, so the same math answers a client record (the
 * projection) and an account's own visits alike (D29).
 */
export type ClientStats = {
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

export const ClientStats = {
  /** A person with no history — what a first recompute starts from. */
  empty(): ClientStats {
    return {
      lifetimeVisitsCompleted: 0,
      lifetimeNoShows: 0,
      lifetimeLateCancels: 0,
      lifetimeClientCancels: 0,
      last365VisitsCompleted: [],
      last365NoShows: [],
      last365LateCancels: [],
      firstVisitLocalDate: null,
      firstVisitStartMinutes: null,
      ...LastVisit.NONE,
      ...NextVisit.NONE,
      avgCadenceDays: null,
      preferredBarberId: null,
      usualServiceIds: [],
      ...PauseSuggestion.NONE,
    };
  },
} as const;
