import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { type LocationDayHours } from '@creativo/domain/catalog';
import { CalendarDay } from '@creativo/domain/scheduling';
import {
  CAPACITY_COLLECTION,
  type CapacityContribution,
  type PersistedSlot,
  SCHEDULE_EXCEPTIONS_COLLECTION,
  exceptionFromDocument,
} from '@creativo/application/booking';
import { toSchedule } from '../../adapters/firestore-booking-store';
import { adminFirestore } from '../firebase-admin';
import {
  dayKeysBetween,
  horizonSpanEndKey,
  planBarberCapacity,
} from './capacity-plan';
import { loadBookingPolicy } from './load-booking-policy';

/**
 * Keep `capacity/{YYYY-MM}` equal to what the geometry says.
 *
 * ### Why the calendar reads THIS and not the geometry
 * A cold calendar mount used to pay `barbers × occupied days` document reads
 * (~75–130 at three barbers, ~920 at ten — past the daily free tier on its
 * own). The rollup makes that 2–3 month-doc listeners, flat in headcount.
 * See `capacity-document.ts` for the shape and read semantics.
 *
 * ### Six ways an entry gets (re)computed — all converging on one function
 * - a `barberBusy` write → that one (barber, day);
 * - a `scheduleExceptions` write → that one (barber, day);
 * - a `barberSchedules` write → that barber's whole horizon, because a
 *   roster is what puts bookings-free days on the map at all;
 * - a `locations` write → every barber's horizon (hours clamp every window);
 * - a `settings` write → every barber's horizon (the policy IS the horizon);
 * - the daily sweep → every barber's horizon, which is also what rolls a
 *   NEW month into existence as the horizon window slides.
 *
 * Every path lands in {@link rebuildBarberCapacity}, which recomputes from
 * the same inputs and the same `buildDayWindows` math the commit re-check
 * uses, INSIDE a transaction — so a busy write racing a whole-horizon
 * rebuild invalidates it and it re-runs against the fresher read. Entries
 * are written with `update(FieldPath(...))`, which REPLACES the map at the
 * named path: a `set(..., {merge:true})` here once deep-merged contribution
 * maps and let a location key that had emptied out survive every rebuild —
 * phantom free minutes no sweep could heal.
 *
 * ### Cost per rebuild
 * A fixed set of QUERIES (roster, active locations, busy range, exception
 * range, affected month docs) — but Firestore bills range queries per
 * DOCUMENT returned, so a whole-horizon rebuild for a busy barber reads
 * every busy doc in the window (~tens), not "six reads". Still: rebuilds
 * fire on writes, and writes are bookings — this is O(bookings), never
 * O(visitors), which is the economy that matters.
 *
 * No cycles: these triggers write only `capacity/*`, which nothing listens
 * to. A booking landing still updates the dots — commit writes `barberBusy`,
 * which fires the single-day path here.
 *
 * ### Emulator note
 * `sweepCapacityDaily` never fires in the emulator (scheduled functions
 * don't run there); dev materialization comes entirely from the seed's
 * roster writes. Reseed after long-lived emulator sessions if the horizon
 * has visibly slid.
 */
export const rebuildCapacityOnBusyChange = onDocumentWritten(
  'barberBusy/{docId}',
  async (event) => {
    const key = splitDayDocId(event.params.docId);
    if (!key) return;
    // TTL purges of long-past busy docs re-fire this trigger; recomputing a
    // dead day would rewrite retired months forever. History stays put.
    if (key.dayKey < dayKeyOf(new Date(), TENANT_ZONE)) return;
    await rebuildBarberCapacity(
      adminFirestore(),
      key.barberId,
      key.dayKey,
      key.dayKey,
    );
  },
);

export const rebuildCapacityOnExceptionChange = onDocumentWritten(
  'scheduleExceptions/{docId}',
  async (event) => {
    const key = splitDayDocId(event.params.docId);
    if (!key) return;
    if (key.dayKey < dayKeyOf(new Date(), TENANT_ZONE)) return;
    await rebuildBarberCapacity(
      adminFirestore(),
      key.barberId,
      key.dayKey,
      key.dayKey,
    );
  },
);

