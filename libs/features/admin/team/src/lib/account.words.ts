import { AccountStanding } from '@core/components';
import type { Translate } from './team.words';

/**
 * The words a staff account's page prints from values
 * (`admin.team.account.*`): why its roles are read, what a change costs
 * the person, and the question before they leave the team. The page's
 * fixed labels are read by its template.
 */
export type AccountWords = {
  /** The head's name for a person who has not registered. */
  readonly unnamed: string;
  /** Why the roles are read, by the standing that says so; `EDITABLE` has no word. */
  readonly standing: ReadonlyMap<AccountStanding, string>;
  /** «Елена ще трябва да влезе отново след промяна.» */
  readonly sessionsNote: (name: string) => string;
  readonly barberNote: string;
  readonly noneTicked: string;
  /** «Да махна ли Елена Василева от екипа?» */
  readonly removeTitle: (account: string) => string;
  /** «Елена остава клиент и ще трябва да влезе отново.» */
  readonly removeMessage: (name: string) => string;
  readonly removeLabel: string;
  readonly cancel: string;
};

/** The standings that say why an account's roles are read. */
const READ_STANDINGS: readonly AccountStanding[] = [
  AccountStanding.Own,
  AccountStanding.Vendor,
  AccountStanding.Unregistered,
  AccountStanding.ReadOnly,
];

/** The account page's words in one language. */
export function accountWordsOf(translate: Translate): AccountWords {
  const at = (key: string, params?: Readonly<Record<string, unknown>>) =>
    translate(`admin.team.account.${key}`, params);
  return {
    unnamed: at('unnamed'),
    standing: new Map(
      READ_STANDINGS.map((standing) => [standing, at(`standing.${standing}`)]),
    ),
    sessionsNote: (name) => at('sessionsNote', { name }),
    barberNote: at('barberNote'),
    noneTicked: at('noneTicked'),
    removeTitle: (account) => at('removeTitle', { account }),
    removeMessage: (name) => at('removeMessage', { name }),
    removeLabel: at('removeLabel'),
    cancel: at('cancel'),
  };
}
