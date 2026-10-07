import { sofiaDayOf } from '@creativo/application/engagement';
import type { LinePart } from './client-pages.vm';

/*
 * THE CARD'S FIGURES AND DATES — the few formatting rules every presenter
 * shares, in one place so a page never words a date two ways.
 *
 * Dates are the house form (old spec R59): a fact line or a caption says
 * «12.08», with the year only outside the current one («6.03.2025 г.»); a
 * sentence someone hears says the month in words («4 септември»). Every
 * date is a day on the SHOP'S calendar (Europe/Sofia): an instant becomes
 * one through `sofiaDayOf`, and a day is formatted as itself — placed at
 * UTC noon and read back in UTC — so no device zone can move it. `Intl`'s
 * output is never post-processed (its « г.» included).
 *
 * The second half is THE CARD'S QUIET LINES: one grammar for cutting a
 * sentence into runs, binding a fact's words and hanging its joints, so
 * every line of the card wraps the same way.
 */

/** The catalogue's two languages; anything else reads Bulgarian, the shop's own. */
export type CardLocale = 'bg' | 'en';

export function cardLocaleOf(lang: string): CardLocale {
  return lang === 'en' ? 'en' : 'bg';
}

/** A `YYYY-MM-DD` shop day as a `Date` that reads back as that day in UTC. */
function noonOf(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(
    Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1, 12, 0, 0),
  );
}

function yearOf(day: string): string {
  return day.slice(0, 4);
}

/** The year, only when the day is not in `today`'s. */
function yearUnlessCurrent(
  day: string,
  today: string,
): Pick<Intl.DateTimeFormatOptions, 'year'> {
  return yearOf(day) === yearOf(today) ? {} : { year: 'numeric' };
}

function formatDay(
  day: string,
  lang: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(lang, { ...options, timeZone: 'UTC' }).format(
    noonOf(day),
  );
}

/** The shop day an instant falls on (`YYYY-MM-DD`, Europe/Sofia). */
export function shopDayOf(ms: number): string {
  return sofiaDayOf(new Date(ms));
}

/** «4.09» · «6.03.2025 г.» — a fact line's or a caption's date (R59). */
export function dayShort(day: string, today: string, lang: string): string {
  return formatDay(day, lang, {
    day: 'numeric',
    month: '2-digit',
    ...yearUnlessCurrent(day, today),
  });
}

/** «6.03» — the day and month alone, where the year stands elsewhere (a ladder node's line under it). */
export function dayMonth(day: string, lang: string): string {
  return formatDay(day, lang, { day: 'numeric', month: '2-digit' });
}

/** «2025 г.» — a day's year alone (a ladder node's second line, under its «6.03»). */
export function yearAlone(day: string, lang: string): string {
  return formatDay(day, lang, { year: 'numeric' });
}

/** «6.03.2025 г.» — a date that always names its year (a first visit, a record). */
export function dayWithYear(day: string, lang: string): string {
  return formatDay(day, lang, {
    day: 'numeric',
    month: '2-digit',
    year: 'numeric',
  });
}

/** «4 септември» · «6 март 2025 г.» — a date someone hears (accessible names, announcements). */
export function dayLong(day: string, today: string, lang: string): string {
  return formatDay(day, lang, {
    day: 'numeric',
    month: 'long',
    ...yearUnlessCurrent(day, today),
  });
}

/** «март 2025 г.» — a month someone has been a client since. */
export function monthYearLong(day: string, lang: string): string {
  return formatDay(day, lang, { month: 'long', year: 'numeric' });
}

/** «септември» — a month in words (the rhythm's hidden period list). */
export function monthLong(day: string, lang: string): string {
  return formatDay(day, lang, { month: 'long' });
}

/*
 * «1.09 – 30.11» — a season's window: the house range, the years only
 * outside today's. It lives beside the rows (`@creativo/features/shared/visits`)
 * because the waiting request's days print through it too («8.10 – 9.10»):
 * one range formatter for the whole card, never a second (wave D r6).
 */
export { dayRange } from '@creativo/features/shared/visits';

/** Whole calendar days from one shop day to another (negative when `to` comes first). */
export function daysBetweenDays(from: string, to: string): number {
  return Math.round(
    (noonOf(to).getTime() - noonOf(from).getTime()) / 86_400_000,
  );
}

