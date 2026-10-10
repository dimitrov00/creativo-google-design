import { BookingStatus } from '../components/booking-status.data';
import { BusyKey } from '../components/busy-key.data';
import type { DayKey } from '../components/day-key.data';
import { DayOffset } from '../components/day-offset.data';
import { BlockKind, MinuteBlock } from '../components/minute-block.data';
import { Seat } from '../components/seat.data';
import { TimeInterval } from '../components/time-interval.data';
import { WriteOp } from '../components/write-op.data';
import type { AppointmentEntity } from '../entities/appointment.entity';
import type { BarberBusyDayEntity } from '../entities/barber-busy-day.entity';
import type { BarberId } from '../entities/barber.entity';
import { Collections } from '../ports/collections';
import { AppointmentIndexSystem } from './appointment-index.system';
import { IntervalSetSystem } from './interval-set.system';
import { ZonedTimeSystem } from './zoned-time.system';

/**
 * One (barber, day) projection document's share of an appointment
 * (`appointment-document.ts:1172-1195`): the chair time of every seat the
 * barber holds that day — setup + service + cleanup around each SOLD slot,
 * the same envelope the commit writes — keyed by the sold start's local day,
 * as instants in seat order (unnormalized: the merge is the projection's).
 */
export type BusyContribution = {
  readonly id: BusyKey;
  readonly barberId: BarberId;
  readonly dayKey: DayKey;
  readonly zone: string;
  readonly spans: readonly TimeInterval[];
};

/** The `barberBusy` document body — the entity minus `id`. */
export type BarberBusyDayBody = Omit<BarberBusyDayEntity, 'id'>;

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The keys a written appointment occupies: its mirror when present, else re-derived from its seats. */
function keysOf(
  appointment: AppointmentEntity | null,
  days: readonly DayOffset[],
): readonly BusyKey[] {
  if (appointment === null) return [];
  if (appointment.busyKeys.length > 0) return appointment.busyKeys;
  return AppointmentIndexSystem.queryKeys(appointment, days).busyKeys;
}

/**
 * BusySystem — the PUBLIC busy projection, `barberBusy/{barberId}__{dayKey}`
 * (`rebuild-busy.ts:105-116`, `application/booking` `busyContributionsOf`/
 * `mergeBusy`). Geometry and nothing else — no client, no service, no price,
 * no reason — stored UNPADDED (the reader applies the barber's turnaround)
 * and NORMALIZED (touching spans merged, so a visitor learns density, never
 * client count).
 *
 * Why a rebuild, not a subtraction: merged geometry is lossy on purpose and
 * cannot be subtracted from, so a change RECOMPUTES each affected
 * (barber, day) from every live appointment that touches it ({@link plan}) —
 * idempotent, and it repairs any drift, whatever wrote it.
 *
 * No `Intl`, no `Date` per element (hot path #6): the day of a seat is the
 * table's (`ZonedTimeSystem.dayKeyOf`), minutes ↔ instants are the table's
 * two-branch subtraction. The table must cover the visits' days
 * (`ZonedTimeSystem.dayTableAround`); a seat outside it projects nothing.
 */
