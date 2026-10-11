import { AuditSystem } from '@core/systems';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FirestoreBookingStore } from '../../adapters/firestore-booking-store';
import { CryptoIdGenerator } from '../../adapters/crypto-id-generator';
import { SystemClock } from '../../adapters/system-clock';
import { adminFirestore } from '../firebase-admin';
import { loadBookingPolicy } from './load-booking-policy';
import {
  RescheduleBookingUseCase,
  type RescheduledBooking,
} from '../../use-cases/reschedule-booking.use-case';
import type { RescheduleBookingError } from '../../use-cases/reschedule-booking.errors';
import { toAttemptId, toHttpsError, toSeats } from './commit-booking';
import {
  type AuditSubject,
  appendAudit,
  loadAudience,
  requestedSeatSubjects,
} from './audit';
import { callerActor } from './caller-roles';

/**
 * Move refusal → wire error.
 *
 * Delegates everything it shares with a commit to `toHttpsError` rather than
 * restating that switch. The one code only a move can produce is
 * `failed-precondition`, deliberately NOT `aborted`: nothing about it is a
 * lost race the client could win by retrying — somebody else on the visit
 * cannot come to the new time, and only the shop can re-seat them.
 */
export function toRescheduleHttpsError(
  error: RescheduleBookingError,
): HttpsError {
  if (error.code === 'booking.reschedule.carried_seat_unplaceable') {
    return new HttpsError('failed-precondition', error.message, {
      code: error.code,
      params: error.params,
    });
  }
  return toHttpsError(error);
}

/**
 * Who a move touched: everyone on the visit BEFORE it (read before the
 * write, because only the old document still names them), everyone the cart
 * put on it, and everyone the written visit holds AFTER it — the companions
 * carried forward included. `appendAudit` keeps one row per person.
 */
export function rescheduleSubjects(
  before: readonly AuditSubject[],
  requested: readonly AuditSubject[],
  afterUserIds: readonly string[],
): readonly AuditSubject[] {
  return [
    ...before,
    ...requested,
    ...afterUserIds.map((userId): AuditSubject => ({
      kind: 'account',
      userId,
    })),
  ];
}

/** The key and the context one move's audit rows are written under. */
export interface MoveAudit {
  readonly changeKey: string;
  readonly context: Readonly<Record<string, string>>;
}

/**
 * How a move is logged — or `null` when it is not.
 *
 * ### A move that wrote
 * Keyed by the client's `attemptId` when it sent one (`move:…`), else by
 * the revision this move stamped (`revision:…`). Either is one value per
 * logical move, so `appendAudit`'s `create()` keeps it to one row per
 * person however often it gets here.
 *
 * ### A replay — nothing was written by THIS call
 * A move that committed must END WITH ITS ROWS (ruling 2026-09-25), and the
 * first attempt's rows can be missing — its `appendAudit` failed on a
 * transient error (logged, swallowed), or the instance died between the
 * commit and the log. The use case says which replay this is, from the
 * visit's applied-operations ledger, where the move's own write stamps
 * `move:<attemptId>` (`RescheduleBookingUseCase`):
 * - `replayedAttempt` — the ledger remembers this attempt: its first call
 *   WROTE. The rows are re-attempted under the SAME `move:…` key, so a gap
 *   is filled and a row that exists is not written twice. The row says it
 *   was written on the retry (`loggedOn`) and names the revision the
 *   ORIGINAL move stamped, which the ledger kept — a fact, not a guess.
 * - `replayedAttempt: false` — the ledger does not know the attempt, so no
 *   call of this move ever wrote: the stored visit simply already was the
 *   requested placement (a first call asking for where the visit is). No
 *   move happened, and nothing is logged.
 *
 * The use case always says which (`RescheduledBooking.replayedAttempt` is
 * required), so there is no third, unknown kind of replay to guess about.
 *
 * A replay WITHOUT an attempt id (an older client) logs nothing, as before:
 * the only key it has is the stored revision, and a staff note between the
 * move and its retry would make that a fresh key — one move, two rows.
 */
export function moveAudit(
  moved: Pick<RescheduledBooking, 'revision' | 'replayed' | 'replayedAttempt'>,
  attemptId: string | undefined,
): MoveAudit | null {
  if (moved.replayed) {
    if (attemptId === undefined || !moved.replayedAttempt) return null;
    return {
      changeKey: AuditSystem.changeKey.move(attemptId),
      context: { loggedOn: 'retry', revision: String(moved.revision) },
    };
  }
  return {
    changeKey:
      attemptId === undefined
        ? AuditSystem.changeKey.revision(moved.revision)
        : AuditSystem.changeKey.move(attemptId),
    context: { revision: String(moved.revision) },
  };
}

/**
 * The move write path — a callable, like every other appointment write, and
 * for the same reason: the browser must not write appointments.
 *
 * Payload shaping is the commit path's, verbatim (`toSeats`), because a
 * reschedule IS a commit of the same cart at a different time — plus every
 * seat the cart cannot express, which the use case carries from the stored
 * visit. The owner comes from `request.auth`; the appointment id is the one
 * fact the caller supplies that the server then checks ownership of.
 */
export const rescheduleAppointment = onCall(async (request) => {
  const db = adminFirestore();
  const useCase = new RescheduleBookingUseCase(
    new FirestoreBookingStore(db),
    new SystemClock(),
    new CryptoIdGenerator(),
    await loadBookingPolicy(db),
  );

  const payload = (request.data ?? {}) as Record<string, unknown>;
  const appointmentId = String(payload['appointmentId'] ?? '');
  const seats = toSeats(payload['seats']);
  const ownerUserId = request.auth?.uid ?? null;
  // Dropped, never refused, when it does not fit — see `toAttemptId`.
  const attemptId = toAttemptId(payload['attemptId']);
  // The people as they were, read BEFORE the move: a guest the cart no longer
  // names is affected too, and only the old document still says who they are.
  const before = await loadAudience(appointmentId, db);
  const result = await useCase.execute({
    appointmentId,
    locationId: String(payload['locationId'] ?? ''),
    seats,
    ownerUserId,
    // The move's name, for the visit's ledger: its write stamps it, and a
    // retry is then answered as the move it is (`replayedAttempt`).
    attemptId,
  });

  if (result.isFailure()) throw toRescheduleHttpsError(result.error);
  const moved = result.value;
  const audit = moveAudit(moved, attemptId);
  if (audit === null) return { appointmentId: moved.appointmentId };

  // After the commit, never inside it — and awaited, so the row exists when
  // the caller hears "moved"; a failed write is logged by `appendAudit` and
  // never fails the move. `create()` under a derived id makes the same key
  // reaching here twice one row per person — which is what lets a replay
  // re-attempt it at all.
  await appendAudit({
    actor: callerActor(request),
    action: 'booking.rescheduled',
    resourceId: moved.appointmentId,
    subjects: rescheduleSubjects(
      before.subjects,
      requestedSeatSubjects(seats, ownerUserId),
      moved.subjectUserIds,
    ),
    atIso: new Date().toISOString(),
    context: audit.context,
    changeKey: audit.changeKey,
  });
  return { appointmentId: moved.appointmentId };
});
