import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DocumentData,
  getDoc,
  onSnapshot,
  orderBy,
  query,
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
import {
  BarberId,
  ServiceId,
  ServiceTerms,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import { Money } from '@creativo/domain/kernel';
import {
  AppointmentRepository,
  appointmentToDocument,
} from '@creativo/application/booking';
import { RepositoryError } from '@creativo/application/shared';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { appointmentDocRef, appointmentsCollection } from './firestore-paths';
import { subscribeWithRetry } from './subscribe-with-retry';

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

    const barberIdResult = BarberId.create(entry['barberId']);
    if (barberIdResult.isFailure()) {
      return fail(
        new RepositoryError(
          'Malformed appointment seat barberId',
          barberIdResult.error,
        ),
      );
    }

    let variantId: ServiceVariantId | null = null;
    if (entry['variantId'] != null) {
      const variantIdResult = ServiceVariantId.create(entry['variantId']);
      if (variantIdResult.isFailure()) {
        return fail(
          new RepositoryError(
            'Malformed appointment seat variantId',
            variantIdResult.error,
          ),
        );
      }
      variantId = variantIdResult.value;
    }

    const termsData = entry['terms'] as DocumentData | undefined;
    const priceResult = Money.fromMinorUnitsAndCode(
      termsData?.['priceMinorUnits'],
      termsData?.['currencyCode'],
    );
    if (priceResult.isFailure()) {
      return fail(
        new RepositoryError(
          'Malformed appointment seat price',
          priceResult.error,
        ),
      );
    }
    const termsResult = ServiceTerms.create(
      priceResult.value,
      termsData?.['durationMinutes'],
    );
    if (termsResult.isFailure()) {
      return fail(
        new RepositoryError(
          'Malformed appointment seat terms',
          termsResult.error,
        ),
      );
    }

    const slotData = entry['slot'] as DocumentData | undefined;
    const slotResult = TimeSlot.create({
      startIso: slotData?.['startIso'],
      endIso: slotData?.['endIso'],
      zone: slotData?.['zone'],
    });
    if (slotResult.isFailure()) {
      return fail(
        new RepositoryError(
          'Malformed appointment seat slot',
          slotResult.error,
        ),
      );
    }

    seats.push(
      Seat.of({
        id: seatIdResult.value,
        subject,
        serviceId: serviceIdResult.value,
        variantId,
        barberId: barberIdResult.value,
        terms: termsResult.value,
        // Only the START is read back: the seat derives its end from the
        // snapshotted duration, so a persisted end that disagreed with the
        // terms can never become the answer.
        startsAt: slotResult.value.start,
      }),
    );
  }
  return ok(seats);
}

function toDomain(
  id: string,
  data: DocumentData,
): Result<Appointment, RepositoryError> {
  // The stored `timeSlot`/`barberIds` are deliberately NOT read back: they
  // are write-time mirrors for querying, and `Appointment` derives both
  // from the seats. Reading them would create a second, drift-prone answer
  // to "when is this, and who is working it".
  const seatsResult = buildSeats(data['seats']);
  if (seatsResult.isFailure()) {
    return fail(seatsResult.error);
  }

  const reconstituted = Appointment.reconstitute({
    id,
    locationId: data['locationId'],
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

  /**
   * **Refused on the client, by design.**
   *
   * A booking cannot be committed from a browser: availability has to be
   * re-checked and the write has to be transactional against the barber-day
   * projection, and neither is expressible in security rules. This used to be
   * a bare `setDoc`, which — together with a `create` rule that only checked
   * `ownerUserId` — let any signed-in user write an appointment naming any
   * barber, any time and any price over anyone else's booking.
   *
   * The port keeps `save` because the SAME `CreateBookingUseCase` runs inside
   * the `commitBooking` Cloud Function against an Admin-SDK repository that
   * does implement it. This adapter is the browser half, and the browser half
   * has no business writing appointments.
   */
  async save(): Promise<Result<void, RepositoryError>> {
    return fail(
      new RepositoryError(
        'Appointments are committed server-side — call the commitBooking gateway, not the repository',
      ),
    );
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

/**
 * Re-exported so this adapter's own spec — and any staff surface that has to
 * name the persisted shape — keeps one import site. The mapping itself lives
 * in `@creativo/application/booking`, because `commitBooking` (Admin SDK)
 * writes the same document and cannot import anything from this lib.
 */
export { appointmentToDocument };
