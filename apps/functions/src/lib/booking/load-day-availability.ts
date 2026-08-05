import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import {
  BarberId,
  type LocationDayHours,
  LocationId,
  Service,
} from '@creativo/domain/catalog';
import {
  type BarberDayAvailability,
  CalendarDay,
  type ShopDayHours,
  buildDayWindows,
  shopDayHours,
} from '@creativo/domain/scheduling';
import {
  type PersistedSlot,
  SCHEDULE_EXCEPTIONS_COLLECTION,
  busyIntervalsOf,
  exceptionFromDocument,
  scheduleExceptionDocId,
} from '@creativo/application/booking';
import { toSchedule, toService } from '../../adapters/firestore-booking-store';
import type { MatchWaitlistSnapshot } from '../../use-cases/match-waitlist';

/**
 * Everything the engine needs to answer "what fits on this day?", loaded once.
 *
 * ### Not a transaction, deliberately
 * `FirestoreBookingStore.load` reads inside `runTransaction` because its
 * answer becomes a WRITE that must not race. This read becomes a
 * notification — an invitation to come and try for a slot, holding nothing —
 * so a stale read costs at most one message about a time that has since gone,
 * which the copy already warns about. Paying transaction contention on every
 * write to every barber's day, to protect a promise nobody made, would be the
 * expensive kind of correct.
 *
 * ### Reuses the booking store's own parsers
 * `toService`/`toSchedule` are exported from there rather than reimplemented
 * here: a second parser is a second opinion about what an inactive service or
 * an unreadable roster means, and the matcher has to agree with the committer
 * exactly or it will promise things the commit then refuses.
 *
 * Returns `null` when the day cannot be evaluated at all. Fail-closed
 * throughout: an unreadable roster reads as "nobody works", never as
 * "everybody is free".
 */
export async function loadDayAvailability(
  db: Firestore,
  day: CalendarDay,
  zone: string,
): Promise<MatchWaitlistSnapshot | null> {
  // Filtered at the QUERY, not post-read: this loader fires on every watched
  // busy write, and unfiltered collection scans billed every archived barber
  // and retired service on every fire — documents whose only fate was to be
  // discarded three lines later.
  const [locationSnap, barberSnap, serviceSnap] = await Promise.all([
    db.collection('locations').where('status', '==', 'active').get(),
    db.collection('barbers').where('status', '==', 'active').get(),
    db.collection('services').where('status', '==', 'active').get(),
  ]);

  // The shop envelope every roster window is clamped to, materialised once for
  // this day and shared by every barber below.
  const shopHours = new Map<string, ShopDayHours | null>();
  for (const doc of locationSnap.docs) {
    const locationId = LocationId.create(doc.id);
    if (locationId.isFailure()) continue;
    const hours = (doc.data()['hours'] ?? []) as readonly LocationDayHours[];
    shopHours.set(doc.id, shopDayHours(day, locationId.value, hours));
  }
  if (shopHours.size === 0) return null;

  const services: Service[] = [];
  for (const doc of serviceSnap.docs) {
    const service = toService(doc.id, doc.data() as DocumentData);
    if (service) services.push(service);
  }
  if (services.length === 0) return null;

  // Two batched phases instead of two awaited round trips PER BARBER: all
  // rosters in one `getAll`, windows computed locally, then one `getAll` of
  // busy docs for only the barbers actually rostered today. Same documents
  // billed, a fraction of the wall clock — this runs on a trigger that a
  // busy afternoon fires constantly.
  const candidates = barberSnap.docs.flatMap((doc) => {
    const barberId = BarberId.create(doc.id);
    return barberId.isFailure()
      ? []
      : [{ id: doc.id, barberId: barberId.value }];
  });
  if (candidates.length === 0) return null;

  // Rosters AND published exceptions in one round trip — an exception can
  // close the day, so it has to be known BEFORE windows are built.
  const scheduleSnaps = await db.getAll(
    ...candidates.map((candidate) =>
      db.collection('barberSchedules').doc(candidate.id),
    ),
    ...candidates.map((candidate) =>
      db
        .collection(SCHEDULE_EXCEPTIONS_COLLECTION)
        .doc(scheduleExceptionDocId(candidate.id, day.key())),
    ),
  );

  const rostered: {
    readonly id: string;
    readonly barberId: BarberId;
    readonly windows: BarberDayAvailability['windows'];
  }[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const scheduleData = scheduleSnaps[index]?.data();
    if (!scheduleData) continue;

    const schedule = toSchedule(scheduleData as DocumentData, zone);
    if (!schedule) continue;

    const exceptionData = scheduleSnaps[candidates.length + index]?.data();
    const exception = exceptionData
      ? exceptionFromDocument(exceptionData)
      : null;

    const windows = buildDayWindows({
      day,
      schedule: schedule.history,
      exceptions: exception ? [exception] : [],
      shopHours,
    });
    // Not rostered today — not a candidate, and not a barber with an empty
    // day that the engine would happily place nothing into.
    if (windows.length === 0) continue;
    rostered.push({ id: candidate.id, barberId: candidate.barberId, windows });
  }
  if (rostered.length === 0) return null;

  const busySnaps = await db.getAll(
    ...rostered.map((entry) =>
      db.collection('barberBusy').doc(`${entry.id}__${day.key()}`),
    ),
  );

  const barbers: BarberDayAvailability[] = rostered.map((entry, index) => {
    const slots = (busySnaps[index]?.data()?.['busy'] ??
      []) as readonly PersistedSlot[];
    return {
      barberId: entry.barberId,
      windows: entry.windows,
      busy: busyIntervalsOf(slots, zone),
    };
  });

  return { zone, services, barbers };
}
