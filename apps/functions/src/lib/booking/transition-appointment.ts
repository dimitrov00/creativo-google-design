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
import { adminFirestore } from '../firebase-admin';
import { appendAudit } from './audit';
import { callerWorksTheBook } from './caller-roles';
import { applyVoucherRestore, planVoucherRestore } from './voucher-restore';

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
 * `request.auth.token.roles` against the SAME `worksTheBook()` grouping the
 * rules use on `appointments` — NOT the broader `isStaff()`. It used to be
 * `STAFF_ROLES`, which includes `content_manager`: a role the rules refuse
 * every appointment READ could nonetheless confirm, cancel, no-show and
 * stamp arrival on one. The check is server-side and claims-based — a
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
/**
 * The shop's calendar day of an instant — `YYYY-MM-DD` in the slot's zone.
 * `en-CA` is the one locale whose default date is ISO-shaped.
 */
function shopDayKey(ms: number, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

function seatStartMs(seat: Record<string, unknown>): number {
  const slot = seat['slot'] as Record<string, unknown> | undefined;
  return Date.parse(String(slot?.['startIso'] ?? ''));
}

/** A seat that still holds its chair: no outcome yet, or scheduled. */
function seatIsLive(seat: Record<string, unknown>): boolean {
  const kind = (seat['outcome'] as Record<string, unknown> | undefined)?.[
    'kind'
  ];
  return kind === undefined || kind === 'scheduled';
}

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

export const transitionAppointment = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in first', {
      code: 'booking.transition.unauthenticated',
    });
  }
  if (!callerWorksTheBook(request)) {
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
  // sentence. It is OPTIONAL (owner, 2026-09-11): no code files the
  // cancellation as `unspecified`, while an unknown code — or `other` with
  // nothing written — is still refused below.
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
  let reopenedFrom: AppointmentStatusKind | null = null;

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

    // A cancellation gives back what gift vouchers paid (2026-09-10). Read
    // now — every read precedes every write — and applied below only where
    // the ROOT actually ends up cancelled.
    const restore =
      to === 'cancelled'
        ? await planVoucherRestore(tx, db, data, {
            iso: new Date().toISOString(),
            zone: String(
              (data['timeSlot'] as Record<string, unknown> | undefined)?.[
                'zone'
              ] ?? 'Europe/Sofia',
            ),
          })
        : null;

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
      const summarized = summarizeSeatOutcomes(
        next.map((seat) =>
          seatOutcomeFromDocument(seat['outcome'], status, seatEndMs(seat)),
        ),
        status,
      );
      const rootCancelled = summarized.kind === 'cancelled' && restore !== null;
      tx.update(ref, {
        seats: next,
        status: summarized,
        ...(rootCancelled
          ? { voucherRedemptions: restore.voucherRedemptions }
          : {}),
      });
      if (rootCancelled) applyVoucherRestore(tx, restore);
      return;
    }

    // ── The whole party ──────────────────────────────────────────────────
    //
    // The DOMAIN's graph, never re-encoded: completed stays completed,
    // pending cannot skip to completed, and `no_show → confirmed` is legal
    // because it is the lifecycle's one correction edge.
    /*
     * THE SAME-DAY CORRECTION EDGES (owner ruling 2026-09-08).
     *
     * `completed` and `cancelled` stay terminal in the graph — money and
     * history hang off them, and `canTransition` must keep saying no to
     * everyone else. But the ten minutes after a fat-fingered `Готово` or a
     * mis-tapped `Откажи` are real, and the desk needs a way back that is
     * not "book it again". So the ROOT (never a seat) may return to
     * `confirmed` while the shop is still inside the visit's own day, and
     * every settled seat goes back to scheduled with it. Audited under its
     * own action, so a report can tell a correction from a booking.
     *
     * Reinstating a cancellation has one extra check: the slot was released
     * when it was cancelled, and the waitlist may have been paged into it.
     * The chair has to be free again, or the answer is honestly "taken".
     */
    const reopeningSettled =
      seatId.length === 0 &&
      to === 'confirmed' &&
      (status.kind === 'completed' || status.kind === 'cancelled');
    if (reopeningSettled) {
      const zone = String(
        (data['timeSlot'] as Record<string, unknown> | undefined)?.['zone'] ??
          'Europe/Sofia',
      );
      const endMs = Math.max(0, ...seats.map(seatEndMs));
      const nowMs = Date.now();
      if (shopDayKey(endMs, zone) !== shopDayKey(nowMs, zone)) {
        throw new HttpsError(
          'failed-precondition',
          'A settled visit can only be reopened on its own day',
          {
            code: 'booking.transition.reopen_window_closed',
            params: { from: status.kind, to },
          },
        );
      }
      if (status.kind === 'cancelled') {
        const keys = Array.isArray(data['busyKeys'])
          ? (data['busyKeys'] as string[])
          : [];
        for (const key of keys) {
          const others = await tx.get(
            db
              .collection('appointments')
              .where('busyKeys', 'array-contains', key)
              .where('status.kind', 'in', ['pending', 'confirmed']),
          );
          for (const other of others.docs) {
            if (other.id === appointmentId) continue;
            const theirs = Array.isArray(other.data()['seats'])
              ? (other.data()['seats'] as Record<string, unknown>[])
              : [];
            const taken = seats.some((mine) =>
              theirs.some(
                (seat) =>
                  seatIsLive(seat) &&
                  seat['barberId'] === mine['barberId'] &&
                  seatStartMs(seat) < seatEndMs(mine) &&
                  seatStartMs(mine) < seatEndMs(seat),
              ),
            );
            if (taken) {
              throw new HttpsError(
                'failed-precondition',
                'That time has been taken since',
                {
                  code: 'booking.transition.slot_taken',
                  params: { from: status.kind, to },
                },
              );
            }
          }
        }
      }
      tx.update(ref, {
        status: { kind: 'confirmed' },
        seats: seats.map((seat) =>
          seatIsLive(seat)
            ? seat
            : { ...seat, outcome: seatOutcomeToDocument(SEAT_SCHEDULED) },
        ),
      });
      reopenedFrom = status.kind;
      return;
    }
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
      ...(restore ? { voucherRedemptions: restore.voucherRedemptions } : {}),
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
    if (restore) applyVoucherRestore(tx, restore);
    if (reopening) reopenedFrom = 'no_show';
  });

  // After the commit, never inside it — see `appendAudit`. The TARGET is
  // the appointment's owner: "who did what TO WHOM" must name the client,
  // not default to the staff actor.
  void appendAudit({
    actorUserId: uid,
    action:
      reopenedFrom === 'no_show'
        ? 'booking.staff_reopen_no_show'
        : reopenedFrom === 'completed'
          ? 'booking.staff_reopen_completed'
          : reopenedFrom === 'cancelled'
            ? 'booking.staff_reinstate'
            : `booking.staff_${to}`,
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
