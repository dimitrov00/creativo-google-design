import type { WelcomeFaceVm, WelcomeVm } from './staff-home.vm';

/** The colleagues the lede names before «and N more». */
const NAMED = 2;
/** Up to this many, the lede names them all — «и още 1» is never worded. */
const NAMED_ALL = 3;

/** The welcome's words, in the catalogue's language (`staff.welcome.*`). */
export type WelcomeWords = {
  /** «{{name}}, вече си в екипа» */
  readonly headlineNamed: (name: string) => string;
  /** «Вече си в екипа» — an account with no first name. */
  readonly headline: string;
  /** «Ще работиш с {{names}}.» */
  readonly ledeWith: (names: string) => string;
  /** «Тук са записите ти и профилът, който клиентите виждат.» — no colleague yet. */
  readonly ledeAlone: string;
  /** «още {{count}}» — the colleagues past the named ones. */
  readonly more: (count: number) => string;
};

export type WelcomeInput = {
  /** The account's own first name; `null` when it has none. */
  readonly firstName: string | null;
  /** The newcomer's own face. */
  readonly own: WelcomeFaceVm;
  /** The team's live barbers but the newcomer, in the team's order. */
  readonly colleagues: readonly WelcomeFaceVm[];
  readonly words: WelcomeWords;
  readonly locale: string;
};

const LIST_FORMATS = new Map<string, Intl.ListFormat>();

/** «Иван и Нико» — the locale's conjunction, one formatter per locale. */
function listFormat(locale: string): Intl.ListFormat {
  let format = LIST_FORMATS.get(locale);
  if (format === undefined) {
    format = new Intl.ListFormat(locale, { type: 'conjunction' });
    LIST_FORMATS.set(locale, format);
  }
  return format;
}

/** «Иван», «Иван и Нико», «Иван, Нико и Мартин», «Иван, Нико и още 2». */
function namesOf(
  colleagues: readonly WelcomeFaceVm[],
  words: WelcomeWords,
  locale: string,
): string {
  const named = colleagues
    .slice(0, colleagues.length <= NAMED_ALL ? NAMED_ALL : NAMED)
    .map((face) => face.name);
  const rest = colleagues.length - named.length;
  return listFormat(locale).format(
    rest > 0 ? [...named, words.more(rest)] : named,
  );
}

/**
 * THE WELCOME, WORDED (Law 10; account first, A4): the newcomer at the
 * centre of the colleagues they join, the greeting by their first name, and
 * who they will work with. Who the colleagues are — the team's live
 * barbers — is handed in; how many faces fit is the orbit's to draw.
 */
export function welcomeVm(input: WelcomeInput): WelcomeVm {
  const { words, colleagues, locale } = input;
  const everyone = [input.own, ...colleagues].map((face) => face.name);
  const name = input.firstName?.trim() ?? '';
  return {
    own: input.own,
    colleagues,
    facesLabel: listFormat(locale).format(everyone),
    headline: name.length > 0 ? words.headlineNamed(name) : words.headline,
    lede:
      colleagues.length > 0
        ? words.ledeWith(namesOf(colleagues, words, locale))
        : words.ledeAlone,
  };
}
