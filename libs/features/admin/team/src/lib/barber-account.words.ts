import type { Translate } from './team.words';

/** «Нов бръснар» — the account step of adding a barber (account first, A2). */
export type BarberAccountWords = {
  readonly title: string;
  readonly lede: string;
  /** «Без профил в приложението» — the record alone. */
  readonly skip: string;
  /** What the sheet says before a lookup, with no account of the team's to offer. */
  readonly hint: string;
  readonly noneTitle: string;
  readonly none: string;
  readonly failed: string;
  readonly team: string;
};

/** The account step's words in one language. */
export function barberAccountWordsOf(translate: Translate): BarberAccountWords {
  const at = (key: string) => translate(`admin.team.barberAccount.${key}`);
  return {
    title: at('title'),
    lede: at('lede'),
    skip: at('skip'),
    hint: at('hint'),
    noneTitle: at('noneTitle'),
    none: at('none'),
    failed: translate('admin.team.link.failed'),
    team: translate('admin.team.link.team'),
  };
}
