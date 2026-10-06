import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DocumentData,
  getDoc,
  getDocs,
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
  isSettled,
} from '@creativo/domain/scheduling';
import { UserId } from '@creativo/domain/accounts';
import { BarberId } from '@creativo/domain/catalog';
import {
  AppointmentRepository,
  appointmentFromDocument,
  appointmentToDocument,
  busyDocumentId,
} from '@creativo/application/booking';
import { RepositoryError } from '@creativo/application/shared';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { appointmentDocRef, appointmentsCollection } from './firestore-paths';
import { subscribeWithRetry } from './subscribe-with-retry';

/**
 * Document → `Appointment`, through THE shared reader.
 *
 * This adapter used to carry its own copy of the mapping, and the copy had
 * drifted: it dropped the seat pads, trusted a stored relationship
 * unchecked, and — the one that bit — handed a missing seat id straight to
 * the id factories, whose `trim()` then threw a TypeError out of the
 * snapshot callback. The listener never emitted again, so one legacy-shaped
 * booking left `/account` on a loading card that read as "no upcoming
 * appointments" and blanked the staff day it sat on. `appointmentFromDocument`
 * is what `commitBooking` and the stats trigger read with; every malformed
 * shape fails its `Result` instead of throwing.
 */
function toDomain(
  id: string,
  data: DocumentData,
): Result<Appointment, RepositoryError> {
  return appointmentFromDocument(id, data);
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
            if (!isSettled(result.value.status)) {
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
            if (started || isSettled(appointment.status)) {
              appointments.push(appointment);
            }
          }
          onNext(appointments);
        },
        onError,
      ),
    );
  }

  /**
   * One barber, one day, every status — the staff day sheet.
   *
   * A bare `array-contains` on the `busyKeys` mirror: single-field
   * auto-index, no composite, and the SAME key the busy projection is
   * rebuilt from. No status filter on purpose — the sheet shows the whole
   * day, cancelled rows included, greyed rather than hidden: a gap with no
   * explanation reads as a bug to the person working the chair. The
   * handful of docs sort client-side.
   */
  async searchWindow(
    nowIso: string,
    limitPerSide: number,
  ): Promise<Result<readonly Appointment[], RepositoryError>> {
    // Two halves, each a range + orderBy on the SAME field — so both ride the
    // single-field index Firestore maintains automatically and neither needs
    // a composite one. Ordering each half outward from now is what makes
    // `limit` cut the far edges instead of the middle.
    const past = query(
      appointmentsCollection(this.db),
      where('timeSlot.startIso', '<', nowIso),
      orderBy('timeSlot.startIso', 'desc'),
      limit(limitPerSide),
    );
    const upcoming = query(
      appointmentsCollection(this.db),
      where('timeSlot.startIso', '>=', nowIso),
      orderBy('timeSlot.startIso'),
      limit(limitPerSide),
    );

    try {
      const [pastSnap, upcomingSnap] = await Promise.all([
        getDocs(past),
        getDocs(upcoming),
      ]);
      const appointments: Appointment[] = [];
      for (const docSnap of [...pastSnap.docs, ...upcomingSnap.docs]) {
        const result = toDomain(docSnap.id, docSnap.data());
        // Same lenient posture as the day read: one unparseable document
        // must not empty a search that would otherwise have found someone.
        if (result.isSuccess()) appointments.push(result.value);
      }
      appointments.sort((a, b) =>
        a.timeSlot.start.isBefore(b.timeSlot.start) ? -1 : 1,
      );
      return ok(appointments);
    } catch (cause) {
      return fail(new RepositoryError('Could not search appointments', cause));
    }
  }

  observeBarberDay(
    barberId: BarberId,
    dayKey: string,
  ): Observable<Result<readonly Appointment[], RepositoryError>> {
    const dayQuery = query(
      appointmentsCollection(this.db),
      where(
        'busyKeys',
        'array-contains',
        busyDocumentId(barberId.value, dayKey),
      ),
    );

    return subscribeWithRetry<readonly Appointment[]>((onNext, onError) =>
      onSnapshot(
        dayQuery,
        (snapshot) => {
          const appointments: Appointment[] = [];
          for (const docSnap of snapshot.docs) {
            const result = toDomain(docSnap.id, docSnap.data());
            // Same lenient posture as history: one unparseable doc must not
            // blank the whole day.
            if (result.isSuccess()) appointments.push(result.value);
          }
          appointments.sort((a, b) =>
            a.timeSlot.start.isBefore(b.timeSlot.start) ? -1 : 1,
          );
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