/** The shop day `days` whole calendar days after `day` (`YYYY-MM-DD`). */
export function dayPlus(day: string, days: number): string {
  return new Date(noonOf(day).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** «12 450» — a count or a figure, grouped the locale's way. */
export function figure(value: number, lang: string): string {
  return new Intl.NumberFormat(lang).format(value);
}

/** «+17» · «−250» — a signed movement; zero carries no sign. */
export function signedFigure(value: number, lang: string): string {
  return new Intl.NumberFormat(lang, { signDisplay: 'exceptZero' }).format(
    value,
  );
}

/**
 * A sentence read inside another one: its first letter in the running
 * case («Без неявявания и откази от клиента» → «без …»).
 */
export function runningCase(text: string, lang: string): string {
  return text.charAt(0).toLocaleLowerCase(lang) + text.slice(1);
}

/** A title's first letter, as a monogram disc draws it («Фейд» → «Ф»); `null` without a letter. */
export function monogramOf(title: string, lang: string): string | null {
  const letter = /\p{L}/u.exec(title)?.[0];
  return letter === undefined ? null : letter.toLocaleUpperCase(lang);
}

/**
 * A TITLE inside a sentence (revision 3 §6.1): its first letter in the
 * running case when it is a Cyrillic capital before a lower-case letter
 * («Безплатно оформяне» → «безплатно оформяне», «Фейд» → «фейд»);
 * everything else as written — a Latin brand, an acronym («SPA ден»,
 * «VIP грижа»). A person's and a shop's name are names: never passed.
 *
 * `runningCase` lowers ANY first letter and is for a sentence read inside
 * another one; this one is for a catalogue title, which may be a brand.
 * One helper for every presenter (the glance's and the medal detail's
 * private copies were written against this file's wave and go in W4).
 */
export function inSentence(title: string, lang: string): string {
  return /^(?=\p{Lu})\p{Script=Cyrillic}\p{Ll}/u.test(title)
    ? title.charAt(0).toLocaleLowerCase(lang) + title.slice(1)
    : title;
}

/**
 * «септември 2026 г.» with its year and «г.» bound by a no-break space: a
 * month-and-year that wraps inside a narrow card (a 330 phone's record
 * card, the dialog's 4-up) breaks before the year and never leaves «г.»
 * alone on a line (review 3, F13 — `text-wrap: pretty` did not keep it).
 * A text without such a suffix is returned as it is («October 2026»).
 */
export function boundSuffix(text: string): string {
  return text.replace(/ (\S{1,2}\.)$/u, '\u00a0$1');
}

// ── The quiet lines ─────────────────────────────────────────────────────

/*
 * A QUIET LINE («Клиент от **март 2025 г.** · идва през **4 седмици**»,
 * «**24** посещения · през **4** седмици», «Георги Петров · **371 т.**»)
 * is a sentence of the catalogue cut into RUNS — a fact in primary ink,
 * the words round it quiet — and the runs carry their own spaces and
 * joints, so a template joins nothing (`LinePart`). ONE grammar for every
 * line of the card (revision 3, P5-5 / S1-6; review 3, round 4), where
 * two presenters had written it twice:
 *
 * - a fact is found WHERE THE WORDS PUT IT (`runsOf`): its slot in the
 *   sentence, then the fact inside the slot, so the order is the
 *   language's and «4» is never mistaken for the end of «24»;
 * - a fact's words never part (`heldFacts`, `unbroken`): a count and its
 *   noun, a month and its year are one word to the line breaker;
 * - the joint before a «·» is a no-break space (`LINE_JOINT`,
 *   `hungJoints`), so a line that must wrap parts only after a joint,
 *   between two facts.
 *
 * Drawn, a page parts the runs AT the joints (`partedAtJoints`) into the
 * items of a line of facts (`fact-line.css`), whose dots stand only
 * between two facts on one line: a wrapped line neither ends nor opens on
 * a dot.
 */

/** A space a line never breaks at. */
export const NO_BREAK = '\u00a0';

/** The one place a fact's words may part: the plain space after a middot. */
const BREAK = '· ';

/**
 * A hyphen a line never breaks after ("no-show"): the hyphen itself and a
 * word joiner (U+2060), which draws nothing and holds the two halves on
 * one line.
 */
const HELD_HYPHEN = '-\u2060';

/** The quiet lines' joint: a no-break space BEFORE the middot and a plain one after it. */
export const LINE_JOINT = `${NO_BREAK}${BREAK}`;

/** The catalogue's own joint, as its sentences write it («{{since}} · идва»). */
const PLAIN_JOINT = ' ·';

/** A fact inside a sentence: the words it was handed over in, and the part of them set in primary ink. */
export interface FactMark {
  /** What the sentence was given («23 посещения», «492,50 €»). */
  readonly slot: string;
  /** The part of the slot that is the fact («23»); the slot itself where all of it is. */
  readonly fact: string;
}

/** A run in the line's secondary ink. */
export const quietRun = (text: string): LinePart => ({ text, fact: false });

/** A run in primary ink at weight 500: a fact. */
export const factRun = (text: string): LinePart => ({ text, fact: true });

/** One run per change of ink: neighbours of one kind are one run, an empty run is none. */
export function joined(parts: readonly LinePart[]): readonly LinePart[] {
  const runs: LinePart[] = [];
  for (const part of parts) {
    if (part.text === '') continue;
    const last = runs.at(-1);
    if (last !== undefined && last.fact === part.fact) {
      runs[runs.length - 1] = { text: last.text + part.text, fact: last.fact };
    } else {
      runs.push(part);
    }
  }
  return runs;
}

/**
 * A sentence of the catalogue as the runs of a quiet line. Each fact is
 * found WHERE THE WORDS PUT IT — its slot in the sentence, then the fact
 * inside the slot (a bare string is a slot that is all fact) — so the
 * order is the language's («похарчени общо 492,50 €», "€492.50 spent in
 * all") and «4» is never mistaken for the end of «24». A fact the sentence
 * does not hold stays unmarked: the line is still the sentence, word for
 * word.
 */
export function runsOf(
  text: string,
  marks: readonly (string | FactMark)[],
): readonly LinePart[] {
  const spans = marks
    .map((mark) =>
      typeof mark === 'string' ? { slot: mark, fact: mark } : mark,
    )
    .flatMap((mark) => {
      const slotAt = text.indexOf(mark.slot);
      const factAt = mark.slot.indexOf(mark.fact);
      if (mark.fact === '' || slotAt < 0 || factAt < 0) return [];
      const start = slotAt + factAt;
      return [{ start, end: start + mark.fact.length }];
    })
    .sort((a, b) => a.start - b.start);

  const parts: LinePart[] = [];
  let cursor = 0;
  for (const span of spans) {
    // Two marks over one stretch of the sentence: the first one stands.
    if (span.start < cursor) continue;
    parts.push(quietRun(text.slice(cursor, span.start)));
    parts.push(factRun(text.slice(span.start, span.end)));
    cursor = span.end;
  }
  parts.push(quietRun(text.slice(cursor)));
  return joined(parts);
}

/** Words that stay on one line: every space a no-break one, every hyphen held. */
function heldTogether(words: string): string {
  return words.replaceAll(' ', NO_BREAK).replaceAll('-', HELD_HYPHEN);
}

/**
 * A FACT'S WORDS STAY TOGETHER — the whole line's. A quiet line wraps on a
 * phone («wraps balanced at 330», §2.5.2), and wherever it does it must
 * part BETWEEN facts: «22 посещения · през 4 седмици» over «1 неявяване ·
 * 1 отказ от клиента», never a figure at the end of a line with its noun
 * opening the next, never the sum alone under its own words. So every
 * space of the runs is a no-break one but the space after a middot, the
 * catalogue's own joints included, and a hyphen holds its word together:
 * the line's only break points are its joints, whatever the page's
 * `text-wrap`.
 *
 * For what stands between two joints only (a count and its noun, a sum in
 * its sentence: a few words). A sentence of its own — the clean record's,
 * a pause's — is left to wrap where it must: `heldFacts` holds its facts
 * alone.
 */
export function unbroken(parts: readonly LinePart[]): readonly LinePart[] {
  return parts.map((part) => ({
    ...part,
    text: part.text.split(BREAK).map(heldTogether).join(BREAK),
  }));
}

/**
 * The FACTS alone held together («март 2025 г.», «4 седмици»), the quiet
 * words free to wrap where they must: the hero's line, whose clauses are
 * a sentence each.
 */
export function heldFacts(parts: readonly LinePart[]): readonly LinePart[] {
  return parts.map((part) =>
    part.fact ? { ...part, text: heldTogether(part.text) } : part,
  );
}

/**
 * The catalogue's own joints («{{since}} · идва през») hung on the
 * no-break space, so they are the line's joints (`LINE_JOINT`): a wrap
 * parts after one, and a page parts the runs at them. Quiet runs only —
 * a fact that holds a «·» is one fact.
 */
export function hungJoints(parts: readonly LinePart[]): readonly LinePart[] {
  return parts.map((part) =>
    part.fact
      ? part
      : { ...part, text: part.text.replaceAll(PLAIN_JOINT, `${NO_BREAK}·`) },
  );
}

/**
 * The runs parted at the line's joints, the joints themselves left out:
 * the FACTS a line of facts draws, each as its runs (`fact-line.css`
 * draws the dots). A run that spans a joint is cut at it; an empty fact
 * is none.
 */
export function partedAtJoints<T extends LinePart>(
  runs: readonly T[],
): readonly (readonly T[])[] {
  const facts: T[][] = [[]];
  for (const run of runs) {
    run.text.split(LINE_JOINT).forEach((piece, index) => {
      if (index > 0) facts.push([]);
      if (piece !== '') facts[facts.length - 1]?.push({ ...run, text: piece });
    });
  }
  return facts.filter((fact) => fact.length > 0);
}