export const BusySystem = {
  /**
   * What an appointment occupies, per busy document, sorted by key. A seat
   * whose day the table does not cover contributes nothing — failing closed
   * FREES time rather than inventing a block nobody can explain.
   */
  contributionsOf(
    appointment: Pick<AppointmentEntity, 'seats' | 'zone'>,
    days: readonly DayOffset[],
  ): readonly BusyContribution[] {
    const ids: BusyKey[] = [];
    const spans: TimeInterval[][] = [];
    const out: { barberId: BarberId; dayKey: DayKey }[] = [];
    const seats = appointment.seats;
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as Seat;
      const dayKey = ZonedTimeSystem.dayKeyOf(seat.startMs, days);
      if (dayKey === null) continue;
      const id = BusyKey.of(seat.barberId, dayKey);
      let at = ids.indexOf(id);
      if (at < 0) {
        at = ids.length;
        ids.push(id);
        spans.push([]);
        out.push({ barberId: seat.barberId, dayKey });
      }
      (spans[at] as TimeInterval[]).push(Seat.chairTime(seat));
    }
    const contributions: BusyContribution[] = [];
    for (let i = 0; i < ids.length; i++) {
      const head = out[i] as { barberId: BarberId; dayKey: DayKey };
      contributions.push({
        id: ids[i] as BusyKey,
        barberId: head.barberId,
        dayKey: head.dayKey,
        zone: appointment.zone,
        spans: spans[i] as TimeInterval[],
      });
    }
    return contributions.sort((a, b) => compareStrings(a.id, b.id));
  },

  /**
   * A busy day's spans with `add` merged in and `remove` taken out —
   * normalized, so two back-to-back seats become one span (density, never
   * count). `remove` is `[]` on every commit; the legacy merge had none.
   */
  mergeBusy(
    day: readonly TimeInterval[],
    add: readonly TimeInterval[],
    remove: readonly TimeInterval[],
  ): readonly TimeInterval[] {
    return IntervalSetSystem.subtract(
      IntervalSetSystem.union(day, add),
      remove,
    );
  },

  /**
   * Instants → the stored blocks of `day`: normalized, clipped INSIDE the
   * day (a span running past midnight keeps only its part of this day — the
   * projection is keyed by the sold start's day), as wall-clock minutes
   * (`ZonedTimeSystem.minuteOfDay`; the day's exclusive end is `1440`).
   */
  blocksOf(
    spans: readonly TimeInterval[],
    day: DayOffset,
  ): readonly MinuteBlock[] {
    const clipped = IntervalSetSystem.clip(
      spans,
      TimeInterval.of(day.dayStartMs, DayOffset.endMs(day)),
    );
    const blocks: MinuteBlock[] = [];
    for (let i = 0; i < clipped.length; i++) {
      const span = clipped[i] as TimeInterval;
      blocks.push(
        MinuteBlock.of(
          ZonedTimeSystem.minuteOfDay(span.startMs, day),
          ZonedTimeSystem.minuteOfDay(span.endMs, day),
          BlockKind.Busy,
        ),
      );
    }
    return blocks;
  },

  /**
   * Stored blocks → the instants a placement is checked against (the
   * inverse of {@link blocksOf}, `ZonedTimeSystem.instantOf`), normalized.
   */
  spansOf(
    blocks: readonly MinuteBlock[],
    day: DayOffset,
  ): readonly TimeInterval[] {
    const spans: TimeInterval[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i] as MinuteBlock;
      spans.push(
        TimeInterval.of(
          ZonedTimeSystem.instantOf(day, block.startMinutes),
          ZonedTimeSystem.instantOf(day, block.endMinutes),
        ),
      );
    }
    return IntervalSetSystem.normalize(spans);
  },

  /**
   * The busy documents a write touched, from BOTH sides — a reschedule to
   * another day must free the old document and fill the new one. Each side
   * reads its mirror (`busyKeys`) when present, else re-derives it from its
   * seats. Distinct, sorted.
   */
  affectedKeys(
    before: AppointmentEntity | null,
    after: AppointmentEntity | null,
    days: readonly DayOffset[],
  ): readonly BusyKey[] {
    const keys: BusyKey[] = [];
    const sides = [keysOf(before, days), keysOf(after, days)];
    for (let s = 0; s < sides.length; s++) {
      const side = sides[s] as readonly BusyKey[];
      for (let i = 0; i < side.length; i++) {
        const key = side[i] as BusyKey;
        if (!keys.includes(key)) keys.push(key);
      }
    }
    return keys.sort(compareStrings);
  },

  /**
   * ONE busy document recomputed from the truth (`rebuild-busy.ts:85-123`):
   * the contributions of every LIVE (pending or confirmed) appointment in
   * `live` to `key`, merged. Nothing live occupies it → a `Delete` (readers
   * treat a deleted and an empty document alike, and a deleted one is one
   * the anonymous surface cannot even enumerate). The zone is the first
   * contributing appointment's. `null` — no write at all — when the key does
   * not parse or its day is outside the table.
   */
  rebuild(
    key: BusyKey,
    live: readonly AppointmentEntity[],
    days: readonly DayOffset[],
  ): WriteOp | null {
    const parsed = BusyKey.parse(key);
    if (parsed === null) return null;
    const { barberId, dayKey } = BusyKey.split(parsed);
    const day = DayOffset.find(dayKey, days);
    if (day === null) return null;
    const path = [Collections.BarberBusy, key];

    // The seats are walked directly: a seat contributes to this key exactly
    // when its barber is the key's and its sold start falls on the key's day
    // (what `contributionsOf` keys it by) — no contribution list, no key
    // strings, no sort per appointment; `blocksOf` normalizes the spans.
    let zone: string | null = null;
    const spans: TimeInterval[] = [];
    for (let i = 0; i < live.length; i++) {
      const appointment = live[i] as AppointmentEntity;
      if (!BookingStatus.isLive(appointment.bookingStatus)) continue;
      const seats = appointment.seats;
      for (let k = 0; k < seats.length; k++) {
        const seat = seats[k] as Seat;
        if (
          seat.barberId === barberId &&
          ZonedTimeSystem.dayKeyOf(seat.startMs, days) === dayKey
        ) {
          zone = zone ?? appointment.zone;
          spans.push(Seat.chairTime(seat));
        }
      }
    }
    if (zone === null) return WriteOp.remove(path);
    const body: BarberBusyDayBody = {
      barberId,
      dayKey,
      zone,
      blocks: BusySystem.blocksOf(spans, day),
    };
    return WriteOp.set(path, body);
  },

  /**
   * The write plan of one appointment write: every busy document either
   * side touches, rebuilt from `live` — the appointments the pipeline loaded
   * for those keys (the `busyKeys array-contains` read, in the same
   * transaction). Sorted by key; a key the table cannot place is left alone.
   */
  plan(
    before: AppointmentEntity | null,
    after: AppointmentEntity | null,
    live: readonly AppointmentEntity[],
    days: readonly DayOffset[],
  ): readonly WriteOp[] {
    const writes: WriteOp[] = [];
    const keys = BusySystem.affectedKeys(before, after, days);
    for (let i = 0; i < keys.length; i++) {
      const write = BusySystem.rebuild(keys[i] as BusyKey, live, days);
      if (write !== null) writes.push(write);
    }
    return writes;
  },
} as const;
