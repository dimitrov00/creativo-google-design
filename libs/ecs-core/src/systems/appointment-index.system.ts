import { BusyKey } from '../components/busy-key.data';
import type { DayOffset } from '../components/day-offset.data';
import type { PlacementKind } from '../components/placement-kind.data';
import {
  Seat,
  SeatRelationship,
  SeatSubjectKind,
} from '../components/seat.data';
import { TimeInterval } from '../components/time-interval.data';
import type { AppointmentEntity } from '../entities/appointment.entity';
import type { BarberId } from '../entities/barber.entity';
import type { UserId } from '../entities/user.entity';
import { ZonedTimeSystem } from './zoned-time.system';

/**
 * The QUERY MIRRORS of an appointment (`appointment-document.ts:94-106`):
 * flat keys beside the seats so the indexed queries find the visit — "my
 * appointments" (`ownerUserId`), a client's whole history (`subjectUserIds`,
 * R33), a barber's book (`barberIds`) and the busy rebuild's reverse index
 * (`busyKeys`). The SEATS are the truth; a corrupt mirror can change which
 * queries find a visit, never what it says.
 */
export type AppointmentQueryKeys = {
  readonly ownerUserId: UserId | null;
  readonly subjectUserIds: readonly UserId[];
  readonly barberIds: readonly BarberId[];
  readonly busyKeys: readonly BusyKey[];
};

/** What the mirrors read of a seat — whose it is, whose chair, when it starts. */
export type IndexedSeat = Pick<Seat, 'subject' | 'barberId' | 'startMs'>;

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * AppointmentIndexSystem — the mirrors every write plan recomputes, and the
 * placement rule that rides beside them (R33). Used by every write plan and
 * by the seed; the busy key's day is zone math over the table, never `Intl`
 * or `new Date`, and `BusySystem.contributionsOf` passes the SAME table, so
 * the mirror and the projection name the same documents.
 */
export const AppointmentIndexSystem = {
  /**
   * The four mirrors:
   *
   * - `ownerUserId` — the first `self` seat's account (the booker); `null`
   *   for a walk-in the shop entered itself;
   * - `subjectUserIds` — every ACCOUNT on the visit, distinct, sorted (the
   *   `busyKeys` precedent: one array mirror, one `array-contains` index);
   *   guests have no account and no history to find;
   * - `barberIds` — distinct, in seat order;
   * - `busyKeys` — `BusyKey.of(barber, the SOLD start's local day)` per seat,
   *   distinct, sorted: two seats with one barber on one day are one
   *   projection document. A seat whose day the table does not cover names
   *   no key — the caller builds the table around the visit
   *   (`ZonedTimeSystem.dayTableAround`).
   */
  queryKeys(
    appointment: { readonly seats: readonly IndexedSeat[] },
    days: readonly DayOffset[],
  ): AppointmentQueryKeys {
    let ownerUserId: UserId | null = null;
    const subjects: UserId[] = [];
    const barberIds: BarberId[] = [];
    const busyKeys: BusyKey[] = [];
    const seats = appointment.seats;
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as IndexedSeat;
      const subject = seat.subject;
      if (subject.kind === SeatSubjectKind.Account) {
        if (
          ownerUserId === null &&
          subject.relationship === SeatRelationship.Self
        ) {
          ownerUserId = subject.userId;
        }
        if (!subjects.includes(subject.userId)) subjects.push(subject.userId);
      }
      if (!barberIds.includes(seat.barberId)) barberIds.push(seat.barberId);
      const dayKey = ZonedTimeSystem.dayKeyOf(seat.startMs, days);
      if (dayKey !== null) {
        const key = BusyKey.of(seat.barberId, dayKey);
        if (!busyKeys.includes(key)) busyKeys.push(key);
      }
    }
    subjects.sort(compareStrings);
    busyKeys.sort(compareStrings);
    return { ownerUserId, subjectUserIds: subjects, barberIds, busyKeys };
  },

  /**
   * The envelope mirror — earliest sold start to latest sold end; `null`
   * for a visit with no seats (which no write plan may produce).
   */
  envelope(appointment: Pick<AppointmentEntity, 'seats'>): TimeInterval | null {
    const seats = appointment.seats;
    if (seats.length === 0) return null;
    let startMs = Number.POSITIVE_INFINITY;
    let endMs = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as Seat;
      if (seat.startMs < startMs) startMs = seat.startMs;
      const end = Seat.endMs(seat);
      if (end > endMs) endMs = end;
    }
    return TimeInterval.of(startMs, endMs);
  },

  /**
   * The entity with every mirror recomputed from its seats — what a write
   * plan stores. `placement` (the COMMIT's own stamp) and `inferredPlacement`
   * (the backfill's reconstruction) ride through VERBATIM: no rewrite can
   * erase the inference, and none can promote it to a stamp. A visit with
   * no seats keeps its stored envelope.
   */
  withQueryKeys(
    appointment: AppointmentEntity,
    days: readonly DayOffset[],
  ): AppointmentEntity {
    const keys = AppointmentIndexSystem.queryKeys(appointment, days);
    return {
      ...appointment,
      ownerUserId: keys.ownerUserId,
      subjectUserIds: keys.subjectUserIds,
      barberIds: keys.barberIds,
      busyKeys: keys.busyKeys,
      timeInterval:
        AppointmentIndexSystem.envelope(appointment) ??
        appointment.timeInterval,
    };
  },

  /**
   * Who placed the booking, as the COMMIT stamped it — `null` for a row it
   * did not stamp (written before the field), whatever the backfill has
   * since inferred. The evidence that the row's seat preferences were
   * recorded, not defaulted.
   */
  stampedPlacement(
    appointment: Pick<AppointmentEntity, 'placement'>,
  ): PlacementKind | null {
    return appointment.placement;
  },

  /**
   * Who most likely placed the booking, as the backfill reconstructed it
   * from the commit's audit row (§12.5.1) — read on its own, NEVER as the
   * stamp and never evidence about the seats (the old commit stored an
   * omitted preference as `specific`). `null` when nothing was inferred.
   */
  inferPlacement(
    appointment: Pick<AppointmentEntity, 'inferredPlacement'>,
  ): PlacementKind | null {
    return appointment.inferredPlacement;
  },
} as const;
