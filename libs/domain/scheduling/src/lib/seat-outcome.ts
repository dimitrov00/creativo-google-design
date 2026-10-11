import {
  AppointmentStatus,
  AppointmentStatusKind,
  COMPLETED,
  NO_SHOW,
  cancelled as cancelledStatus,
  toEcsBookingStatus,
  toEcsLifecycle,
} from './appointment-status';
import type { CancellationWindow } from './cancellation-window';
import {
  AttendanceState,
  BookingStatus,
  CancellationReason as CancellationReasonData,
  CancellationReasonSet,
  CancelledBy as CancelledByData,
  type SeatOutcome as SeatOutcomeData,
  SeatOutcome as SeatOutcomes,
  UtcEpochMs,
  defect,
} from '@creativo/ecs-core';

/*
 * THIN SHIM (ECS migration Phase 2). The seat-outcome rules — the closed
 * reason vocabulary, "resolved", the party verb's stamp, and the ROLL-UP of a
 * party's seats into the root status — are the ECS `SeatOutcome` companion
 * (`reasonOf`, `isResolved`, `outcomeForStatus`, `summarize`). These keep the
 * legacy shapes their callers hold (an `other` reason's note, a
 * `CancellationWindow` stamp, a status without an instant, the lower-case
 * stored tags) and only convert (flatten-spec §8.9).
 */

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

/** The stored lower-case reason code → the ecs-core SCREAMING code. */
const LEGACY_CANCELLATION_REASON = {
  client_changed_plans: CancellationReasonData.ClientChangedPlans,
  client_unwell: CancellationReasonData.ClientUnwell,
  staff_barber_absence: CancellationReasonData.StaffBarberAbsence,
  staff_shop_closure: CancellationReasonData.StaffShopClosure,
  no_show_converted: CancellationReasonData.NoShowConverted,
  unspecified: CancellationReasonData.Unspecified,
  other: CancellationReasonData.Other,
} as const satisfies Record<CancellationReasonKind, CancellationReasonData>;

/** The inverse: the ecs-core code → the stored lower-case code. */
function legacyReasonOf(code: CancellationReasonData): CancellationReasonKind {
  const kinds = Object.keys(
    LEGACY_CANCELLATION_REASON,
  ) as CancellationReasonKind[];
  for (const kind of kinds) {
    if (LEGACY_CANCELLATION_REASON[kind] === code) return kind;
  }
  // Unreachable: the table covers the closed vocabulary.
  defect(`unreachable: reason ${code}`);
}

/** The stored side tag → the ecs-core `CancelledBy`. */
const LEGACY_CANCELLED_BY = {
  client: CancelledByData.Client,
  staff: CancelledByData.Staff,
} as const satisfies Record<'client' | 'staff', CancelledByData>;

/** A stored epoch-ms instant as the ecs-core brand. */
function instantOf(ms: number): UtcEpochMs {
  const instant = UtcEpochMs.of(ms);
  // Unreachable: every instant here is a stored or stamped safe integer.
  if (!instant.ok) defect(`unreachable: instant ${ms}`);
  return instant.value;
}

/** A legacy outcome as the flat ecs-core slice (Phase 4 deletes it). */
export function toEcsSeatOutcome(outcome: SeatOutcome): SeatOutcomeData {
  switch (outcome.kind) {
    case 'scheduled':
      return SeatOutcomes.scheduled();
    case 'worked':
      return SeatOutcomes.worked(instantOf(outcome.atMs));
    case 'no_show':
      return SeatOutcomes.noShow(instantOf(outcome.atMs));
    case 'cancelled':
      return SeatOutcomes.cancelled(
        instantOf(outcome.atMs),
        LEGACY_CANCELLED_BY[outcome.by],
        LEGACY_CANCELLATION_REASON[outcome.reason.kind],
        outcome.window === null ? null : outcome.window.hours,
      );
  }
}

