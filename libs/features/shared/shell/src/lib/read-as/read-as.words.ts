/** A lookup in the active catalogue — `TranslocoService.translate` bound to the loaded language. */
export type Translate = (
  key: string,
  params?: Readonly<Record<string, unknown>>,
) => string;

/** What the support read-as's banner prints (OR-24, `shell.readAs.*`). */
export type ReadAsBannerWords = {
  /** «Действаш като Иван Колев» */
  readonly actingAs: (name: string) => string;
  /** The name when the account has none to show. */
  readonly someone: string;
  /** «до 14:32» */
  readonly until: (time: string) => string;
  readonly end: string;
  /** The bar's accessible name. */
  readonly label: string;
};

export function readAsBannerWordsOf(translate: Translate): ReadAsBannerWords {
  const at = (key: string, params?: Readonly<Record<string, unknown>>) =>
    translate(`shell.readAs.${key}`, params);
  return {
    actingAs: (name) => at('actingAs', { name }),
    someone: at('someone'),
    until: (time) => at('until', { time }),
    end: at('end'),
    label: at('label'),
  };
}
