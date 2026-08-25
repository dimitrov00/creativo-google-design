import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  type AppointmentStatus,
  type AppointmentStatusKind,
  type CancellationReason,
  cancellationReasonOf,
  canTransition,
  outcomeForStatus,
  SEAT_SCHEDULED,
  rootCancellationReason,
  summarizeSeatOutcomes,
} from '@creativo/domain/scheduling';
import {
  seatOutcomeFromDocument,
  seatOutcomeToDocument,
} from '@creativo/application/booking';
import { STAFF_ROLES } from '@creativo/domain/accounts';
import { adminFirestore } from '../firebase-admin';
import { appendAudit } from './audit';

/**
 * The staff write path for an appointment's LIFECYCLE — confirm, complete,
 * no-show, and the shop's own cancel. One callable, because the four verbs
 * are one fact ("this appointment is now X") guarded by one graph
 * (`canTransition`), and four copies of the load/authorize/check/write
 * shell would drift on the first edit.
 *
 * ### This is the product's first `pending → confirmed` step
 * Until this callable existed nothing ever called `confirm()` — every
 * booking sat `pending` forever, which made `completed`/`no_show`
 * structurally unreachable (the graph only reaches them from `confirmed`).
 * The staff day view is where a booking becomes real, and this is its pen.
 *
 * ### Role check mirrors `firestore.rules`
 * `request.auth.token.roles` against the SAME `STAFF_ROLES` grouping the
 * rules' `isStaff()` uses. The check is server-side and claims-based — a
 * client cannot grant itself these roles (rules keep the users doc's
 * `roles` field Admin-SDK-only, and `verifyOtp` mints only what the doc
 * says).
 *
 * ### No cancellation window here
 * `BookingPolicy.mayCancelAt` is a CLIENT-fairness rule — the shop refusing
 * late cancellations from clients. The shop itself may always move its own
 * book: a barber calling in sick at 08:00 must be able to clear the day.
 *
 * ### Freeing time is the point, not a side effect
 * `rebuildBusy` counts only `pending`/`confirmed` as live, so transitioning
 * a FUTURE appointment to `cancelled` (or an early `completed`) frees its
 * slot and wakes the waitlist matcher — exactly what the shop wants when
 * it clears a day.
 */
const STAFF_TRANSITIONS: readonly AppointmentStatusKind[] = [
  'confirmed',
  'completed',
  'no_show',
  'cancelled',
];

/**
 * When this seat's service ends, in epoch ms.
 *
 * Only consulted by `seatOutcomeFromDocument`'s legacy path — the best-effort
 * reading of rows written before outcomes existed. `0` would make those rows
 * look ancient and resolve them wrongly, so it is parsed rather than faked.
 */
