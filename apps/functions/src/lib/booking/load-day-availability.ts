import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { BarberId, LocationId, Service } from '@creativo/domain/catalog';
import {
  type BarberDayAvailability,
  CalendarDay,
  type ShopDayHours,
  buildDayWindows,
  paddedBusy,
  shopDayHours,
} from '@creativo/domain/scheduling';
import {
  type PersistedSlot,
  SCHEDULE_EXCEPTIONS_COLLECTION,
  busyIntervalsOf,
  exceptionFromDocument,
  scheduleExceptionDocId,
} from '@creativo/application/booking';
import {
  toSchedule,
  toService,
  toShop,
} from '../../adapters/firestore-booking-store';
import type { MatchWaitlistSnapshot } from '../../use-cases/match-waitlist';
import { shopListed } from '../../use-cases/party-admission';

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
 * ### The busy it returns is the grid's busy
 * Each barber's `busy` is `paddedBusy` of the stored spans and the roster's
 * turnaround — the port's busy contract (`availabilityReaderBusyCases`),
 * which this loader's spec runs, so the matcher sees the gaps the grid sees
 * and the commit accepts.
 *
 * ### Reuses the booking store's own parsers
 * `toService`/`toSchedule`/`toShop` are exported from there rather than
 * reimplemented here: a second parser is a second opinion about what an
 * inactive service, an unreadable roster or a hidden shop means, and the
 * matcher has to agree with the committer exactly or it will promise things
 * the commit then refuses.
 *
 * ### A day with nothing to search is EMPTY, never `null`
 * No listed shop, no active service, nobody rostered: each is an answer
 * about the day, "nothing fits here", and the snapshot says so with no
 * barbers in it. It is not a day that "cannot be evaluated". The trigger
 * reads each watching request's lapse only after this load, so a `null`
 * here also skipped that bookkeeping. On a one-shop tenant whose shop is
 * hidden, that happened on every day, and the requests stayed `open` after
 * their last day had passed.
 *
 * Fail-closed throughout: an unreadable roster reads as "nobody works",
 * never as "everybody is free".
 */
export async function loadDayAvailability(
  db: Firestore,
  day: CalendarDay,
  zone: string,
): Promise<MatchWaitlistSnapshot> {
  // Filtered at the QUERY, not post-read: this loader fires on every watched
  // busy write, and unfiltered collection scans billed every archived barber
  // and retired service on every fire — documents whose only fate was to be
  // discarded three lines later.
  const [locationSnap, barberSnap, serviceSnap] = await Promise.all([
    db.collection('locations').where('status', '==', 'active').get(),
    db.collection('barbers').where('status', '==', 'active').get(),
    db.collection('services').where('status', '==', 'active').get(),
  ]);

  const services: Service[] = [];
  for (const doc of serviceSnap.docs) {
    const service = toService(doc.id, doc.data() as DocumentData);
    if (service) services.push(service);
  }
  /** Nobody to search: nothing fits, and the trigger still reads lapses. */
  const emptyDay: MatchWaitlistSnapshot = { zone, services, barbers: [] };
  if (services.length === 0) return emptyDay;

  // The shop envelope every roster window is clamped to, materialised once for
  // this day and shared by every barber below. Each shop is read the way the
  // commit reads it (`toShop`) and judged by the rule the waitlist's door
  // refuses a hidden shop by (`shopListed`). The query only narrows what is
  // billed; the rule decides which shops are searched at all.
  const shopHours = new Map<string, ShopDayHours | null>();
  for (const doc of locationSnap.docs) {
    const shop = toShop(doc.data());
    if (!shopListed(shop)) continue;
    const locationId = LocationId.create(doc.id);
    if (locationId.isFailure()) continue;
    shopHours.set(doc.id, shopDayHours(day, locationId.value, shop.hours));
  }
  if (shopHours.size === 0) return emptyDay;

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
  if (candidates.length === 0) return emptyDay;

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
    /** The barber's reset time, from the same roster document. */
    readonly turnaroundMinutes: number;
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

    // Only windows at a shop the searched set holds. `buildDayWindows` reads a
    // shop absent from `shopHours` as one that "publishes no bound", which is
    // right for a shop that never authored hours and wrong for one hidden
    // since (or a roster typo): its chair would be searched UNCLAMPED, and a
    // request naming that shop — or "any shop" — told of a slot at a shop
    // `/book` does not list. Dropped here, as the capacity plan drops them
    // (`planBarberCapacity`), so a request naming a hidden shop simply finds
    // nothing and stays open until the shop is back or its days lapse.
    const windows = buildDayWindows({
      day,
      schedule: schedule.history,
      exceptions: exception ? [exception] : [],
      shopHours,
    }).filter((window) => shopHours.has(window.locationId.value));
    // Not rostered today — not a candidate, and not a barber with an empty
    // day that the engine would happily place nothing into.
    if (windows.length === 0) continue;
    rostered.push({
      id: candidate.id,
      barberId: candidate.barberId,
      windows,
      turnaroundMinutes: schedule.turnaroundMinutes,
    });
  }
  if (rostered.length === 0) return emptyDay;

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
      // PADDED by the barber's turnaround — `paddedBusy`, the one rule the
      // grid's reader and `decideBooking` both apply. The engine has no
      // turnaround of its own, so raw spans here offered the reset minutes
      // after every visit as free, and the notification named a start the
      // commit refuses as `slot_unavailable`. Nothing is released: a
      // waitlist request is a new booking, not a move.
      busy: paddedBusy({
        barberId: entry.barberId,
        spans: busyIntervalsOf(slots, zone),
        turnaroundMinutes: entry.turnaroundMinutes,
      }),
    };
  });

  return { zone, services, barbers };
}
