import {
  EmploymentOutlook,
  type LeftoverBookings,
  LocalizedText,
} from '@core/components';
import type { Barber } from '@core/entities';
import type { LocalDate, Locale } from '@core/primitives';
import { EmploymentSystem } from '@core/systems';
import { LinkAnswer, type LinkQuestionVm } from './link.vm';
import type { LeftoverNoticeVm } from './member.vm';
import type { MemberWords } from './member.words';
import { dayWords, firstWord } from './team.format';

/*
 * «ПЕРИОД НА РАБОТА», WORDED (Law 10; team onboarding D10): what the last
 * day drafted will do, said before it is saved — and the question asked
 * when saving it makes the barber leave at once. It decides nothing: where
 * a period stands against the shop's today is
 * `EmploymentSystem.outlookOf`'s answer, the rule the daily close reads —
 * a record in preparation has no period to end, so its last day says
 * nothing here.
 */

/**
 * What the last day drafted will do, as a notice of its own: the fact as
 * its title, what follows from it under it. The same shape as the warning
 * about the bookings left, so the two read as two facts about one day.
 */
export type PeriodNoteVm = {
  readonly title: string;
  readonly body: string;
};

/** What the period sheet says under its two days, and asks before a save. */
export type PeriodOutlookVm = {
  /** What the last day drafted will do; `null` with no last day, or while the shop's today is unknown. */
  readonly note: PeriodNoteVm | null;
  /** The question a save is held behind; `null` unless saving makes the barber leave at once. */
  readonly question: LinkQuestionVm | null;
  /**
   * The bookings the last day would leave behind — how many, and what
   * becomes of them — or that they could not be read; `null` with none,
   * while the answer is on its way, and for a record with no period to end.
   */
  readonly leftover: LeftoverNoticeVm | null;
};

/** What the period sheet's outlook is worded from. */
export type PeriodOutlookInput = {
  readonly barber: Barber;
  /** The last working day as drafted. */
  readonly lastLocalDate: LocalDate | null;
  /** The shop's today; `null` until its zone is known. */
  readonly today: LocalDate | null;
  /** `EmploymentSystem.leftoverOf` for the day drafted; `null` while it is not known. */
  readonly leftover: LeftoverBookings | null;
  /** The bookings after the day drafted could not be read. */
  readonly leftoverFailed: boolean;
  readonly memberWords: MemberWords;
  readonly locale: Locale;
};

/** Nothing to say and nothing to ask. */
const QUIET: PeriodOutlookVm = { note: null, question: null, leftover: null };

/** The warning about the bookings left: how many, then what becomes of them (a day ahead) or what to do (a day passed). */
function leftoverOf(
  input: PeriodOutlookInput,
  body: (count: number) => string,
  name: string,
  date: string,
): LeftoverNoticeVm | null {
  if (input.leftoverFailed) {
    return { title: null, body: input.memberWords.leftoverFailed };
  }
  const count = input.leftover?.leftoverCount ?? 0;
  return count === 0
    ? null
    : {
        title: input.memberWords.leftoverTitle(name, date, count),
        body: body(count),
      };
}

/** The period sheet's outlook: a quiet line for a day ahead, a line and a question for one behind. */
export function periodOutlookVm(input: PeriodOutlookInput): PeriodOutlookVm {
  const { lastLocalDate, today, memberWords } = input;
  if (lastLocalDate === null || today === null) return QUIET;
  const name = firstWord(LocalizedText.pick(input.barber.name, input.locale));
  const date = dayWords(lastLocalDate, today, input.locale);
  switch (EmploymentSystem.outlookOf(input.barber, lastLocalDate, today)) {
    case EmploymentOutlook.Ends:
      return {
        note: {
          title: memberWords.periodEndsTitle(name, date),
          body: memberWords.periodEndsBody,
        },
        question: null,
        leftover: leftoverOf(input, memberWords.leftoverStays, name, date),
      };
    case EmploymentOutlook.Ended:
      return {
        note: {
          title: memberWords.periodEndedTitle(name),
          body: memberWords.periodEndedBody(date),
        },
        leftover: leftoverOf(input, memberWords.leftoverNow, name, date),
        question: {
          title: memberWords.leaveTitle(name),
          message: memberWords.leaveMessage(name),
          actions: [
            {
              id: LinkAnswer.Confirm,
              label: memberWords.leaveLabel,
              role: 'default',
              testId: 'member-period-leave-confirm',
            },
            {
              id: LinkAnswer.Cancel,
              label: memberWords.leaveCancel,
              role: 'cancel',
              testId: 'member-period-leave-cancel',
            },
          ],
        },
      };
    default:
      return QUIET;
  }
}