/** A party's reason set as the root string the legacy status stores — lower-case codes, `+`-joined. */
function legacyReasonSetOf(set: CancellationReasonSet): string {
  return CancellationReasonSet.codes(set).map(legacyReasonOf).join('+');
}

/**
 * Why a seat was called off.
 *
 * A CLOSED union, deliberately: prose cannot be aggregated. "Why do we lose
 * Saturday mornings" is answerable only if every cancellation carries a code
 * from a fixed vocabulary, and the `other` arm keeps its note beside the code
 * rather than instead of it.
 *
 * The split between `client_*` and `staff_*` is the one that matters
 * commercially — a shop that cancels its own bookings has a rostering
 * problem, and a shop whose clients cancel has a reminder problem. They must
 * never land in the same bucket.
 *
 * The reason is OPTIONAL (owner, 2026-09-11: a barber between cuts may not
 * have the time to say why). Optional does not mean absent: a cancellation
 * nobody explained is filed `unspecified`, its own groupable bucket — "how
 * many of Saturday's cancellations went unexplained" is a real question,
 * and one that a nullable field could only answer by counting holes. It is
 * distinct from `other`, which is a reason in the shop's words.
 */
export type CancellationReason =
  | { readonly kind: 'client_changed_plans' }
  | { readonly kind: 'client_unwell' }
  | { readonly kind: 'staff_barber_absence' }
  | { readonly kind: 'staff_shop_closure' }
  /** A no-show the shop later reclassified — kept distinct so it is never double-counted. */
  | { readonly kind: 'no_show_converted' }
  /** Nobody said why. What a cancellation without a picked reason is filed as. */
  | { readonly kind: 'unspecified' }
  | { readonly kind: 'other'; readonly note: string };

export type CancellationReasonKind = CancellationReason['kind'];

/**
 * The codes a HUMAN may pick, in the order a shop reaches for them.
 *
 * `no_show_converted` is deliberately absent: it is stamped by the
 * correction edge when staff reclassify a no-show, never chosen from a list,
 * and offering it would let a cancellation be filed as a reclassification
 * that never happened. `unspecified` is absent for the opposite reason — it
 * is what picking NOTHING means, so a chip for it would be a chip for
 * leaving the others alone.
 */
export const OFFERED_CANCELLATION_REASONS: readonly CancellationReasonKind[] = [
  'client_changed_plans',
  'client_unwell',
  'staff_barber_absence',
  'staff_shop_closure',
  'other',
];

/**
 * Build a reason from an untrusted code, or `null` if it is not one.
 *
 * The parse lives in the domain because the closed union is the whole point:
 * a server that accepted an unknown string would reopen the free-text bucket
 * this union exists to close. `other` is the only arm that carries a note,
 * and an `other` with nothing written is refused — it says less than not
 * asking. NO code at all is not an unknown code: it is the shop declining to
 * say, and it parses to `unspecified` rather than to a refusal.
 */
export function cancellationReasonOf(
  code: string,
  note: string,
): CancellationReason | null {
  // The legacy vocabulary is the stored lower-case one: a SCREAMING code is
  // not a code this API ever accepted.
  const trimmed = code.trim();
  if (
    trimmed.length > 0 &&
    !Object.hasOwn(LEGACY_CANCELLATION_REASON, trimmed)
  ) {
    return null;
  }
  const parsedData = SeatOutcomes.reasonOf(code);
  if (parsedData === null) return null;
  const parsed = legacyReasonOf(parsedData);
  if (parsed !== 'other') return { kind: parsed };
  // The legacy shape keeps an `other`'s sentence beside the code, and an
  // `other` with nothing written says less than not asking.
  const written = note.trim();
  return written.length === 0 ? null : { kind: 'other', note: written };
}

/**
 * The string the ROOT status carries when a party is cancelled outright.
 *
 * The code, not the note — `AppointmentStatus.cancelled` holds one string and
 * a groupable one is worth more than a sentence. `other`'s note stays on the
 * seat, which is the only place it can be read alongside what it explains.
 */
