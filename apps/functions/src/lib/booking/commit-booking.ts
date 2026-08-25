import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { match } from '@creativo/domain/kernel';
import { FirestoreBookingStore } from '../../adapters/firestore-booking-store';
import { SystemClock } from '../../adapters/system-clock';
import { CryptoIdGenerator } from '../../adapters/crypto-id-generator';
import { adminFirestore } from '../firebase-admin';
import { loadBookingPolicy } from './load-booking-policy';
import { appendAudit } from './audit';
import type { CommitBookingError } from '../../use-cases/commit-booking.errors';
import { CommitBookingUseCase } from '../../use-cases/commit-booking.use-case';
import type { RequestedSeat } from '../../use-cases/decide-booking';
import type { BookingContactProps } from '@creativo/domain/scheduling';

/**
 * Domain failure → wire error.
 *
 * The `code` rides in `details` so the client can branch on it without parsing
 * a message: `slot_unavailable` sends the review step back to a fresh grid,
 * everything else is terminal. `aborted` is the honest gRPC status for a lost
 * race — it is what a failed transaction means, and it is retryable in a way
 * `failed-precondition` is not.
 */
export function toHttpsError(error: CommitBookingError): HttpsError {
  const details = { code: error.code, params: error.params };
  switch (error.code) {
    case 'booking.commit.unauthenticated':
      return new HttpsError('unauthenticated', error.message, details);
    case 'booking.commit.slot_unavailable':
      return new HttpsError('aborted', error.message, details);
    case 'booking.commit.barber_not_rostered':
    case 'booking.commit.too_soon':
    case 'booking.commit.beyond_horizon':
    case 'booking.commit.party_too_large':
    case 'booking.commit.conflicting_services':
    case 'booking.commit.service_not_at_location':
      return new HttpsError('failed-precondition', error.message, details);
    case 'booking.commit.unknown_service':
      return new HttpsError('not-found', error.message, details);
    case 'booking.commit.invalid_input':
    case 'booking.commit.invariant_violated':
      return new HttpsError('invalid-argument', error.message, details);
    default:
      return new HttpsError('internal', error.message, details);
  }
}

interface CommitBookingPayload {
  readonly locationId?: unknown;
  readonly seats?: unknown;
  readonly attemptId?: unknown;
  readonly contact?: unknown;
  readonly bookedFromAppointmentId?: unknown;
}

/**
 * The contact, read as primitives and bounded before it reaches the domain.
 *
 * Absent means absent — an old client that never sends the field must keep
 * booking, and `decideBooking` treats `undefined` as "no contact" rather than
 * as an empty one it would then refuse. The domain does the real validation
 * (a name, a parseable phone, an optional but valid email, a bounded note);
 * this only stops a caller from handing it a megabyte.
 */
function toContact(raw: unknown): BookingContactProps | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const contact = raw as Record<string, unknown>;
  const text = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.slice(0, max) : '';

  const name = text(contact['name'], 120);
  const phone = text(contact['phone'], 32);
  const email = text(contact['email'], 254);
  const note = text(contact['note'], 400);
  if (name.length === 0 && phone.length === 0) return undefined;

  return {
    name,
    phone,
    email: email.length > 0 ? email : null,
    note: note.length > 0 ? note : null,
  };
}

/**
 * The client's idempotency key, shape-checked because it becomes a DOC ID:
 * UUID-ish charset, bounded length. Anything else is dropped (the server
 * mints instead) rather than refused — an old client without the field must
 * keep booking.
 */
function toAttemptId(raw: unknown): string | undefined {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(raw)
    ? raw
    : undefined;
}

/**
 * The rebooking edge, bounded because it is stored.
 *
 * Same charset as an appointment id (which is what it points at) and dropped
 * rather than refused when it does not fit — a malformed analytics link must
 * never cost the client their booking.
 */
function toBookedFrom(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw)
    ? raw
    : null;
}

/**
 * Shape the payload without trusting it.
 *
 * Every field is re-read as a primitive and nothing is defaulted into
 * existence: a missing `barberId` must reach `decideBooking` as an empty
 * string it will refuse, not as `undefined` that some later `String()` turns
 * into `"undefined"` and looks up.
 */
export function toSeats(raw: unknown): readonly RequestedSeat[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry): RequestedSeat => {
    const seat = (entry ?? {}) as Record<string, unknown>;
    const subject = (seat['subject'] ?? {}) as Record<string, unknown>;
    return {
      lineId: String(seat['lineId'] ?? ''),
      serviceId: String(seat['serviceId'] ?? ''),
      variantId: seat['variantId'] == null ? null : String(seat['variantId']),
      barberId: String(seat['barberId'] ?? ''),
      startIso: String(seat['startIso'] ?? ''),
      subject:
        subject['kind'] === 'guest'
          ? { kind: 'guest', label: String(subject['label'] ?? '') }
          : { kind: 'self' },
    };
  });
}

/**
 * The booking write path. See `CommitBookingUseCase` for why this exists at
 * all rather than the browser writing the document itself.
 *
 * The owner is taken from `request.auth`, never from the payload — the one
 * fact a caller must not be able to choose.
 */
export const commitBooking = onCall(async (request) => {
  const db = adminFirestore();
  const useCase = new CommitBookingUseCase(
    new FirestoreBookingStore(db),
    new SystemClock(),
    new CryptoIdGenerator(),
    // The TENANT's numbers, not the hardcoded defaults — the same doc and
    // parser the client's calendar reads, so the horizon a visitor scrolls
    // and the horizon this re-check enforces cannot disagree.
    await loadBookingPolicy(db),
  );

  const payload = (request.data ?? {}) as CommitBookingPayload;
  const result = await useCase.execute({
    locationId: String(payload.locationId ?? ''),
    seats: toSeats(payload.seats),
    attemptId: toAttemptId(payload.attemptId),
    contact: toContact(payload.contact),
    bookedFromAppointmentId: toBookedFrom(payload.bookedFromAppointmentId),
    ownerUserId: request.auth?.uid ?? null,
  });

  return match(result, {
    success: ({ appointmentId }) => {
      // After the commit, never inside it — see `appendAudit`.
      void appendAudit({
        actorUserId: request.auth?.uid ?? '',
        action: 'booking.committed',
        resourceId: appointmentId,
        atIso: new Date().toISOString(),
        context: { locationId: String(payload.locationId ?? '') },
      });
      return { appointmentId };
    },
    failure: (error) => {
      throw toHttpsError(error);
    },
  });
});
