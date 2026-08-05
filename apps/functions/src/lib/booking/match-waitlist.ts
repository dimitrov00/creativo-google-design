import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { Notification } from '@creativo/domain/notifications';
import {
  BookingPolicy,
  CalendarDay,
  Interval,
  type WaitlistRequest,
} from '@creativo/domain/scheduling';
import { FirestoreNotificationWriter } from '../../adapters/firestore-notification-writer';
import { FirestoreWaitlistStore } from '../../adapters/firestore-waitlist-store';
import { CryptoIdGenerator } from '../../adapters/crypto-id-generator';
import { SystemClock } from '../../adapters/system-clock';
import { adminFirestore } from '../firebase-admin';
import { loadBookingPolicy } from './load-booking-policy';
import { loadDayAvailability } from './load-day-availability';
import { matchWaitlist } from '../../use-cases/match-waitlist';

/**
 * How long a notification suppresses the next one for the same request.
 *
 * The trigger fires on every write to a barber's day and a busy shop writes
 * many, so without a floor one afternoon of rescheduling would send the same
 * person a dozen identical messages — the fastest way to make someone turn the
 * feature off entirely.
 */
const NOTIFY_COOLDOWN_HOURS = 6;

/**
 * Watch the public busy projection; when a day frees up, tell whoever asked.
 *
 * ### Why THIS document
 * `barberBusy/{barberId}__{dayKey}` is the one artefact that changes when a
 * day's availability changes — a booking made through the commit
 * transaction, a booking cancelled (the `rebuildBusy` trigger recomputes the
 * projection from the surviving appointments, which is what lands the write
 * this function wakes on), a shift edited. Triggering on `appointments`
 * instead would miss everything that is not an appointment, and polling
 * would be a scheduled job that is wrong most of the time by construction.
 *
 * ### It fires on bookings too, and that is fine
 * Most writes here REMOVE availability rather than adding it, and those simply
 * find no match — the engine runs, returns nothing, and the function exits.
 * Detecting "did this write free something?" up front would mean diffing two
 * busy arrays and reasoning about which intervals shrank, which is a second,
 * subtler copy of the question `matchWaitlist` already answers exactly.
 *
 * ### The notification is an invitation, not a hold
 * Nothing is reserved. The slot it names can be taken by someone else in the
 * seconds after it is written, and `commitBooking` is still the only authority
 * — so the copy says "something opened up", and the deep link lands the
 * recipient back in a live search rather than on a pre-filled confirmation.
 * Holding the slot instead is the design record's Phase 7 (`SlotHold`), which
 * is a different promise and needs an expiry sweeper to keep it.
 */
export const matchWaitlistOnBusyChange = onDocumentWritten(
  'barberBusy/{docId}',
  async (event) => {
    // DELETION is a day freeing too — the STRONGEST freeing there is. The
    // rebuild trigger deletes a busy doc whose last appointment cancelled,
    // and an early `!after.exists` return here skipped exactly that event:
    // the person watching a fully-freed day was the one who never heard.
    // (Caught live by the E2E journey, not by review.) The day and zone
    // read the same off either side of the write.
    const data = event.data?.after?.data() ?? event.data?.before?.data() ?? {};
    const dayKey = String(data['dayKey'] ?? '');
    const zone = String(data['zone'] ?? 'Europe/Sofia');
    if (dayKey.length === 0) return;

    const db = adminFirestore();
    const store = new FirestoreWaitlistStore(db);
    const notifications = new FirestoreNotificationWriter(db);
    const policy = await loadBookingPolicy(db);

    const nowResult = new SystemClock().now(zone);
    if (nowResult.isFailure()) return;
    const now = nowResult.value;

    const day = CalendarDay.create(dayKey, zone);
    if (day.isFailure()) return;

    const watching = await store.openForDay(dayKey);
    if (watching.length === 0) return;

    // Loaded ONCE for the day and shared across every request that named it:
    // ten people waiting on the same Saturday is one read of the roster, not
    // ten. The engine is pure, so the same snapshot answers all of them.
    const snapshot = await loadDayAvailability(db, day.value, zone);
    if (!snapshot) return;

    const since = ZonedDateTime.fromMillis(
      now.toMillis() - NOTIFY_COOLDOWN_HOURS * 3_600_000,
      zone,
    );

    for (const request of watching) {
      try {
        await notifyIfMatched({
          request,
          day: day.value,
          snapshot,
          now,
          since: since.isSuccess() ? since.value : now,
          policy,
          store,
          notifications,
        });
      } catch (error) {
        // One request's failure must not cost the others their notification —
        // they are independent promises to different people.
        logger.error('waitlist match failed', {
          requestId: request.id.value,
          error: String(error),
        });
      }
    }
  },
);

async function notifyIfMatched(input: {
  readonly request: WaitlistRequest;
  readonly day: CalendarDay;
  readonly snapshot: Awaited<ReturnType<typeof loadDayAvailability>>;
  readonly now: ZonedDateTime;
  readonly since: ZonedDateTime;
  readonly policy: BookingPolicy;
  readonly store: FirestoreWaitlistStore;
  readonly notifications: FirestoreNotificationWriter;
}): Promise<void> {
  const { request, day, snapshot, now, since, policy, store, notifications } =
    input;
  if (!snapshot) return;

  // A request whose days have all passed stops being watched rather than being
  // re-evaluated forever.
  if (request.hasLapsedBy(CalendarDay.fromZonedDateTime(now))) {
    const expired = request.markExpired();
    if (expired.isSuccess()) await store.updateStatus(expired.value, 'expired');
    return;
  }

  const found = matchWaitlist(request, day, snapshot, { now, policy });
  if (!found) return;

  const ownerId = request.ownerId.value;
  if (await notifications.hasRecentFor(ownerId, request.id.value, since)) {
    return;
  }

  const startsAt = ZonedDateTime.fromMillis(found.startMs, snapshot.zone);
  if (startsAt.isFailure()) return;

  // Authored per recipient rather than translated at render: `Notification`
  // holds display text, and the server is where the recipient's locale would
  // be resolved once one is stored on their profile. Bulgarian is the
  // tenant's language today, so it is the honest default rather than an
  // English string nobody in the shop reads.
  const when = new Intl.DateTimeFormat('bg-BG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: snapshot.zone,
  }).format(new Date(found.startMs));

  const notification = Notification.create({
    id: new CryptoIdGenerator().next(),
    kind: 'waitlist_match',
    title: 'Освободи се час',
    body: `${when} — свободно е за твоята заявка. Часът не е запазен, побързай.`,
    sentAt: now,
    readAt: null,
    // Lands in a LIVE search rather than on a pre-filled confirmation: nothing
    // is held, so the slot this names may already be gone.
    deepLink: `/book?waitlist=${request.id.value}&day=${day.key()}`,
  });
  if (notification.isFailure()) return;

  // ONE atomic batch: the notification and the `matched` transition land
  // together or not at all. The earlier two-write ordering could mark a
  // request matched whose notification never arrived — a person told
  // nothing who silently stopped being watched — or the inverse, which the
  // cooldown had to absorb as a duplicate.
  const matched = request.markMatched();
  if (matched.isFailure()) return;

  const db = adminFirestore();
  const batch = db.batch();
  notifications.deliverInto(batch, ownerId, notification.value, {
    requestId: request.id.value,
    dayKey: day.key(),
  });
  store.updateStatusInto(batch, matched.value, 'matched');
  await batch.commit();
}

/** Re-exported so the interval type stays reachable from this module's tests. */
export type { Interval };
