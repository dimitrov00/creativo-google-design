import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DocumentData,
  getDoc,
  limit,
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
  contactFromDocument,
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
    // Best-effort: a contact that does not parse reads as absent rather than
    // failing the appointment (see `contactFromDocument`).
    contact: contactFromDocument(data),
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
   * "Upcoming" = every appointment where this user holds the `self` seat and
   * the status is non-terminal — the SAME set the old client-side filter
   * kept, now filtered in the QUERY. The difference is not semantics but
   * billing: appointments are never deleted, so `ownerUserId ==` alone read
   * a user's entire lifetime history on every mount — every cancelled cut
   * since their first visit — then threw most of it away in the browser.
   * O(lifetime) became O(open bookings). Deliberately still no date bound: a
   * past `pending`/`confirmed` that never got closed out is a staff
   * data-hygiene issue, not something to hide (see the product note in the
   * repo history), and non-terminal docs number a handful by construction.
   *
   * Needs the `(ownerUserId, status.kind, timeSlot.startIso)` composite.
   */
  observeUpcomingFor(
    userId: UserId,
  ): Observable<Result<readonly Appointment[], RepositoryError>> {
    const upcomingQuery = query(
      appointmentsCollection(this.db),
      where('ownerUserId', '==', userId.value),
      where('status.kind', 'in', ['pending', 'confirmed']),
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

  /**
   * History — the newest `limit` visits that are NOT upcoming.
   *
   * One query, ordered newest-first and capped, then split in the browser:
   * a visit belongs to history if it has already started OR it reached a
   * terminal status. Firestore cannot express that OR server-side without
   * two queries, and two queries over the same bounded window costs more
   * than filtering the window once.
   *
   * The cap is the point. Appointments are never deleted, so an unbounded
   * `ownerUserId ==` reads a client's entire lifetime on every mount — the
   * exact bill the upcoming query was rewritten to stop paying.
   *
   * Needs the `(ownerUserId, timeSlot.startIso DESC)` composite: the
   * three-field upcoming index cannot serve this one, because `status.kind`
   * sits between the equality and the ordering.
   */
  observeHistoryFor(
    userId: UserId,
    max: number,
  ): Observable<Result<readonly Appointment[], RepositoryError>> {
    const historyQuery = query(
      appointmentsCollection(this.db),
      where('ownerUserId', '==', userId.value),
      orderBy('timeSlot.startIso', 'desc'),
      limit(max),
    );

    return subscribeWithRetry<readonly Appointment[]>((onNext, onError) =>
      onSnapshot(
        historyQuery,
        (snapshot) => {
          const nowIso = new Date().toISOString();
          const appointments: Appointment[] = [];
          for (const docSnap of snapshot.docs) {
            const result = toDomain(docSnap.id, docSnap.data());
            // ONE unparseable document must not cost the whole history —
            // unlike the upcoming list, where a booking you cannot see is a
            // booking you cannot cancel, a past visit that fails to parse is
            // simply dropped from the record.
            if (result.isFailure()) continue;
            const appointment = result.value;
            const started = appointment.timeSlot.start.toISO() <= nowIso;
            if (started || isTerminal(appointment.status)) {
              appointments.push(appointment);
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
