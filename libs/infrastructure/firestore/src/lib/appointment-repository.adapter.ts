import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DocumentData,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  Appointment,
  AppointmentId,
  Seat,
  SeatId,
  SeatLabel,
  SeatSubject,
  TimeSlot,
  isTerminal,
} from '@creativo/domain/scheduling';
import { UserId } from '@creativo/domain/accounts';
import { ServiceId } from '@creativo/domain/catalog';
import { AppointmentRepository } from '@creativo/application/booking';
import { RepositoryError } from '@creativo/application/shared';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { appointmentDocRef, appointmentsCollection } from './firestore-paths';
import { subscribeWithRetry } from './subscribe-with-retry';

/**
 * `ownerUserId` is a DENORMALIZED field written only by this adapter's
 * `toPersistence` — it is not part of the `Appointment` domain aggregate.
 * It mirrors the `UserId` of the seat whose `subject.kind === 'account' &&
 * relationship === 'self'` (or `null` when the appointment has no such
 * seat — a fully staff-booked walk-in/companion-only party). `firestore.rules`
 * and `observeUpcomingFor` both key off this field; see
 * `docs/architecture/domain-deviations.md`.
 */
function computeOwnerUserId(appointment: Appointment): string | null {
  const selfSeat = appointment.seats.find(
    (seat) =>
      seat.subject.kind === 'account' && seat.subject.relationship === 'self',
  );
  if (selfSeat === undefined || selfSeat.subject.kind !== 'account') {
    return null;
  }
  return selfSeat.subject.userId.value;
}

function toPersistence(appointment: Appointment): DocumentData {
  return {
    barberId: appointment.barberId.value,
    locationId: appointment.locationId.value,
    ownerUserId: computeOwnerUserId(appointment),
    timeSlot: {
      startIso: appointment.timeSlot.start.toISO(),
      endIso: appointment.timeSlot.end.toISO(),
      zone: appointment.timeSlot.start.zoneName,
    },
    seats: appointment.seats.map((seat) => ({
      id: seat.id.value,
      serviceId: seat.serviceId.value,
      subject:
        seat.subject.kind === 'account'
          ? {
              kind: 'account' as const,
              userId: seat.subject.userId.value,
              relationship: seat.subject.relationship,
            }
          : { kind: 'anonymous' as const, label: seat.subject.label.value },
    })),
    status: appointment.status,
  };
}

function buildSeats(raw: unknown): Result<Seat[], RepositoryError> {
  if (!Array.isArray(raw)) {
    return fail(
      new RepositoryError(
        'Malformed appointment document: seats is not an array',
      ),
    );
  }
  const seats: Seat[] = [];
  for (const entry of raw as DocumentData[]) {
    const seatIdResult = SeatId.create(entry['id']);
    const serviceIdResult = ServiceId.create(entry['serviceId']);
    if (seatIdResult.isFailure()) {
      return fail(
        new RepositoryError(
          'Malformed appointment seat id',
          seatIdResult.error,
        ),
      );
    }
    if (serviceIdResult.isFailure()) {
      return fail(
        new RepositoryError(
          'Malformed appointment seat serviceId',
          serviceIdResult.error,
        ),
      );
    }

    const subjectData = entry['subject'] as DocumentData;
    let subject: SeatSubject;
    if (subjectData['kind'] === 'account') {
      const userIdResult = UserId.create(subjectData['userId']);
      if (userIdResult.isFailure()) {
        return fail(
          new RepositoryError(
            'Malformed appointment seat subject userId',
            userIdResult.error,
          ),
        );
      }
      subject = SeatSubject.account(
        userIdResult.value,
        subjectData['relationship'],
      );
    } else {
      const labelResult = SeatLabel.create(subjectData['label']);
      if (labelResult.isFailure()) {
        return fail(
          new RepositoryError(
            'Malformed appointment seat label',
            labelResult.error,
          ),
        );
      }
      subject = SeatSubject.anonymous(labelResult.value);
    }

    seats.push(
      Seat.of({
        id: seatIdResult.value,
        subject,
        serviceId: serviceIdResult.value,
      }),
    );
  }
  return ok(seats);
}

function toDomain(
  id: string,
  data: DocumentData,
): Result<Appointment, RepositoryError> {
  const timeSlotData = data['timeSlot'] as DocumentData;
  const timeSlotResult = TimeSlot.create({
    startIso: timeSlotData['startIso'],
    endIso: timeSlotData['endIso'],
    zone: timeSlotData['zone'],
  });
  if (timeSlotResult.isFailure()) {
    return fail(
      new RepositoryError(
        'Malformed appointment timeSlot',
        timeSlotResult.error,
      ),
    );
  }

  const seatsResult = buildSeats(data['seats']);
  if (seatsResult.isFailure()) {
    return fail(seatsResult.error);
  }

  const reconstituted = Appointment.reconstitute({
    id,
    barberId: data['barberId'],
    locationId: data['locationId'],
    timeSlot: timeSlotResult.value,
    seats: seatsResult.value,
    status: data['status'],
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError(
        'Malformed appointment document',
        reconstituted.error,
      ),
    );
  }
  return ok(reconstituted.value);
}

@Injectable()
export class FirestoreAppointmentRepository implements AppointmentRepository {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async findById(
    id: AppointmentId,
  ): Promise<Result<Appointment | null, RepositoryError>> {
    try {
      const snapshot = await getDoc(appointmentDocRef(this.db, id));
      if (!snapshot.exists()) {
        return ok(null);
      }
      return toDomain(snapshot.id, snapshot.data());
    } catch (error) {
      return fail(new RepositoryError('Failed to fetch appointment', error));
    }
  }

  async save(appointment: Appointment): Promise<Result<void, RepositoryError>> {
    try {
      await setDoc(
        appointmentDocRef(this.db, appointment.id),
        toPersistence(appointment),
      );
      return ok(undefined);
    } catch (error) {
      return fail(new RepositoryError('Failed to save appointment', error));
    }
  }

  /**
   * "Upcoming" = every appointment where this user holds the `self` seat,
   * filtered to non-terminal statuses (`pending`/`confirmed`) client-side —
   * simpler than a second range filter on `timeSlot.startIso`, and correct
   * for the dashboard's purpose (a past `confirmed` appointment that never
   * got marked `completed` is a staff data-hygiene issue, not something to
   * hide from the query).
   */
  observeUpcomingFor(
    userId: UserId,
  ): Observable<Result<readonly Appointment[], RepositoryError>> {
    const upcomingQuery = query(
      appointmentsCollection(this.db),
      where('ownerUserId', '==', userId.value),
      orderBy('timeSlot.startIso'),
    );

    return subscribeWithRetry<readonly Appointment[]>((onNext, onError) =>
      onSnapshot(
        upcomingQuery,
        (snapshot) => {
          const appointments: Appointment[] = [];
          for (const docSnap of snapshot.docs) {
            const result = toDomain(docSnap.id, docSnap.data());
            if (result.isFailure()) {
              onError(result.error);
              return;
            }
            if (!isTerminal(result.value.status)) {
              appointments.push(result.value);
            }
          }
          onNext(appointments);
        },
        onError,
      ),
    );
  }
}
