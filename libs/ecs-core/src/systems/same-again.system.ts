import {
  type AppointmentId,
  type BarberId,
  BookingStatus,
  type LocalDate,
  type LocationId,
  type MinuteOfDay,
  type ServiceId,
  type ServiceVariantId,
  UtcEpochMs,
} from '@core/primitives';
import {
  type SameAgain,
  SameAgainReach,
  SeatRebook,
  type ShopNow,
  WallTime,
} from '@core/components';
import type { PrefillSeat } from './booking-cart.system';
import { VisitListSystem } from './visit-list.system';

/** What the source pick reads of a visit. A whole `Appointment` passes. */
export type SameAgainVisit = {
  readonly id: AppointmentId;
  readonly locationId: LocationId;
  readonly bookingStatus: BookingStatus;
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
  readonly utcEpochMs: UtcEpochMs;
};

/** What the reach reads of a seat. A whole `Seat` passes. */
export type SameAgainSeat = {
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId;
};

/** What the reach reads of a service. A whole `Service` passes. */
export type SameAgainService = {
  readonly id: ServiceId;
  readonly variants: readonly { readonly variantId: ServiceVariantId }[];
  readonly offerings: readonly { readonly barberId: BarberId }[];
};

/** What the reach reads of a barber record. A whole `Barber` passes. */
export type SameAgainBarber = {
  readonly id: BarberId;
};

/**
 * «THE SAME AGAIN» (owner ruling Q6 of the role-aware homes brief,
 * 2026-11-25): which past visit a client books again from, and what of it
 * today's public catalogue can still book. ONE answer for both sides of
 * the promise — the card on `/account` words it, and the booking flow's
 * pre-fill (`/book?repeat=<id>`) rebuilds the basket from it — so the card
 * never names a barber the basket cannot hold.
 */
