import {
  type BarberEmployment,
  type ScheduleVersion,
  StaffSetupItem,
} from '@core/components';
import type { Barber, BarberSchedule } from '@core/entities';
import {
  OfferingPriceSystem,
  type PricedService,
} from './offering-price.system';

/** One setup item and whether the records show it done. */
export type StaffSetupEntry = {
  readonly staffSetupItem: StaffSetupItem;
  readonly done: boolean;
};

/**
 * A barber record's setup, read off the records (team onboarding D5):
 * the items bookings need before the record can go live, the optional
 * profile details, whether every needed one is done, and the first needed
 * one that is not.
 */
export type StaffSetupChecklist = {
  readonly needed: readonly StaffSetupEntry[];
  readonly optional: readonly StaffSetupEntry[];
  readonly ready: boolean;
  readonly firstMissing: StaffSetupItem | null;
};

/**
 * Whether some roster version with hours in it lies inside the working
 * period — a version that ended before the start day, or begins after the
 * last working day, gives nobody a bookable hour.
 */
function hasHoursInPeriod(
  employment: BarberEmployment,
  versions: readonly ScheduleVersion[],
): boolean {
  const start = employment.barberStartsLocalDate;
  const last = employment.barberLastWorkingLocalDate;
  for (let i = 0; i < versions.length; i++) {
    const version = versions[i] as ScheduleVersion;
    if (version.segments.length === 0) continue;
    const endsBeforeStart =
      version.effectiveToLocalDate !== null &&
      version.effectiveToLocalDate < start;
    const beginsAfterLast =
      last !== null && version.effectiveFromLocalDate > last;
    if (!endsBeforeStart && !beginsAfterLast) return true;
  }
  return false;
}

/**
 * StaffSetupSystem — what a barber record still needs (team onboarding D5,
 * `docs/designs/team-onboarding.md`). Nothing about progress is stored:
 * every answer is computed from the barber record, the services and the
 * roster, so the Team page, the newcomer's setup card and the go-live step
 * can never disagree.
 */
export const StaffSetupSystem = {
  /**
   * The checklist of `barber`. Needed, in this order: a name, a start day,
   * the shops (an empty list is "every shop" — a deliberate answer), at
   * least one service that lists the barber, and hours inside the working
   * period. Optional: photo, title, bio, Instagram, experience. `schedule`
   * is `null` while the barber has no roster.
   */
  checklistOf(
    barber: Barber,
    services: readonly PricedService[],
    schedule: BarberSchedule | null,
  ): StaffSetupChecklist {
    let performsSomething = false;
    for (let i = 0; i < services.length; i++) {
      if (
        OfferingPriceSystem.isPerformedBy(
          services[i] as PricedService,
          barber.id,
        )
      ) {
        performsSomething = true;
        break;
      }
    }
    const needed: StaffSetupEntry[] = [
      {
        staffSetupItem: StaffSetupItem.Name,
        done: barber.name.bg.trim().length > 0,
      },
      // A record cannot be stored without its start day.
      { staffSetupItem: StaffSetupItem.StartDay, done: true },
      // An empty `locationIds` is "every shop", so the shops are always answered.
      { staffSetupItem: StaffSetupItem.Shops, done: true },
      { staffSetupItem: StaffSetupItem.Services, done: performsSomething },
      {
        staffSetupItem: StaffSetupItem.Hours,
        done: schedule !== null && hasHoursInPeriod(barber, schedule.versions),
      },
    ];
    const optional: StaffSetupEntry[] = [
      {
        staffSetupItem: StaffSetupItem.Photo,
        done: barber.avatarMediaId !== null,
      },
      { staffSetupItem: StaffSetupItem.Title, done: barber.title !== null },
      { staffSetupItem: StaffSetupItem.Bio, done: barber.bio !== null },
      {
        staffSetupItem: StaffSetupItem.Instagram,
        done: barber.instagramHandle !== null,
      },
      {
        staffSetupItem: StaffSetupItem.Experience,
        done: barber.yearsExperience !== null,
      },
    ];
    let firstMissing: StaffSetupItem | null = null;
    for (let i = 0; i < needed.length; i++) {
      const entry = needed[i] as StaffSetupEntry;
      if (!entry.done) {
        firstMissing = entry.staffSetupItem;
        break;
      }
    }
    return { needed, optional, ready: firstMissing === null, firstMissing };
  },
} as const;
