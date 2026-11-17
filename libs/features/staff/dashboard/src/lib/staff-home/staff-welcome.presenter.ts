import type { WelcomeFaceVm, WelcomeVm } from './staff-home.vm';

/** The welcome's words, in the catalogue's language (`staff.welcome.*`). */
export type WelcomeWords = {
  /** «{{name}}, вече си в екипа» */
  readonly headlineNamed: (name: string) => string;
  /** «Вече си в екипа» — an account with no first name. */
  readonly headline: string;
};

export type WelcomeInput = {
  /** The account's own first name; `null` when it has none. */
  readonly firstName: string | null;
  /** The account's own full name («Петър Петров»); `''` when it has none. */
  readonly accountName: string;
  /** The newcomer's own face, as their barber record shows it. */
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

/**
 * THE WELCOME, WORDED (Law 10; account first, A4): the newcomer at the
 * centre of the colleagues they join, and the greeting by their first name.
 * Who the colleagues are — the team's live barbers — is handed in; how many
 * faces fit is the orbit's to draw, and who they are is the faces' to say
 * (and the label's, which names everyone): the copy never lists names
 * (owner 2026-11-17: a list of names reads oddly, and grows with the team).
 */
export function welcomeVm(input: WelcomeInput): WelcomeVm {
  const { words, colleagues, locale } = input;
  // The centre is the person reading: named as their account names them,
  // like the greeting, so the initials and «Петър, …» never disagree when
  // the record goes by another name; the record's photo stays (one photo
  // per barber). An account with no name keeps the record's.
  const accountName = input.accountName.trim();
  const own: WelcomeFaceVm =
    accountName.length > 0 ? { ...input.own, name: accountName } : input.own;
  const everyone = [own, ...colleagues].map((face) => face.name);
  const name = input.firstName?.trim() ?? '';
  return {
    own,
    colleagues,
    facesLabel: listFormat(locale).format(everyone),
    headline: name.length > 0 ? words.headlineNamed(name) : words.headline,
  };
}