export const SameAgainSystem = {
  /**
   * Did the person HAVE this visit? Completed, or confirmed and begun on
   * its own shop's wall clock (`now`): a visit nobody stamped is still a
   * visit that happened (the owner ruled every stamp optional; the nightly
   * settle of ruling Q1 marks it done later). Pending, cancelled and
   * no-show visits were not had.
   */
  wasHad(visit: SameAgainVisit, now: ShopNow): boolean {
    switch (visit.bookingStatus) {
      case BookingStatus.Completed:
        return true;
      case BookingStatus.Confirmed:
        return VisitListSystem.hasStarted(
          WallTime.of(visit.localDate, visit.startMinutes),
          now,
        );
      case BookingStatus.Pending:
      case BookingStatus.NoShow:
      case BookingStatus.Cancelled:
        return false;
    }
  },

  /**
   * The visit «the same again» starts from: the newest one the person had
   * ({@link wasHad}, each judged on its OWN shop's clock, `nowOf` its
   * `locationId`). A visit whose shop has no known clock (`nowOf` answers
   * `null` — a shop no longer active) is skipped, completed or not: it
   * cannot be dated, nor booked again there. Newest by its start instant
   * (stamp order, T2); on an equal instant the code-unit smaller id wins,
   * whatever the input's order. One linear scan, no sort and no copy.
   * `null` when none was had.
   */
  sourceOf<V extends SameAgainVisit>(
    visits: readonly V[],
    nowOf: (locationId: LocationId) => ShopNow | null,
  ): V | null {
    let best: V | null = null;
    for (let i = 0; i < visits.length; i++) {
      const visit = visits[i] as V;
      const now = nowOf(visit.locationId);
      if (now === null || !SameAgainSystem.wasHad(visit, now)) continue;
      if (best === null) {
        best = visit;
        continue;
      }
      const order = UtcEpochMs.compare(visit.utcEpochMs, best.utcEpochMs);
      if (order > 0 || (order === 0 && visit.id < best.id)) best = visit;
    }
    return best;
  },

  /**
   * How each seat of a visit books again in today's PUBLIC catalogue
   * (`listedBarbers`, and `services` as the public sees them —
   * `CatalogListingSystem.listedServices`):
   *
   * - `GONE` — the service is not offered, or the variant chosen within it
   *   is not;
   * - `KEPT` — the barber is listed and performs it (a service with no
   *   listed performer is everyone's);
   * - `ANY_BARBER` — otherwise: the service stays, the barber is left open.
   *
   * `SAME` when every seat is kept, `NONE` when every seat is gone (or
   * there is none), else `CHANGED`. The away barbers and the gone services
   * are each listed once, in seat order. A `Set` of the listed ids is built
   * once; the services are a shop's handful, scanned per seat.
   */
  reachOf(
    seats: readonly SameAgainSeat[],
    listedBarbers: readonly SameAgainBarber[],
    services: readonly SameAgainService[],
  ): SameAgain {
    const listed = new Set<BarberId>();
    for (let i = 0; i < listedBarbers.length; i++) {
      listed.add((listedBarbers[i] as SameAgainBarber).id);
    }
    const seatRebooks: SeatRebook[] = [];
    const awayBarberIds: BarberId[] = [];
    const goneServiceIds: ServiceId[] = [];
    let kept = 0;
    let gone = 0;
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as SameAgainSeat;
      const rebook = seatRebookOf(seat, listed, services);
      seatRebooks.push(rebook);
      if (rebook === SeatRebook.Kept) {
        kept++;
      } else if (rebook === SeatRebook.Gone) {
        gone++;
        if (!goneServiceIds.includes(seat.serviceId)) {
          goneServiceIds.push(seat.serviceId);
        }
      } else if (!awayBarberIds.includes(seat.barberId)) {
        awayBarberIds.push(seat.barberId);
      }
    }
    return {
      sameAgainReach:
        gone === seats.length
          ? SameAgainReach.None
          : kept === seats.length
            ? SameAgainReach.Same
            : SameAgainReach.Changed,
      seatRebooks,
      awayBarberIds,
      goneServiceIds,
    };
  },

  /**
   * The seats the pre-fill rebuilds the basket from, by {@link reachOf}: a
   * kept seat as it is, an `ANY_BARBER` seat with no barber chosen, a gone
   * seat left out. Each seat keeps its occupant, so the party comes back as
   * the visit had it. A new array; a seat that changes is a new struct.
   */
  rebookSeats<S extends SameAgainSeat & PrefillSeat>(
    seats: readonly S[],
    listedBarbers: readonly SameAgainBarber[],
    services: readonly SameAgainService[],
  ): readonly PrefillSeat[] {
    const reach = SameAgainSystem.reachOf(seats, listedBarbers, services);
    const out: PrefillSeat[] = [];
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as S;
      switch (reach.seatRebooks[i]) {
        case SeatRebook.Kept:
          out.push(seat);
          break;
        case SeatRebook.AnyBarber: {
          const open: PrefillSeat = {
            ...(seat as PrefillSeat),
            barberId: null,
          };
          out.push(open);
          break;
        }
        default:
          break;
      }
    }
    return out;
  },
} as const;

/** One seat's {@link SeatRebook} against the listed ids and the public services. */
function seatRebookOf(
  seat: SameAgainSeat,
  listed: ReadonlySet<BarberId>,
  services: readonly SameAgainService[],
): SeatRebook {
  let service: SameAgainService | null = null;
  for (let k = 0; k < services.length && service === null; k++) {
    if ((services[k] as SameAgainService).id === seat.serviceId) {
      service = services[k] as SameAgainService;
    }
  }
  if (service === null) return SeatRebook.Gone;
  if (seat.variantId !== null) {
    let offered = false;
    for (let k = 0; k < service.variants.length && !offered; k++) {
      offered = service.variants[k]?.variantId === seat.variantId;
    }
    if (!offered) return SeatRebook.Gone;
  }
  if (!listed.has(seat.barberId)) return SeatRebook.AnyBarber;
  if (service.offerings.length === 0) return SeatRebook.Kept;
  for (let k = 0; k < service.offerings.length; k++) {
    if (service.offerings[k]?.barberId === seat.barberId)
      return SeatRebook.Kept;
  }
  return SeatRebook.AnyBarber;
}