export const rebuildCapacityOnRosterChange = onDocumentWritten(
  'barberSchedules/{barberId}',
  async (event) => {
    const db = adminFirestore();
    const span = await horizonSpan(db);
    if (!span) return;
    await rebuildBarberCapacity(
      db,
      event.params.barberId,
      span.fromKey,
      span.toKey,
    );
  },
);

/**
 * Hours clamp every window and the policy IS the horizon — an edit to either
 * must not wait for the 03:00 sweep while `observeDay` (live geometry)
 * already shows the new truth. Both are rare admin writes; a full re-sweep
 * per edit is noise-level cost.
 */
export const rebuildCapacityOnLocationChange = onDocumentWritten(
  'locations/{locationId}',
  async () => {
    await sweepAllBarbers(adminFirestore());
  },
);

export const rebuildCapacityOnSettingsChange = onDocumentWritten(
  'settings/{docId}',
  async () => {
    await sweepAllBarbers(adminFirestore());
  },
);

/** 03:00 Sofia — after the shop's day, before anyone books breakfast. */
export const sweepCapacityDaily = onSchedule(
  {
    schedule: 'every day 03:00',
    timeZone: 'Europe/Sofia',
    // The sweep is the self-repair path; a transient policy read failing at
    // 03:00 must not cost the whole day's repair window.
    retryCount: 3,
  },
  async () => {
    await sweepAllBarbers(adminFirestore());
  },
);

async function sweepAllBarbers(db: Firestore): Promise<void> {
  const span = await horizonSpan(db);
  if (!span) return;

  const barbers = await db.collection('barberSchedules').select().get();
  for (const doc of barbers.docs) {
    try {
      await rebuildBarberCapacity(db, doc.id, span.fromKey, span.toKey);
    } catch (error) {
      // One barber's bad roster must not cost the others their sweep.
      logger.error('capacity sweep failed for barber', {
        barberId: doc.id,
        error,
      });
    }
  }
}

/** `ivan__2026-08-14` → its parts; `null` for a key that is not one. */
function splitDayDocId(
  docId: string,
): { readonly barberId: string; readonly dayKey: string } | null {
  const separator = docId.lastIndexOf('__');
  if (separator <= 0) return null;
  return {
    barberId: docId.slice(0, separator),
    dayKey: docId.slice(separator + 2),
  };
}

const TENANT_ZONE = 'Europe/Sofia';

/**
 * Today through the policy horizon, extended to the LAST DAY of the month
 * after the horizon's — the month the window is about to slide into must
 * already exist when it arrives. Computed as "day zero of month+2", which is
 * how you land on a month's true last day without caring how long it is
 * (the earlier `setUTCMonth(+1)` on a day-31 horizon end skipped clean past
 * the shorter month and left its tail days unmaterialized).
 */
async function horizonSpan(
  db: Firestore,
): Promise<{ readonly fromKey: string; readonly toKey: string } | null> {
  const policy = await loadBookingPolicy(db);
  const today = CalendarDay.create(
    dayKeyOf(new Date(), TENANT_ZONE),
    TENANT_ZONE,
  );
  if (today.isFailure()) return null;
  const horizonEnd = horizonSpanEndKey(
    policy.horizonEndFrom(today.value).key(),
  );
  return { fromKey: today.value.key(), toKey: horizonEnd };
}