function seatEndMs(seat: Record<string, unknown>): number {
  const slot = seat['slot'] as Record<string, unknown> | undefined;
  const parsed = Date.parse(String(slot?.['endIso'] ?? ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** The audit row's `context`, or nothing when there is nothing to record. */
function auditContext(
  reason: CancellationReason | null,
  seatId: string,
): { context?: Record<string, string> } {
  const context: Record<string, string> = {};
  if (reason) {
    context['reason'] = reason.kind;
    if (reason.kind === 'other') context['note'] = reason.note;
  }
  if (seatId) context['seatId'] = seatId;
  return Object.keys(context).length > 0 ? { context } : {};
}

/** A seat whose story is already over — re-stamping it would rewrite history. */
function isResolved(seat: Record<string, unknown> | undefined): boolean {
  const outcome = seat?.['outcome'] as Record<string, unknown> | undefined;
  return (
    typeof outcome?.['kind'] === 'string' && outcome['kind'] !== 'scheduled'
  );
}

function isStaffCaller(request: { auth?: { token?: object } }): boolean {
  const token = (request.auth?.token ?? {}) as Record<string, unknown>;
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  return roles.some((role) =>
    (STAFF_ROLES as readonly string[]).includes(String(role)),
  );
}

export const transitionAppointment = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in first', {
      code: 'booking.transition.unauthenticated',
    });
  }
  if (!isStaffCaller(request)) {
    // Deliberately NOT masked as not-found: unlike the owner-only cancel,
    // this endpoint's existence is not a secret — the caller simply lacks
    // the role, and saying so is more debuggable than a phantom 404.
    throw new HttpsError('permission-denied', 'Staff only', {
      code: 'booking.transition.forbidden',
    });
  }

  const payload = (request.data ?? {}) as Record<string, unknown>;
  const appointmentId = String(payload['appointmentId'] ?? '');
  const to = String(payload['to'] ?? '') as AppointmentStatusKind;
  const seatId = String(payload['seatId'] ?? '').trim();

  // The reason is a CODE from the closed union, parsed in the domain. Prose
  // cannot be aggregated, and every cancellation this shop has ever recorded
  // was filed `other` because the old shape only had somewhere to put a
  // sentence.
  const reason =
    to === 'cancelled'
      ? cancellationReasonOf(
          String(payload['reasonCode'] ?? ''),
          String(payload['note'] ?? ''),
        )
      : null;

  if (
    appointmentId.length === 0 ||
    !STAFF_TRANSITIONS.includes(to) ||
    (to === 'cancelled' && reason === null)
  ) {
    throw new HttpsError('invalid-argument', 'Invalid transition request', {
      code: 'booking.transition.invalid_input',
    });
  }

  const db = adminFirestore();
  let ownerUserId: string | null = null;
  // Reported separately in the audit trail: "confirmed a pending booking" and
  // "took a no-show back" are different acts, and a shop reviewing who
  // reverses stamps must be able to count the second without the first.
  let reopened = false;

  await db.runTransaction(async (tx) => {
    const ref = db.collection('appointments').doc(appointmentId);
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data) {
      throw new HttpsError('not-found', 'No such appointment', {
        code: 'booking.transition.not_found',
      });
    }

    const status = data['status'] as AppointmentStatus;
    ownerUserId =
      typeof data['ownerUserId'] === 'string' ? data['ownerUserId'] : null;

    const seats = Array.isArray(data['seats'])
      ? (data['seats'] as Record<string, unknown>[])
      : [];

    const seatOutcome = outcomeForStatus(
      to,
      Date.now(),
      reason ?? { kind: 'other', note: '' },
    );

    if (seatId.length > 0) {
      // ── One person's seat ──────────────────────────────────────────────
      //
      // A party of three has three answers and the root can hold one. Before
      // this branch, marking a no-show in Ivan's lane stamped Stefan's
      // completed cut as a no-show too — not missing data, WRONG data.
      //
      // The graph is not consulted here, because the guard is about the SEAT,
      // not the root: a root sitting `confirmed` while one guest is resolved
      // is exactly the state this branch produces and must be able to re-enter.
      const index = seats.findIndex((seat) => seat['id'] === seatId);
      if (index < 0) {
        throw new HttpsError('not-found', 'No such seat', {
          code: 'booking.transition.not_found',
        });
      }
      if (seatOutcome === null) {
        // `confirmed` says nothing about the work, so it has no per-seat
        // meaning — confirming is a party-level act by construction.
        throw new HttpsError('invalid-argument', 'Not a per-seat verb', {
          code: 'booking.transition.invalid_input',
        });
      }
      if (isResolved(seats[index])) {
        throw new HttpsError(
          'failed-precondition',
          'That seat is already resolved',
          {
            code: 'booking.transition.not_allowed',
            params: { from: 'resolved', to },
          },
        );
      }

      const next = seats.map((seat, at) =>
        at === index
          ? { ...seat, outcome: seatOutcomeToDocument(seatOutcome) }
          : seat,
      );

      // The root becomes a SUMMARY of its seats rather than an independent
      // truth — the domain's own fold, so "any seat worked → completed" beats
      // "all resolved, none worked → no_show" here exactly as it does in every
      // report computed downstream.
      tx.update(ref, {
        seats: next,
        status: summarizeSeatOutcomes(
          next.map((seat) =>
            seatOutcomeFromDocument(seat['outcome'], status, seatEndMs(seat)),
          ),
          status,
        ),
      });
      return;
    }

    // ── The whole party ──────────────────────────────────────────────────
    //
    // The DOMAIN's graph, never re-encoded: completed stays completed,
    // pending cannot skip to completed, and `no_show → confirmed` is legal
    // because it is the lifecycle's one correction edge.
    if (!canTransition(status, to)) {
      throw new HttpsError(
        'failed-precondition',
        `Cannot move ${status.kind} to ${to}`,
        {
          code: 'booking.transition.not_allowed',
          params: { from: status.kind, to },
        },
      );
    }

    // ── Reopening a no-show ──────────────────────────────────────────────
    //
    // The correction edge needs the mirror of what `markNoShow` wrote, and
    // it cannot come from `outcomeForStatus`: confirming says nothing about
    // the work, so that returns null and the seats would keep the `no_show`
    // stamps while the root walked back to `confirmed`. A booking reading
    // "confirmed" over seats reading "no-show" is a worse state than the one
    // being undone, and it would poison every seat count downstream.
    //
    // Only seats the STAMP wrote are lifted — `no_show` back to `scheduled`.
    // A seat resolved individually before the party-level mark (the guest
    // who cancelled while the others waited) keeps what it was given, which
    // is the same rule the forward path honours. Mirrors
    // `Appointment.reopenNoShow`; the two must move together.
    const reopening = status.kind === 'no_show' && to === 'confirmed';

    // A seat already resolved individually keeps what it was given; this only
    // closes the ones still open. Placement is untouched: a no-show still
    // occupied the chair, and `rebuildBusy` recomputes from the status.
    tx.update(ref, {
      status:
        to === 'cancelled' && reason !== null
          ? { kind: 'cancelled', reason: rootCancellationReason(reason) }
          : { kind: to },
      ...(reopening
        ? {
            seats: seats.map((seat) =>
              (seat['outcome'] as Record<string, unknown> | undefined)?.[
                'kind'
              ] === 'no_show'
                ? { ...seat, outcome: seatOutcomeToDocument(SEAT_SCHEDULED) }
                : seat,
            ),
          }
        : seatOutcome === null
          ? {}
          : {
              seats: seats.map((seat) =>
                isResolved(seat)
                  ? seat
                  : { ...seat, outcome: seatOutcomeToDocument(seatOutcome) },
              ),
            }),
    });
    reopened = reopening;
  });

  // After the commit, never inside it — see `appendAudit`. The TARGET is
  // the appointment's owner: "who did what TO WHOM" must name the client,
  // not default to the staff actor.
  void appendAudit({
    actorUserId: uid,
    action: reopened ? 'booking.staff_reopen_no_show' : `booking.staff_${to}`,
    resourceId: appointmentId,
    targetUserId: ownerUserId ?? undefined,
    atIso: new Date().toISOString(),
    // The CODE plus the note, not a bare sentence — the audit row is the only
    // durable record of who called this off and why, and a groupable field
    // there is what lets "who cancels most" be answered at all. One object:
    // a per-seat cancellation carries BOTH facts and two spreads would drop
    // whichever came first.
    ...auditContext(reason, seatId),
  });

  return { appointmentId, to };
});
