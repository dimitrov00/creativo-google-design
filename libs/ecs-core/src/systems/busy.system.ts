import {
  BookingLifecycle,
  BlockKind,
  MinuteBlock,
  type MinuteRange,
  Seat,
  WriteOp,
} from '@core/components';
import {
  type Appointment,
  type BarberBusyDay,
  Collections,
} from '@core/entities';
import {
  BusyKey,
  defect,
  type BarberId,
  type LocalDate,
  EndMinute,
  MinuteOfDay,
  type UtcEpochMs,
} from '@core/primitives';
import { AppointmentIndexSystem } from './appointment-index.system';
import { IntervalSetSystem } from './interval-set.system';

/**
 * One (barber, shop day) projection document's share of an appointment
 * (the legacy `appointment-document.ts:1172-1195`, deleted in Phase 4b;
 * ledger `docs/architecture/flips/phase-4b-delete.md` §11.1): the chair time
 * of every seat the barber holds — setup + service + cleanup around each
 * SOLD slot, the same envelope the commit writes, clipped to the shop day
 * (T7) — on the appointment's `localDate`, in seat order (unnormalized: the
 * merge is the projection's). No zone, no instant (Law 7.3).
 */
export type BusyContribution = {
  readonly id: BusyKey;
  readonly barberId: BarberId;
  readonly localDate: LocalDate;
  readonly spans: readonly MinuteRange[];
};

/** The `barberBusy` document body — the entity minus `id`. */
export type BarberBusyDayBody = Omit<BarberBusyDay, 'id'>;

/**
 * The first instant of a shop day, as the pipeline computed it from the
 * location's zone (`ZonedTimeSystem.startOfLocalDay`) — handed in so the
 * projection's `utcEpochMs` is stamped without this system ever touching a
 * zone (Law 7.3, flatten-spec §2.5).
 */
export type DayStartUtcMs = (localDate: LocalDate) => UtcEpochMs;

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The keys a written appointment occupies: its mirror when present, else re-derived from its seats. */
function keysOf(
  appointment: Pick<Appointment, 'busyKeys' | 'localDate' | 'seats'> | null,
): readonly BusyKey[] {
  if (appointment === null) return [];
  if (appointment.busyKeys.length > 0) return appointment.busyKeys;
  return AppointmentIndexSystem.queryKeys(appointment).busyKeys;
}

/**
 * Spans → the stored blocks of a shop day: normalized (touching spans
 * merged — density, never count), each a `BUSY` block on the wall clock.
 * The busy projection's ONE rendering of chair time (was `blocksOf`; the
 * blocks ARE minute ranges now, so there is no instant to clip).
 */
function blocksFrom(spans: readonly MinuteRange[]): readonly MinuteBlock[] {
  const merged = IntervalSetSystem.normalize(spans);
  const blocks: MinuteBlock[] = [];
  for (let i = 0; i < merged.length; i++) {
    const span = merged[i] as MinuteRange;
    const start = MinuteOfDay.of(span.startMinutes);
    const end = EndMinute.of(span.endMinutes);
    // The algebra never leaves the shop day it was handed.
    if (!start.ok || !end.ok) return defect('busy: a block off the clock');
    blocks.push(MinuteBlock.of(start.value, end.value, BlockKind.Busy));
  }
  return blocks;
}

/**
 * BusySystem — the PUBLIC busy projection, `barberBusy/{barberId}__{localDate}`
 * (the retired functions trigger `rebuild-busy.ts:105-116`, deleted in flip 1
 * — its successor is `rebuild-busy.pipeline.ts` — and the legacy booking
 * library's `busyContributionsOf`/`mergeBusy`, deleted in Phase 4b).
 * Geometry and nothing else — no client, no service, no price, no reason —
 * stored UNPADDED (the reader applies the barber's turnaround) and NORMALIZED
 * (touching spans merged, so a visitor learns density, never client count).
 *
 * Why a rebuild, not a subtraction: merged geometry is lossy on purpose and
 * cannot be subtracted from, so a change RECOMPUTES each affected
 * (barber, day) from every live appointment that touches it ({@link plan}) —
 * idempotent, and it repairs any drift, whatever wrote it.
 *
 * Time-zone-blind (Law 7.3): a seat is placed by the appointment's
 * `localDate` and its own `startMinutes` (one shop day per appointment,
 * T7), chair time is `Seat.chairTime` clipped to `[0, 1440]`, and the one
 * instant a busy day stores — its first, `utcEpochMs` — comes from the
 * pipeline's {@link DayStartUtcMs}.
 */
