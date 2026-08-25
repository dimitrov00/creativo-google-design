import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { CalendarDay } from '@creativo/domain/scheduling';
import {
  CAPACITY_COLLECTION,
  type CapacityDayEntry,
  capacityMonthKey,
  freeMinutesFor,
} from '@creativo/application/booking';
import { adminFirestore } from '../firebase-admin';
import { loadBookingPolicy } from './load-booking-policy';

const TENANT_ZONE = 'Europe/Sofia';

/** Staff-only. One row per (barber, sample day) — see the writer's doc. */
export const LEAD_TIME_SAMPLES_COLLECTION = 'barberLeadTimeSamples';

/**
 * How far out a barber's first free day is, sampled once a day.
 *
 * ### Why this cannot be computed later
 * Every other statistic in this product is a fold over stored facts, so it can
 * be recomputed forever. This one is the exception: "how far ahead was Ivan
 * booked on 14 July" is a question about the FUTURE as it looked that morning,
 * and the moment somebody books — or cancels — that answer is gone. There is
 * no query that recovers yesterday's value. A sample not taken is a sample
 * lost, which is why this ships before the screen that reads it.
 *
 * It is also the metric an owner acts on fastest. Lead time creeping from two
 * days to two weeks is the signal to raise prices or add a chair, and it moves
 * long before utilisation does.
 *
 * ### Read off the capacity rollup, not the availability engine
 * `capacity/{YYYY-MM}` already holds free minutes per (day, barber, shop) and
 * is kept convergent by the same triggers the client calendar trusts. Sampling
 * from it costs two or three document reads for the whole shop instead of a
 * per-barber solve, and — more importantly — it means the number the owner
 * sees agrees with what a client would have found on the calendar.
 *
 * ### The one imprecision, stated plainly
 * The rollup stores a day's free minutes as a SUM, not as its longest
 * contiguous block. A day whose only free time is four scattered ten-minute
 * gaps reports forty free minutes and will be counted as available even though
 * no service fits in it. So this is a LOWER BOUND on true lead time — it can
 * report "free tomorrow" when the first genuinely bookable slot is later, and
 * it can never report the reverse.
 *
 * That is the right direction to be wrong for a trend line, and the fix is
 * cheap when it is wanted: add a `longestFreeMinutes` alongside the sum in
 * `rebuildBarberCapacity` and raise the threshold here to a real service
 * duration. Until then nothing should present this as a bookable promise.
 */
export const sampleBarberLeadTimeDaily = onSchedule(
  {
    // 04:00 Sofia — an hour AFTER `sweepCapacityDaily`, so the sample reads
    // a rollup the sweep has already repaired rather than racing it.
    schedule: 'every day 04:00',
    timeZone: TENANT_ZONE,
    retryCount: 3,
  },
  async () => {
    await sampleAllBarbers(adminFirestore());
  },
);

export async function sampleAllBarbers(db: Firestore): Promise<void> {
  const policy = await loadBookingPolicy(db);
  const today = CalendarDay.create(
    dayKeyOf(new Date(), TENANT_ZONE),
    TENANT_ZONE,
  );
  if (today.isFailure()) {
    logger.error('lead-time sample skipped: bad tenant day', {
      zone: TENANT_ZONE,
    });
    return;
  }
  const from = today.value;
  const to = policy.horizonEndFrom(from);

  // The month docs the horizon spans, read ONCE and shared by every barber —
  // the whole point of sampling off the rollup rather than per barber.
  const months = monthKeysBetween(from, to);
  const monthSnaps = await db.getAll(
    ...months.map((month) => db.collection(CAPACITY_COLLECTION).doc(month)),
  );
  const daysByMonth = new Map<string, Record<string, CapacityDayEntry>>();
  for (const snap of monthSnaps) {
    const days = snap.data()?.['days'];
    daysByMonth.set(
      snap.id,
      typeof days === 'object' && days !== null
        ? (days as Record<string, CapacityDayEntry>)
        : {},
    );
  }

  // The ROSTER is the population, not the catalog: a barber with no schedule
  // has no capacity to measure, and one rostered but absent from the catalog
  // still occupies a chair the owner is paying for.
  const barbers = await db.collection('barberSchedules').select().get();
  const sampledAtIso = new Date().toISOString();

  for (const doc of barbers.docs) {
    const found = firstAvailableDay({
      barberId: doc.id,
      from,
      to,
      daysByMonth,
      // A day has to hold at least one slot step of free time to count. See
      // the imprecision note above for why this is a floor, not a promise.
      thresholdMinutes: policy.slotStepMinutes,
    });

    try {
      await db
        .collection(LEAD_TIME_SAMPLES_COLLECTION)
        .doc(`${doc.id}__${from.key()}`)
        .set({
          barberId: doc.id,
          /** The day the sample was TAKEN — the x-axis of the trend. */
          dayKey: from.key(),
          zone: TENANT_ZONE,
          /** `null` means fully booked to the horizon, which is not zero. */
          firstAvailableDayKey: found?.dayKey ?? null,
          leadTimeDays: found?.leadTimeDays ?? null,
          freeMinutesOnFirstDay: found?.freeMinutes ?? 0,
          horizonDayCount: dayCountBetween(from, to),
          sampledAtIso,
        });
    } catch (error) {
      // One barber's write failing must not cost the others their sample —
      // and a missing row is honest, where a retried batch could double-count.
      logger.error('lead-time sample failed for barber', {
        barberId: doc.id,
        error,
      });
    }
  }
}

interface FirstAvailable {
  readonly dayKey: string;
  readonly leadTimeDays: number;
  readonly freeMinutes: number;
}

/**
 * Walk forward to the first day this barber has sellable time.
 *
 * Starts at TODAY rather than tomorrow: same-day walk-ups are most of a
 * barbershop's volume, and a lead time that could never be zero would hide
 * exactly the days the shop is quiet.
 */
function firstAvailableDay(input: {
  readonly barberId: string;
  readonly from: CalendarDay;
  readonly to: CalendarDay;
  readonly daysByMonth: ReadonlyMap<string, Record<string, CapacityDayEntry>>;
  readonly thresholdMinutes: number;
}): FirstAvailable | null {
  const { barberId, from, to, daysByMonth, thresholdMinutes } = input;

  let day = from;
  let leadTimeDays = 0;
  while (!to.isBefore(day)) {
    const dayKey = day.key();
    const entry = daysByMonth.get(capacityMonthKey(dayKey))?.[dayKey];
    // `null` location: any shop this barber works counts — the question is
    // when they are next free, not where.
    const freeMinutes = freeMinutesFor(entry, [barberId], null);
    if (freeMinutes >= thresholdMinutes) {
      return { dayKey, leadTimeDays, freeMinutes };
    }
    day = day.next();
    leadTimeDays += 1;
  }
  return null;
}

/** Every `YYYY-MM` the inclusive span touches, in order. */
function monthKeysBetween(
  from: CalendarDay,
  to: CalendarDay,
): readonly string[] {
  const keys: string[] = [];
  let cursor = from.startOfMonth();
  while (!to.isBefore(cursor)) {
    keys.push(capacityMonthKey(cursor.key()));
    cursor = cursor.endOfMonth().next();
  }
  return keys;
}

function dayCountBetween(from: CalendarDay, to: CalendarDay): number {
  let count = 0;
  let day = from;
  while (!to.isBefore(day)) {
    count += 1;
    day = day.next();
  }
  return count;
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
