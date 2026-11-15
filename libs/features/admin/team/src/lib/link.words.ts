import type { Translate } from './team.words';

/**
 * The words «Свържи профил» and «Разкачи профила» print from values
 * (`admin.team.link.*`): the lines that name the record or the account.
 * The sheet's fixed labels are read by its template.
 */
export type LinkWords = {
  /** «Николай ще влиза в приложението с този профил…» */
  readonly lede: (name: string) => string;
  readonly team: string;
  /** What the sheet says before a lookup, with no account of the team's to offer. */
  readonly hint: (name: string) => string;
  readonly noneTitle: string;
  /** «Помоли Николай да влезе веднъж в приложението и потърси пак.» */
  readonly none: (name: string) => string;
  readonly failed: string;
  /** «Да свържа ли Георги Иванов с Николай?» */
  readonly linkTitle: (account: string, record: string) => string;
  /** «Георги ще трябва да влезе отново.» */
  readonly linkMessage: (name: string) => string;
  readonly linkLabel: string;
  /** «Да разкача ли профила на Георги Иванов?» */
  readonly releaseTitle: (account: string) => string;
  /** «Георги вече няма да влиза като бръснар…» */
  readonly releaseMessage: (name: string) => string;
  readonly releaseLabel: string;
  readonly cancel: string;
};

/** The link acts' words in one language. */
export function linkWordsOf(translate: Translate): LinkWords {
  const at = (key: string, params?: Readonly<Record<string, unknown>>) =>
    translate(`admin.team.link.${key}`, params);
  return {
    lede: (name) => at('lede', { name }),
    team: at('team'),
    hint: (name) => at('hint', { name }),
    noneTitle: at('noneTitle'),
    none: (name) => at('none', { name }),
    failed: at('failed'),
    linkTitle: (account, record) => at('linkTitle', { account, record }),
    linkMessage: (name) => at('linkMessage', { name }),
    linkLabel: at('linkLabel'),
    releaseTitle: (account) => at('releaseTitle', { account }),
    releaseMessage: (name) => at('releaseMessage', { name }),
    releaseLabel: at('releaseLabel'),
    cancel: at('cancel'),
  };
}