export function rootCancellationReason(reason: CancellationReason): string {
  return reason.kind;
}

/**
 * What became of ONE person's seat.
 *
 * ### Why this is per-seat and `AppointmentStatus` is not enough
 * `Appointment.status` is a party-level, root-level union. For a party of
 * three where one guest does not turn up there is **no representable state**:
 * mark the appointment `no_show` and two completed services and their revenue
 * vanish from every report; mark it `completed` and the no-show is invisible.
 * The no-show rate is uncomputable either way.
 *
 * Every other per-person fact — subject, service, variant, barber, terms,
 * start — already lives on `Seat` under the 2026-07-29 party ruling. Outcome
 * is the one that was left behind.
 *
 * ### `atMs`, not a `ZonedDateTime`
 * This is an INSTANT — when the shop resolved the seat — not a wall-clock
 * appointment time, and it is only ever subtracted from another instant (to
 * get a cancellation's lead time). Epoch milliseconds keep that arithmetic
 * zone-free and match how `OccupancyBlock` already stores its instants.
 *
 * ### Relationship to `ServiceOutcome`
 * `occupancy-reason.ts`'s `ServiceOutcome` (`scheduled | worked | no_show`)
 * is this union's kinds minus `cancelled` — by construction, because a
 * cancelled seat has no occupancy block at all: cancelling REMOVES the block
 * so the time becomes sellable again. The two must stay in step.
 */
export type SeatOutcome =
  | { readonly kind: 'scheduled' }
  | { readonly kind: 'worked'; readonly atMs: number }
  | { readonly kind: 'no_show'; readonly atMs: number }
  | {
      readonly kind: 'cancelled';
      readonly atMs: number;
      readonly by: 'client' | 'staff';
      readonly reason: CancellationReason;
      /**
       * The free-cancellation window IN FORCE when the seat was called off —
       * `BookingPolicy.cancellationWindow` as the cancel path read it.
       *
       * Stamped, never looked up (2026-09-25): the owner may move the window
       * at any time, and a cancellation is judged by the rule the client
       * cancelled under. Someone who cancelled 30 h ahead under a 24 h window
       * cancelled on time whatever the window says today, and a real late
       * cancel stays late when the window shrinks. With the lead time
       * (`atMs` against the start) and the line it was held against both on
       * the seat, "late" is auditable and reproducible.
       *
       * A `CancellationWindow`, never a raw number (2026-09-25, round 2): a
       * stamp is a window the policy itself could have set, or nothing. A
       * number here let a caller stamp `NaN` or `-1` that the mapper wrote
       * and then read back as unknown, so the stats quietly judged that
       * cancellation by today's window instead.
       *
       * `null` is UNKNOWN: a cancellation recorded before the stamp existed,
       * or a shop cancel whose policy read failed (`transitionAppointment`
       * stamps unknown rather than refusing the shop's own cancel). Nothing
       * can recover the rule it was made under, so the stats judge it by the
       * CURRENT policy (`ClientStatsPolicy.isLateCancellation`), which is why
       * the policy-change recompute still runs. Stored as the whole hours
       * under `windowHours`, omitted when unknown (`appointment-document.ts`).
       */
      readonly window: CancellationWindow | null;
    };

export type SeatOutcomeKind = SeatOutcome['kind'];

/** The state every seat starts in, and the only one that is not final. */
export const SEAT_SCHEDULED: SeatOutcome = { kind: 'scheduled' };

export function seatWorked(atMs: number): SeatOutcome {
  return { kind: 'worked', atMs };
}

export function seatNoShow(atMs: number): SeatOutcome {
  return { kind: 'no_show', atMs };
}