export const BusySystem = {
  /**
   * What an appointment occupies, per busy document, sorted by key: one
   * contribution per barber on the appointment's shop day.
   */
  contributionsOf(
    appointment: Pick<Appointment, 'seats' | 'localDate'>,
  ): readonly BusyContribution[] {
    const ids: BusyKey[] = [];
    const spans: MinuteRange[][] = [];
    const barbers: BarberId[] = [];
    const seats = appointment.seats;
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as Seat;
      const id = BusyKey.of(seat.barberId, appointment.localDate);
      let at = ids.indexOf(id);
      if (at < 0) {
        at = ids.length;
        ids.push(id);
        spans.push([]);
        barbers.push(seat.barberId);
      }
      (spans[at] as MinuteRange[]).push(Seat.chairTime(seat));
    }
    const contributions: BusyContribution[] = [];
    for (let i = 0; i < ids.length; i++) {
      contributions.push({
        id: ids[i] as BusyKey,
        barberId: barbers[i] as BarberId,
        localDate: appointment.localDate,
        spans: spans[i] as MinuteRange[],
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
    day: readonly MinuteRange[],
    add: readonly MinuteRange[],
    remove: readonly MinuteRange[],
  ): readonly MinuteRange[] {
    return IntervalSetSystem.subtract(
      IntervalSetSystem.union(day, add),
      remove,
    );
  },

  /**
   * The busy documents a write touched, from BOTH sides — a reschedule to
   * another day must free the old document and fill the new one. Each side
   * reads its mirror (`busyKeys`) when present, else re-derives it from its
   * seats. Distinct, sorted.
   */
  affectedKeys(
    before: Pick<Appointment, 'busyKeys' | 'localDate' | 'seats'> | null,
    after: Pick<Appointment, 'busyKeys' | 'localDate' | 'seats'> | null,
  ): readonly BusyKey[] {
    const keys: BusyKey[] = [];
    const sides = [keysOf(before), keysOf(after)];
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
   * ONE busy document recomputed from the truth (the retired trigger's
   * `rebuild-busy.ts:85-123`; now `rebuild-busy.pipeline.ts`):
   * the chair time of every seat of every LIVE (pending or confirmed)
   * appointment in `live` on the key's barber and shop day, merged. Nothing
   * live occupies it → a `Delete` (readers treat a deleted and an empty
   * document alike, and a deleted one is one the anonymous surface cannot
   * even enumerate). `null` — no write at all — when the key does not
   * parse.
   */
  rebuild(
    key: BusyKey,
    live: readonly Appointment[],
    dayStartUtcMs: DayStartUtcMs,
  ): WriteOp | null {
    const parsed = BusyKey.parse(key);
    if (parsed === null) return null;
    const { barberId, localDate } = BusyKey.split(parsed);
    const path = [Collections.BarberBusy, key];

    // The seats are walked directly: a seat contributes to this key exactly
    // when its barber is the key's and its appointment sits on the key's day
    // (what `contributionsOf` keys it by) — no contribution list, no key
    // strings, no sort per appointment; `blocksFrom` normalizes the spans.
    let occupied = false;
    const spans: MinuteRange[] = [];
    for (let i = 0; i < live.length; i++) {
      const appointment = live[i] as Appointment;
      if (!BookingLifecycle.isLive(appointment)) continue;
      if (appointment.localDate !== localDate) continue;
      const seats = appointment.seats;
      for (let k = 0; k < seats.length; k++) {
        const seat = seats[k] as Seat;
        if (seat.barberId === barberId) {
          occupied = true;
          spans.push(Seat.chairTime(seat));
        }
      }
    }
    if (!occupied) return WriteOp.remove(path);
    const body: BarberBusyDayBody = {
      barberId,
      localDate,
      utcEpochMs: dayStartUtcMs(localDate),
      blocks: blocksFrom(spans),
    };
    return WriteOp.set(path, body);
  },

  /**
   * The write plan of one appointment write: every busy document either
   * side touches, rebuilt from `live` — the appointments the pipeline loaded
   * for those keys (the `busyKeys array-contains` read, in the same
   * transaction). Sorted by key; a key that does not parse is left alone.
   */
  plan(
    before: Appointment | null,
    after: Appointment | null,
    live: readonly Appointment[],
    dayStartUtcMs: DayStartUtcMs,
  ): readonly WriteOp[] {
    const writes: WriteOp[] = [];
    const keys = BusySystem.affectedKeys(before, after);
    for (let i = 0; i < keys.length; i++) {
      const write = BusySystem.rebuild(keys[i] as BusyKey, live, dayStartUtcMs);
      if (write !== null) writes.push(write);
    }
    return writes;
  },
} as const;
