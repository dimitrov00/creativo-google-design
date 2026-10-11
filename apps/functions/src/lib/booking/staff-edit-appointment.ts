import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { AuditSystem, OperationId } from '@creativo/ecs-core';
import { FirestoreBookingStore } from '../../adapters/firestore-booking-store';
import { FirestoreDiscountResolver } from '../../adapters/firestore-discount-resolver';
import { FirestoreVoucherLedger } from '../../adapters/firestore-voucher-ledger';
import { SystemClock } from '../../adapters/system-clock';
import { adminFirestore } from '../firebase-admin';
import { loadBookingPolicy } from './load-booking-policy';
import { type AuditSubject, appendAudit, loadAudience } from './audit';
import { callerActor, callerRoles } from './caller-roles';
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
export function toStaffHttpsError(error: StaffEditError): HttpsError {
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
    // A server bug, in the staff family's own words: never the caller's
    // fault, so never `invalid-argument`.
    case 'booking.staffEdit.invariant_violated':
      return new HttpsError('internal', error.message, details);
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
 * The intent's name, as sent. Absent — `undefined` or `null` — stays absent:
 * an older client, whose every send is its own change. Anything else reaches
 * the use case AS A STRING to be shape-checked there, a non-string becoming
 * one that cannot pass — so a malformed name is refused by name rather than
 * dropped, which would quietly switch the dedupe off.
 */
export function toOperationId(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  return typeof raw === 'string' ? raw : '';
}

/**
 * The revision the intent was made on, as sent. Absent — `undefined` or
 * `null` — stays absent: a caller that makes no claim. A number reaches the
 * use case as it is, to be shape-checked there; anything else becomes
 * `NaN`, a number that cannot pass — so a malformed claim is refused by
 * name (`invalid_command`, field `expectedVersion`) rather than dropped,
 * which would quietly switch the stale-screen guard off (round 5: it read
 * every non-number as "no claim").
 */
export function toExpectedVersion(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  return typeof raw === 'number' ? raw : Number.NaN;
}

/**
 * The key one staff edit's audit rows are written under: the intent's name
 * when the client sent one — the same on the first send and on every
 * re-send, so a re-send that is answered without writing still re-attempts
 * the rows and fills whatever the first send lost — else the revision the
 * edit stamped, one per committed edit.
 */
export function staffEditChangeKey(
  operationId: string | null,
  revision: number,
): string {
  return AuditSystem.changeKey.staffEdit(
    operationId === null ? null : OperationId.of(operationId),
    revision,
  );
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
 * Who the edit touched: everyone on the visit BEFORE it — a removed seat's
 * person was affected most of all — plus the owner when an `addSeat` gives
 * them a seat of their own. A seat can only ever be added for the owner or a
 * guest, so nobody else can join through an edit.
 */
export function staffEditSubjects(
  before: readonly AuditSubject[],
  ownerUserId: string | null,
  command: StaffEditCommand | StaffEditCommand[],
): readonly AuditSubject[] {
  const commands = Array.isArray(command) ? command : [command];
  const addsOwner = commands.some(
    (arm) => arm.kind === 'addSeat' && arm.subject?.kind === 'self',
  );
  return addsOwner && ownerUserId
    ? [...before, { kind: 'account', userId: ownerUserId }]
    : before;
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
  const appointmentId = String(payload['appointmentId'] ?? '');
  const operationId = toOperationId(payload['operationId']);
  // The people as they were, read BEFORE the edit: the use case hands back no
  // seats, and after a `removeSeat` the stored visit no longer names the
  // person it dropped — the one the row matters to most.
  const before = await loadAudience(appointmentId, db);
  const result = await useCase.execute({
    appointmentId,
    // From the VERIFIED token, both of them. A caller naming its own uid or
    // its own roles is the one thing this endpoint must never read.
    actorUserId: request.auth?.uid ?? null,
    actorRoles: callerRoles(request),
    command,
    acknowledgedOverlap: payload['acknowledgedOverlap'] === true,
    // The revision the sheet's draft was drawn from — a colleague's save
    // since is refused as `booking.staffEdit.stale`, and a re-send of an
    // intent that already landed is answered from the ledger first.
    expectedVersion: toExpectedVersion(payload['expectedVersion']),
    operationId,
  });

  if (result.isFailure()) throw toStaffHttpsError(result.error);
  const { appointmentId: editedId, revision } = result.value;

  // After the commit, never inside it — and awaited, so the row exists when
  // the caller hears "saved"; a failed write is logged by `appendAudit` and
  // never fails the edit. The command KIND rides in the context because
  // "who moved bookings" and "who discounted them" are different questions
  // asked of the same log, and a single `booking.staff_edited` row cannot
  // answer the second.
  //
  // A REPLAYED intent (the use case wrote nothing) is logged too, on
  // purpose: a change that committed must end with its rows, and the first
  // send's may be missing. Its revision is the one the first send stamped,
  // read back from the visit's ledger, so the row is the row the first send
  // would have written; its key is the same, so an existing row stays one.
  // Its people are read NOW, though: a person the intent removed is no
  // longer on the visit, so theirs is the one row a gap-fill cannot restore.
  await appendAudit({
    actor: callerActor(request),
    action: `booking.staff_${auditKind(command)}`,
    resourceId: editedId,
    subjects: staffEditSubjects(before.subjects, before.ownerUserId, command),
    atIso: new Date().toISOString(),
    context: { revision: String(revision) },
    // One per logical change: two intents are two rows, and one intent —
    // however often it is sent or logged — is one row per person.
    changeKey: staffEditChangeKey(operationId, revision),
  });
  return { appointmentId: editedId, revision };
});
