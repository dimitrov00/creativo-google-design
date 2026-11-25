import { LocalizedText } from '@core/components';
import type { Barber } from '@core/entities';
import type { LocalDate, Locale } from '@core/primitives';
import { firstNameOf } from '@creativo/features/shared/visits';
import { formatDayPill } from '@creativo/ui/wall-clock';
import type { AnalyticsReminderVm } from './analytics-reminders.vm';

/** The reminder's words, in the catalogue's language (`admin.team.reminder.*`). */
export type AnalyticsReminderWords = {
  /** «Последният ден на Георги е пт, 20.11» */
  readonly title: (name: string, date: string) => string;
  /** «Днес е последният ден на Георги» */
  readonly today: (name: string) => string;
  /** «Удължи» */
  readonly extend: string;
};

/** What the reminders on «Анализи» are worded from. */
export type AnalyticsRemindersInput = {
  /** `EmploymentReminderSystem.remindersOf` — the last days to decide on, soonest first. */
  readonly barbers: readonly Barber[];
  /** The shop's today. */
  readonly today: LocalDate;
  readonly locale: Locale;
  readonly words: AnalyticsReminderWords;
};

/**
 * THE REMINDERS ON «АНАЛИЗИ», WORDED (Law 10; team onboarding D10, the
 * reminder cards): the same words as the Team page's cards, on one line
 * each. Which last days are close enough is `EmploymentReminderSystem.remindersOf`'s
 * answer.
 */
export function analyticsRemindersVm(
  input: AnalyticsRemindersInput,
): readonly AnalyticsReminderVm[] {
  const { words } = input;
  return input.barbers.map((barber) => {
    const name = firstNameOf(LocalizedText.pick(barber.name, input.locale));
    const last = barber.barberLastWorkingLocalDate;
    return {
      barberId: barber.id,
      line:
        last === null || last === input.today
          ? words.today(name)
          : words.title(name, formatDayPill(last, input.locale)),
      action: words.extend,
      testId: `analytics-reminder-${barber.id}`,
    };
  });
}
