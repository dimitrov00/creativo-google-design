import { BarberLifecycle } from '@core/components';
import type { Barber } from '@core/entities';
import { LocalDate } from '@core/primitives';

/**
 * THE LAST DAYS CLOSE ENOUGH TO DECIDE ON (team onboarding D10, the reminder
 * cards): which working barbers' last day is near, from their records and
 * the shop's today. The Team page's cards (`TeamRosterSystem.remindersOf`),
 * the reminders on top of «Анализи» and the schedule's chart-button badge
 * (owner ruling 2026-11-25) all ask this one rule.
 *
 * Its own system, apart from `EmploymentSystem` (the close, its write plan
 * and its audit rows), since 2026-11-25: a screen that only reminds loads
 * this date rule, not the close's machinery — on the analytics route that
 * was about 30 kB of team, role, governance and audit systems.
 */
export const EmploymentReminderSystem = {
  /**
   * How many days ahead a last working day is worth a reminder — and how
   * long a period has to be for one: a guest booked for a week needs no
   * card saying the week ends (team onboarding D10, the reminder cards).
   */
  REMINDER_DAYS: 7,

  /**
   * Is a working period's last day close enough to decide on? Today, or
   * within `REMINDER_DAYS` of it, on a period longer than that. The record
   * has to work — the caller asks only of one that does.
   */
  isReminded(
    barberStartsLocalDate: LocalDate,
    barberLastWorkingLocalDate: LocalDate | null,
    today: LocalDate,
  ): boolean {
    const last = barberLastWorkingLocalDate;
    return (
      last !== null &&
      last >= today &&
      last <=
        LocalDate.addDays(today, EmploymentReminderSystem.REMINDER_DAYS) &&
      LocalDate.addDays(
        barberStartsLocalDate,
        EmploymentReminderSystem.REMINDER_DAYS,
      ) < last
    );
  },

  /**
   * The working barbers whose last day is close enough to decide on
   * (`isReminded`), soonest first, then in the order given — the
   * schedule's reminders, from the records the staff's team stream holds.
   */
  remindersOf(barbers: readonly Barber[], today: LocalDate): readonly Barber[] {
    const due: Barber[] = [];
    for (let i = 0; i < barbers.length; i++) {
      const barber = barbers[i] as Barber;
      if (
        BarberLifecycle.isLive(barber) &&
        EmploymentReminderSystem.isReminded(
          barber.barberStartsLocalDate,
          barber.barberLastWorkingLocalDate,
          today,
        )
      ) {
        due.push(barber);
      }
    }
    // Stable: barbers on one day keep the order they were given in.
    return due.sort((a, b) =>
      LocalDate.compare(
        a.barberLastWorkingLocalDate as LocalDate,
        b.barberLastWorkingLocalDate as LocalDate,
      ),
    );
  },
} as const;
