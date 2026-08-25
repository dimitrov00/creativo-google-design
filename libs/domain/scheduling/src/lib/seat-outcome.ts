import {
  AppointmentStatus,
  AppointmentStatusKind,
  COMPLETED,
  NO_SHOW,
  cancelled as cancelledStatus,
} from './appointment-status';

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
 */
export type CancellationReason =
  | { readonly kind: 'client_changed_plans' }
  | { readonly kind: 'client_unwell' }
  | { readonly kind: 'staff_barber_absence' }
  | { readonly kind: 'staff_shop_closure' }
  /** A no-show the shop later reclassified — kept distinct so it is never double-counted. */
  | { readonly kind: 'no_show_converted' }
  | { readonly kind: 'other'; readonly note: string };

export type CancellationReasonKind = CancellationReason['kind'];

/**
 * The codes a HUMAN may pick, in the order a shop reaches for them.
 *
 * `no_show_converted` is deliberately absent: it is stamped by the
 * correction edge when staff reclassify a no-show, never chosen from a list,
 * and offering it would let a cancellation be filed as a reclassification
 * that never happened.
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
 * asking.
 */
export function cancellationReasonOf(
  code: string,
  note: string,
): CancellationReason | null {
  const trimmed = note.trim();
  switch (code) {
    case 'client_changed_plans':
    case 'client_unwell':
    case 'staff_barber_absence':
    case 'staff_shop_closure':
    case 'no_show_converted':
      return { kind: code };
    case 'other':
      return trimmed.length === 0 ? null : { kind: 'other', note: trimmed };
    default:
      return null;
  }
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

export function seatCancelled(
  atMs: number,
  by: 'client' | 'staff',
  reason: CancellationReason,
): SeatOutcome {
  return { kind: 'cancelled', atMs, by, reason };
}

/** Anything but `scheduled` — a seat whose story is over. */
export function isSeatResolved(outcome: SeatOutcome): boolean {
  return outcome.kind !== 'scheduled';
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
  // Unreachable through `Appointment` (seats are non-empty by invariant), but
  // this function is total on its own terms.
  if (outcomes.length === 0) return current;
  if (outcomes.some((outcome) => outcome.kind === 'scheduled')) return current;

  const cancellations = outcomes.filter(
    (outcome): outcome is Extract<SeatOutcome, { kind: 'cancelled' }> =>
      outcome.kind === 'cancelled',
  );
  if (cancellations.length === outcomes.length) {
    return cancelledStatus(partyCancellationReason(cancellations, current));
  }

  return outcomes.some((outcome) => outcome.kind === 'worked')
    ? COMPLETED
    : NO_SHOW;
}

/**
 * The root's cancellation string when every seat was cancelled individually.
 *
 * A root cancel (`Appointment.cancel`) already carries the reason the shop
 * typed, and it is kept verbatim — re-deriving it from the seats it just
 * stamped would replace a human sentence with a code for no gain. Only a
 * party cancelled seat-by-seat has to synthesise one, and it does so from the
 * distinct codes so the string is still groupable.
 */
function partyCancellationReason(
  cancellations: readonly Extract<SeatOutcome, { kind: 'cancelled' }>[],
  current: AppointmentStatus,
): string {
  if (current.kind === 'cancelled') return current.reason;
  const codes = [
    ...new Set(
      cancellations.map((entry) => cancellationReasonCode(entry.reason)),
    ),
  ].sort();
  return codes.join('+');
}

/** The seat outcome a party-level lifecycle verb stamps on every open seat. */
export function outcomeForStatus(
  to: AppointmentStatusKind,
  atMs: number,
  reason: CancellationReason,
): SeatOutcome | null {
  switch (to) {
    case 'completed':
      return seatWorked(atMs);
    case 'no_show':
      return seatNoShow(atMs);
    case 'cancelled':
      return seatCancelled(atMs, 'staff', reason);
    // `pending`/`confirmed` say nothing about the work — a confirmed seat is
    // still `scheduled`.
    default:
      return null;
  }
}
