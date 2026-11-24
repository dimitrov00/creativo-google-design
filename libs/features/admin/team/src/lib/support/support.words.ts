import type { Translate } from '../team.words';

/** What support's read-as page and its sheets print (OR-24, `admin.support.*`). */
export type SupportWords = {
  readonly lookupLede: string;
  /** What the lookup says before anything is typed. */
  readonly hint: string;
  readonly noneTitle: string;
  readonly none: string;
  readonly failed: string;
  /** «Виж като Иван Колев» */
  readonly sheetTitle: (name: string) => string;
};

export function supportWordsOf(translate: Translate): SupportWords {
  const at = (key: string, params?: Readonly<Record<string, unknown>>) =>
    translate(`admin.support.${key}`, params);
  return {
    lookupLede: at('lookupLede'),
    hint: at('hint'),
    noneTitle: at('noneTitle'),
    none: at('none'),
    failed: at('failed'),
    sheetTitle: (name) => at('sheetTitle', { name }),
  };
}
