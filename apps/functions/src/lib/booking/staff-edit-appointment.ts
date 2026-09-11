import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { match } from '@creativo/domain/kernel';
import { FirestoreBookingStore } from '../../adapters/firestore-booking-store';
import { FirestoreDiscountResolver } from '../../adapters/firestore-discount-resolver';
import { FirestoreVoucherLedger } from '../../adapters/firestore-voucher-ledger';
import { SystemClock } from '../../adapters/system-clock';
import { adminFirestore } from '../firebase-admin';
import { loadBookingPolicy } from './load-booking-policy';
import { appendAudit } from './audit';
import { callerRoles } from './caller-roles';
import { toHttpsError } from './commit-booking';
import {
  type StaffEditCommand,
  StaffEditAppointmentUseCase,
} from '../../use-cases/staff-edit-appointment.use-case';
import type { StaffEditError } from '../../use-cases/staff-edit-appointment.errors';

/**
 * Staff refusal → wire error.
 *
 * Delegates everything it shares with a commit to `toHttpsError` rather than
 * restating that switch — one vocabulary, one place it is mapped. Only the
 * codes this path can produce on its own are listed.
 *
 * `booking.staffEdit.overlaps` is `failed-precondition`, deliberately NOT
 * `aborted`: a lost race is retryable and this is not one. The slot has not
 * "just gone"; somebody is in it, the shop can see who, and the answer is a
 * decision («Запази въпреки застъпването») rather than a retry.
 */
function toStaffHttpsError(error: StaffEditError): HttpsError {
  const details = { code: error.code, params: error.params };
  switch (error.code) {
    case 'booking.staffEdit.unauthenticated':
      return new HttpsError('unauthenticated', error.message, details);
    case 'booking.staffEdit.forbidden':
      return new HttpsError('permission-denied', error.message, details);
    case 'booking.staffEdit.invalid_command':
      return new HttpsError('invalid-argument', error.message, details);
    case 'booking.staffEdit.overlaps':
    case 'booking.staffEdit.before_arrival':
    case 'booking.staffEdit.stale':
      return new HttpsError('failed-precondition', error.message, details);
    default:
      return toHttpsError(error);
  }
}

/**
 * The command, read as primitives.
 *
 * Nothing is coerced and nothing is defaulted: an absent `kind` reaches the
 * use case as an absent `kind` and is refused by name, rather than as some
 * later `String()`'s `"undefined"`. The real validation is
 * `validateCommand` in the use case, where it is unit-testable without a
 * transport.
 */
function toCommand(raw: unknown): StaffEditCommand | StaffEditCommand[] {
  return Array.isArray(raw)
    ? (raw as StaffEditCommand[])
    : ((raw ?? {}) as StaffEditCommand);
}

/**
 * What the audit row calls this write.
 *
 * A gesture is named by its own kind — "who moved bookings" and "who
 * discounted them" are different questions asked of the same log. A SAVE is
 * several kinds at once, and naming it after whichever arm happens to be
 * first would file the same act under a different heading depending on what
 * else the barber changed. It gets its own name.
 */
function auditKind(command: StaffEditCommand | StaffEditCommand[]): string {
  if (!Array.isArray(command)) return command.kind ?? 'edit';
  return command.length === 1 ? (command[0]?.kind ?? 'edit') : 'save';
}

/**
 * `staffEditAppointment` — the shop's own pen on its own book.
 *
 * ### Why the gate is `worksTheBook`, not `isStaff`
 * `STAFF_ROLES` includes `content_manager`, and `firestore.rules` deliberately
 * refuses that role every READ on `appointments` — a copy-and-media role has
 * no business seeing every client's name, phone and note. Gating the writes on
 * the broader grouping would hand a marketing account the power to move — and,
 * from M7, to discount — bookings it is not allowed to look at. The two
 * existing callables that made that mistake were fixed in the same change.
 *
 * ### Why the payload is a command and not a patch
 * See `StaffEditCommand`. In short: a patch of two timestamps cannot say which
 * edge is the problem, and cannot express the three acts that are not
 * geometry at all.
 */
export const staffEditAppointment = onCall(async (request) => {
  const db = adminFirestore();
  const useCase = new StaffEditAppointmentUseCase(
    new FirestoreBookingStore(db),
    new SystemClock(),
    await loadBookingPolicy(db),
    new FirestoreDiscountResolver(db),
    new FirestoreVoucherLedger(db),
  );

  const payload = (request.data ?? {}) as Record<string, unknown>;
  const command = toCommand(payload['command']);
  const result = await useCase.execute({
    appointmentId: String(payload['appointmentId'] ?? ''),
    // From the VERIFIED token, both of them. A caller naming its own uid or
    // its own roles is the one thing this endpoint must never read.
    actorUserId: request.auth?.uid ?? null,
    actorRoles: callerRoles(request),
    command,
    acknowledgedOverlap: payload['acknowledgedOverlap'] === true,
    expectedVersion:
      typeof payload['expectedVersion'] === 'number'
        ? payload['expectedVersion']
        : null,
  });

  return match(result, {
    success: ({ appointmentId, revision }) => {
      // After the commit, never inside it — see `appendAudit`. The command
      // KIND rides in the context because "who moved bookings" and "who
      // discounted them" are different questions asked of the same log, and a
      // single `booking.staff_edited` row cannot answer the second.
      void appendAudit({
        actorUserId: request.auth?.uid ?? '',
        action: `booking.staff_${auditKind(command)}`,
        resourceId: appointmentId,
        atIso: new Date().toISOString(),
        context: { revision: String(revision) },
      });
      return { appointmentId, revision };
    },
    failure: (error) => {
      throw toStaffHttpsError(error);
    },
  });
});