/** A wall-clock instant → its `YYYY-MM-DD` in `zone`. */
function dayKeyOf(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Recompute one barber's contributions for every day in `[fromKey, toKey]`
 * and write them into the affected month docs — atomically.
 *
 * The whole exchange runs in ONE transaction: the busy/exception reads are
 * in its read set, so a booking committing mid-rebuild invalidates this
 * attempt and it re-runs against the fresher geometry — the read-window race
 * that a plain read-compute-write would persist until the next sweep.
 *
 * Mirrors the retired client-side fan-out computation — windows from
 * `buildDayWindows` (roster ∩ ACTIVE shop hours, minus the day's exception),
 * busy padded by the barber's turnaround, subtracted per shop — so moving
 * the number server-side changed where it lives, not what it is.
 */
export async function rebuildBarberCapacity(
  db: Firestore,
  barberId: string,
  fromKey: string,
  toKey: string,
): Promise<void> {
  const span = dayKeysBetween(fromKey, toKey);
  if (span.truncated) {
    // A horizon this long is an authoring error, but a SILENT truncation
    // would leave the tail permanently unmaterialized with nothing to see.
    logger.warn('capacity span truncated at 500 days', { fromKey, toKey });
  }
  const dayKeys = span.keys;
  if (dayKeys.length === 0) return;

  await db.runTransaction(async (tx) => {
    const monthKeys = [...new Set(dayKeys.map((key) => key.slice(0, 7)))];
    const [locationsSnap, scheduleSnap, busySnap, exceptionsSnap, monthSnaps] =
      await Promise.all([
        tx.get(db.collection('locations').where('status', '==', 'active')),
        tx.get(db.collection('barberSchedules').doc(barberId)),
        tx.get(
          db
            .collection('barberBusy')
            .where('barberId', '==', barberId)
            .where('dayKey', '>=', fromKey)
            .where('dayKey', '<=', toKey),
        ),
        tx.get(
          db
            .collection(SCHEDULE_EXCEPTIONS_COLLECTION)
            .where('barberId', '==', barberId)
            .where('dayKey', '>=', fromKey)
            .where('dayKey', '<=', toKey),
        ),
        tx.getAll(
          ...monthKeys.map((month) =>
            db.collection(CAPACITY_COLLECTION).doc(month),
          ),
        ),
      ]);

    // Deterministic zone: sorted by doc id, so adding a shop cannot flip
    // which zone the computation happens in between two runs.
    const locationDocs = [...locationsSnap.docs].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const zone = String(locationDocs[0]?.data()['timezone'] ?? TENANT_ZONE);
    const scheduleData = scheduleSnap.data();
    const schedule = scheduleData
      ? toSchedule(scheduleData as DocumentData, zone)
      : null;

    const plans = planBarberCapacity({
      barberId,
      dayKeys,
      zone,
      schedule,
      hoursByLocation: new Map<string, readonly LocationDayHours[]>(
        locationDocs.map((doc) => [
          doc.id,
          (doc.data()['hours'] ?? []) as readonly LocationDayHours[],
        ]),
      ),
      busyByDay: new Map<string, readonly PersistedSlot[]>(
        busySnap.docs.map((doc) => [
          String(doc.data()['dayKey']),
          (doc.data()['busy'] ?? []) as readonly PersistedSlot[],
        ]),
      ),
      exceptionByDay: new Map(
        exceptionsSnap.docs.map((doc) => [
          String(doc.data()['dayKey']),
          exceptionFromDocument(doc.data()),
        ]),
      ),
    });

    const existsByMonth = new Map(
      monthKeys.map((month, index) => [
        month,
        monthSnaps[index]?.exists ?? false,
      ]),
    );

    for (const plan of plans) {
      const monthRef = db.collection(CAPACITY_COLLECTION).doc(plan.month);

      if (!existsByMonth.get(plan.month)) {
        const seed: Record<string, Record<string, CapacityContribution>> = {};
        for (const { dayKey, contribution } of plan.entries) {
          if (contribution) seed[dayKey] = { [barberId]: contribution };
        }
        tx.set(monthRef, {
          month: plan.month,
          days: seed,
          purgeAt: monthPurgeAt(plan.month),
        });
        continue;
      }

      // `update` with a FieldPath REPLACES the map at that path — the whole
      // point. Merge semantics would keep any location key the new
      // contribution no longer carries (a shop that filled up, a roster day
      // moved between shops) alive forever.
      const paths: unknown[] = [];
      for (const { dayKey, contribution } of plan.entries) {
        paths.push(
          new FieldPath('days', dayKey, barberId),
          contribution ?? FieldValue.delete(),
        );
      }
      const [firstPath, firstValue, ...rest] = paths;
      tx.update(monthRef, firstPath as FieldPath, firstValue, ...rest);
    }
  });
}

/**
 * TTL mirror: a month's rollup is dead weight ~40 days after the month ends
 * — and `barberBusy`, the density data it summarizes, deliberately TTLs
 * away on the same reasoning. Enable the policy on `capacity.purgeAt`.
 */
function monthPurgeAt(monthKey: string): Timestamp {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const lastOfMonth = Date.UTC(year, month, 0);
  return Timestamp.fromMillis(lastOfMonth + 40 * 24 * 3_600_000);
}
