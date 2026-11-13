import {
  BarberEmployment,
  BarberPreference,
  BarberStatus,
  type BarberLifecycle,
  type PlacementPolicy,
} from '@core/components';
import {
  BarberBookabilityReason,
  type BarberId,
  type LocalDate,
} from '@core/primitives';
import {
  OfferingPriceSystem,
  type PricedService,
} from './offering-price.system';

/**
 * What the verdict reads of a barber record: its id, lifecycle, working
 * period and «Който и да е» flag. A whole `Barber` passes straight in.
 */
export type BookableBarber = BarberLifecycle &
  BarberEmployment & {
    readonly id: BarberId;
    readonly barberJoinsAnyPool: boolean;
  };

/**
 * BarberBookabilitySystem — whether a seat may be placed on a barber (team
 * onboarding D3, `docs/designs/team-onboarding.md`): the ONE rule the
 * server's commit, the availability engine and the waitlist matcher share,
 * so the web never offers a chair the commit would refuse.
 *
 * It asks, in this order: is the record live (not a `DRAFT`, not
 * `DEPARTED`); may this asker book a `STAFF_ONLY` barber; is the shop day
 * inside the working period; does a «Който и да е» seat land on a barber
 * in the pool; does the barber perform the service. Hours, notice and
 * overlap are the booking decision's own rules, judged after.
 */
export const BarberBookabilitySystem = {
  /**
   * `null` when a seat of `service` on `localDate` may be placed on
   * `barber` under `placement`, else the first reason it may not. A seat's
   * `barberPreference` is its stored tag (`null` = not known, judged as a
   * named choice: only `ANY` is held to the pool). A `null` service is a
   * carried seat whose service retired since: its terms were fixed by staff,
   * so who performs it is not asked again.
   */
  verdictOf(
    barber: BookableBarber,
    service: PricedService | null,
    placement: PlacementPolicy,
    barberPreference: BarberPreference | null,
    localDate: LocalDate,
  ): BarberBookabilityReason | null {
    switch (barber.barberStatus) {
      case BarberStatus.Draft:
        return BarberBookabilityReason.NotReady;
      case BarberStatus.Departed:
        return BarberBookabilityReason.Departed;
      case BarberStatus.StaffOnly:
        if (!placement.allowStaffOnlyBarbers) {
          return BarberBookabilityReason.StaffOnly;
        }
        break;
      case BarberStatus.Public:
        break;
    }
    if (localDate < barber.barberStartsLocalDate) {
      return BarberBookabilityReason.BeforeStart;
    }
    if (!BarberEmployment.covers(barber, localDate)) {
      return BarberBookabilityReason.AfterLastDay;
    }
    if (
      barberPreference === BarberPreference.Any &&
      !barber.barberJoinsAnyPool
    ) {
      return BarberBookabilityReason.NotInAnyPool;
    }
    if (
      service !== null &&
      !BarberBookabilitySystem.performs(service, barber.id)
    ) {
      return BarberBookabilityReason.DoesNotOffer;
    }
    return null;
  },

  /**
   * Whether a line of `service` with this `barberPreference` may land on
   * this barber — the two per-line questions of {@link verdictOf} (the
   * «Който и да е» pool, and who performs the service), as the availability
   * engine asks them for every candidate barber. The lifecycle and the
   * working period are asked once per barber before the search, not per
   * line. A `null` service is a carried seat (see {@link verdictOf}).
   */
  takesLine(
    service: PricedService | null,
    barberId: BarberId,
    barberJoinsAnyPool: boolean,
    barberPreference: BarberPreference | null,
  ): boolean {
    if (barberPreference === BarberPreference.Any && !barberJoinsAnyPool) {
      return false;
    }
    return (
      service === null || BarberBookabilitySystem.performs(service, barberId)
    );
  },

  /**
   * Whether `barberId` performs `service`: a service that lists its
   * performers (`offerings`) is performed by them alone; one that lists
   * none is performed by everyone at its own terms.
   */
  performs(service: PricedService, barberId: BarberId): boolean {
    return (
      service.offerings.length === 0 ||
      OfferingPriceSystem.isPerformedBy(service, barberId)
    );
  },
} as const;
