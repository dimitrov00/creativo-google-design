import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { match } from '@creativo/domain/kernel';
import { FirestoreBookingStore } from '../../adapters/firestore-booking-store';
import { SystemClock } from '../../adapters/system-clock';
import { CryptoIdGenerator } from '../../adapters/crypto-id-generator';
import { adminFirestore } from '../firebase-admin';
import type { CommitBookingError } from '../../use-cases/commit-booking.errors';
import { CommitBookingUseCase } from '../../use-cases/commit-booking.use-case';
import type { RequestedSeat } from '../../use-cases/decide-booking';

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
}

/**
 * Shape the payload without trusting it.
 *
 * Every field is re-read as a primitive and nothing is defaulted into
 * existence: a missing `barberId` must reach `decideBooking` as an empty
 * string it will refuse, not as `undefined` that some later `String()` turns
 * into `"undefined"` and looks up.
 */
function toSeats(raw: unknown): readonly RequestedSeat[] {
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
  const useCase = new CommitBookingUseCase(
    new FirestoreBookingStore(adminFirestore()),
    new SystemClock(),
    new CryptoIdGenerator(),
  );

  const payload = (request.data ?? {}) as CommitBookingPayload;
  const result = await useCase.execute({
    locationId: String(payload.locationId ?? ''),
    seats: toSeats(payload.seats),
    ownerUserId: request.auth?.uid ?? null,
  });

  return match(result, {
    success: (appointment) => ({ appointmentId: appointment.id.value }),
    failure: (error) => {
      throw toHttpsError(error);
    },
  });
});
