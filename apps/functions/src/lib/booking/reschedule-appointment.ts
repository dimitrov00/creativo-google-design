import { onCall } from 'firebase-functions/v2/https';
import { match } from '@creativo/domain/kernel';
import { FirestoreBookingStore } from '../../adapters/firestore-booking-store';
import { SystemClock } from '../../adapters/system-clock';
import { adminFirestore } from '../firebase-admin';
import { loadBookingPolicy } from './load-booking-policy';
import { RescheduleBookingUseCase } from '../../use-cases/reschedule-booking.use-case';
import { toHttpsError, toSeats } from './commit-booking';
import { appendAudit } from './audit';

/**
 * The move write path — a callable, like every other appointment write, and
 * for the same reason: the browser must not write appointments.
 *
 * Payload shaping is the commit path's, verbatim (`toSeats`), because a
 * reschedule IS a commit of the same cart at a different time. The owner
 * comes from `request.auth`; the appointment id is the one fact the caller
 * supplies that the server then checks ownership of.
 */
export const rescheduleAppointment = onCall(async (request) => {
  const db = adminFirestore();
  const useCase = new RescheduleBookingUseCase(
    new FirestoreBookingStore(db),
    new SystemClock(),
    await loadBookingPolicy(db),
  );

  const payload = (request.data ?? {}) as Record<string, unknown>;
  const result = await useCase.execute({
    appointmentId: String(payload['appointmentId'] ?? ''),
    locationId: String(payload['locationId'] ?? ''),
    seats: toSeats(payload['seats']),
    ownerUserId: request.auth?.uid ?? null,
  });

  return match(result, {
    success: ({ appointmentId }) => {
      void appendAudit({
        actorUserId: request.auth?.uid ?? '',
        action: 'booking.rescheduled',
        resourceId: appointmentId,
        atIso: new Date().toISOString(),
      });
      return { appointmentId };
    },
    failure: (error) => {
      throw toHttpsError(error);
    },
  });
});
