import {
  EmploymentOutlook,
  type LeftoverBookings,
  LocalizedText,
} from '@core/components';
import type { Barber } from '@core/entities';
import type { LocalDate, Locale } from '@core/primitives';
import { EmploymentSystem } from '@core/systems';
import { LinkAnswer, type LinkQuestionVm } from './link.vm';
import type { MemberWords } from './member.words';
import { dayWords, firstWord } from './team.format';

/*
 * «РАБОТЕН ПЕРИОД», WORDED (Law 10; team onboarding D10): what the last
 * day drafted will do, said before it is saved — and the question asked
 * when saving it makes the barber leave at once. It decides nothing: where
 * a period stands against the shop's today is
 * `EmploymentSystem.outlookOf`'s answer, the rule the daily close reads,
 * and how many visits the day leaves is `EmploymentSystem.leftoverOf`'s —
 * a record in preparation has no period to end, so its last day says
 * nothing here.
 */

/**
 * What the last day drafted will do — ONE notice for one day (owner,
 * 2026-11-16: a fact and a warning stacked under the same two rows read as
 * two loose panels). The departure as a quiet fact while nothing is left
 * behind; the visits it leaves, as a warning that says the departure in
 * its body, once there are some — or that they could not be checked.
 */
export type PeriodNoticeVm = {
  /** A quiet fact, or a warning about visits left — the notice's own tones. */
  readonly tone: 'neutral' | 'warning';
  readonly title: string;
  readonly body: string;
  /** The visits it counts are listed under it. */
  readonly listsVisits: boolean;
  readonly testId: 'member-period-note' | 'member-period-leftover';
};

/** What the period sheet says under its two days, and asks before a save. */
export type PeriodOutlookVm = {
  /** `null` with no last day, while the shop's today is unknown, and for a record with no period to end. */
  readonly notice: PeriodNoticeVm | null;
  /** The question a save is held behind; `null` unless saving makes the barber leave at once. */
  readonly question: LinkQuestionVm | null;
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
export const QUIET_OUTLOOK: PeriodOutlookVm = { notice: null, question: null };

/**
 * The one notice: the departure (`title`, `body`) while no visit is left
 * after the day, the count as a warning whose body says the departure
 * (`stays`) once some are, and the departure over «could not check» when
 * the visits could not be read.
 */
function noticeOf(
  input: PeriodOutlookInput,
  title: string,
  body: string,
  stays: (count: number) => string,
): PeriodNoticeVm {
  const { memberWords } = input;
  if (input.leftoverFailed) {
    return {
      tone: 'warning',
      title,
      body: memberWords.leftoverFailed,
      listsVisits: false,
      testId: 'member-period-leftover',
    };
  }
  const count = input.leftover?.leftoverCount ?? 0;
  return count === 0
    ? {
        tone: 'neutral',
        title,
        body,
        listsVisits: false,
        testId: 'member-period-note',
      }
    : {
        tone: 'warning',
        title: memberWords.leftoverTitle(count),
        body: stays(count),
        listsVisits: true,
        testId: 'member-period-leftover',
      };
}

/** The period sheet's outlook: a notice for a day ahead, a notice and a question for one behind. */
export function periodOutlookVm(input: PeriodOutlookInput): PeriodOutlookVm {
  const { lastLocalDate, today, memberWords } = input;
  if (lastLocalDate === null || today === null) return QUIET_OUTLOOK;
  const name = firstWord(LocalizedText.pick(input.barber.name, input.locale));
  const date = dayWords(lastLocalDate, today, input.locale);
  switch (EmploymentSystem.outlookOf(input.barber, lastLocalDate, today)) {
    case EmploymentOutlook.Ends:
      return {
        notice: noticeOf(
          input,
          memberWords.periodEndsTitle(name, date),
          memberWords.periodEndsBody,
          (count) => memberWords.leftoverStays(name, date, count),
        ),
        question: null,
      };
    case EmploymentOutlook.Ended:
      return {
        notice: noticeOf(
          input,
          memberWords.periodEndedTitle(name),
          memberWords.periodEndedBody(date),
          (count) => memberWords.leftoverNow(name, count),
        ),
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
      return QUIET_OUTLOOK;
  }
}