/**
 * A seat called off at `atMs`. `window` is the free-cancellation window in
 * force at that instant — required, and already validated (it is a
 * `CancellationWindow`, so no caller can stamp a number the policy would
 * refuse), so every cancel path has to say which rule it cancelled under;
 * `null` only when that rule is unknown.
 */
export function seatCancelled(
  atMs: number,
  by: 'client' | 'staff',
  reason: CancellationReason,
  window: CancellationWindow | null,
): SeatOutcome {
  return { kind: 'cancelled', atMs, by, reason, window };
}

/** Anything but `scheduled` — a seat whose story is over. */
export function isSeatResolved(outcome: SeatOutcome): boolean {
  return SeatOutcomes.isResolved(toEcsSeatOutcome(outcome));
}

/**
 * The groupable code for a cancellation.
 *
 * `other`'s note stays on the seat where it was written; only the code
 * travels into summaries, because a free-text note in a `GROUP BY` is a
 * bucket of one.
 */
export function cancellationReasonCode(
  reason: CancellationReason,
): CancellationReasonKind {
  return reason.kind;
}

/**
 * Roll a party's seat outcomes up into the root status.
 *
 * The root becomes a SUMMARY of its seats rather than an independent truth —
 * which is what makes the mixed party representable. The order of the rules
 * is the whole design:
 *
 *  1. **Any seat still `scheduled` → the root is unchanged.** `pending` vs
 *     `confirmed` is the root's own business (it is about the booking, not
 *     about the work), so a party mid-service keeps whatever it had.
 *  2. **Every seat cancelled → `cancelled`.** Nobody is coming.
 *  3. **Any seat worked → `completed`.** Work happened and was paid for; the
 *     seat that no-showed stays visible as a no-show *seat*. This is the case
 *     that had no representation before.
 *  4. **Otherwise → `no_show`.** All resolved, none worked, someone was
 *     expected — that is a no-show however many seats were cancelled first.
 *
 * Rule 3 beating rule 4 is deliberate: a party that generated revenue is not
 * a no-show, or the shop's completion rate would drop every time one guest of
 * three overslept.
 */
export function summarizeSeatOutcomes(
  outcomes: readonly SeatOutcome[],
  current: AppointmentStatus,
): AppointmentStatus {
  const currentData = toEcsLifecycle(current);
  const summary = SeatOutcomes.summarize(
    outcomes.map(toEcsSeatOutcome),
    currentData,
    instantOf(0),
  );
  // The root unchanged — still a seat open, or already in the derived state —
  // is the caller's own status, as given.
  if (summary === currentData) return current;
  switch (summary.bookingStatus) {
    case BookingStatus.Cancelled:
      return cancelledStatus(legacyReasonSetOf(summary.cancellationReason));
    case BookingStatus.Completed:
      return COMPLETED;
    default:
      return NO_SHOW;
  }
}

/**
 * The seat outcome a party-level lifecycle verb stamps on every open seat.
 * `window` is the free-cancellation window in force (`null` when unknown),
 * stamped on a cancellation and ignored by every other verb.
 */
export function outcomeForStatus(
  to: AppointmentStatusKind,
  atMs: number,
  reason: CancellationReason,
  window: CancellationWindow | null,
): SeatOutcome | null {
  const stamp = SeatOutcomes.outcomeForStatus(
    toEcsBookingStatus(to),
    instantOf(atMs),
    LEGACY_CANCELLATION_REASON[reason.kind],
    window === null ? null : window.hours,
  );
  if (stamp === null) return null;
  switch (stamp.attendanceState) {
    case AttendanceState.Worked:
      return seatWorked(stamp.workedAtUtcMs);
    case AttendanceState.NoShow:
      return seatNoShow(stamp.noShowAtUtcMs);
    case AttendanceState.Cancelled:
      // The legacy stamp keeps the reason as given (an `other`'s note) and
      // the window as the value the policy holds.
      return seatCancelled(stamp.cancelledAtUtcMs, 'staff', reason, window);
    default:
      return null;
  }
}
