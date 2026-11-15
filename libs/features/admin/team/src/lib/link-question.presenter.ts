import { LocalizedText } from '@core/components';
import type { Barber } from '@core/entities';
import type { Locale } from '@core/primitives';
import { LinkAnswer, type LinkQuestionVm } from './link.vm';
import type { LinkWords } from './link.words';
import { firstWord } from './team.format';

/*
 * THE QUESTIONS BEFORE AN ACCOUNT'S LINK CHANGES, WORDED (Law 10): «Да
 * свържа ли …?» and «Да разкача ли …?», each saying the person will have
 * to sign in again. Apart from `link.presenter.ts` on purpose: the
 * member's page asks the release question itself, and must not carry the
 * phone rules the link sheet's rows are worded with.
 */

/** The question before `accountName`'s account becomes the record's. */
export function linkQuestionVm(
  accountName: string,
  barber: Barber,
  linkWords: LinkWords,
  locale: Locale,
): LinkQuestionVm {
  return {
    title: linkWords.linkTitle(
      accountName,
      firstWord(LocalizedText.pick(barber.name, locale)),
    ),
    message: linkWords.linkMessage(firstWord(accountName)),
    actions: [
      {
        id: LinkAnswer.Confirm,
        label: linkWords.linkLabel,
        role: 'default',
        testId: 'member-link-confirm',
      },
      {
        id: LinkAnswer.Cancel,
        label: linkWords.cancel,
        role: 'cancel',
        testId: 'member-link-cancel',
      },
    ],
  };
}

/** The question before `accountName`'s account is released from its record. */
export function releaseQuestionVm(
  accountName: string,
  linkWords: LinkWords,
): LinkQuestionVm {
  return {
    title: linkWords.releaseTitle(accountName),
    message: linkWords.releaseMessage(firstWord(accountName)),
    actions: [
      {
        id: LinkAnswer.Confirm,
        label: linkWords.releaseLabel,
        role: 'default',
        testId: 'member-release-confirm',
      },
      {
        id: LinkAnswer.Cancel,
        label: linkWords.cancel,
        role: 'cancel',
        testId: 'member-release-cancel',
      },
    ],
  };
}
