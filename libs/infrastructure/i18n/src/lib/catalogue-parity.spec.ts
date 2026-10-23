import { describe, expect, it } from 'vitest';
import bg from '../assets/i18n/bg.json';
import en from '../assets/i18n/en.json';

/**
 * Catalogue parity (client-details design §12.6.11): a key present in one
 * language and missing in the other renders as its raw path in production,
 * and nothing else catches it before a user does.
 */

type Lang = 'bg' | 'en';

interface Catalogue {
  readonly lang: Lang;
  readonly leaves: ReadonlyMap<string, unknown>;
}

/**
 * Keys only one language needs, each with why. Bulgarian ordinal suffixes
 * follow the last digit and 4, 7 and 8 take their own; English folds them
 * into `other`.
 */
const LANGUAGE_SPECIFIC_KEYS: ReadonlyMap<string, Lang> = new Map([
  ['staff.block.repeatDateOrdinal.4', 'bg'],
  ['staff.block.repeatDateOrdinal.7', 'bg'],
  ['staff.block.repeatDateOrdinal.8', 'bg'],
]);

/**
 * Urgency and loss framing the client surfaces must never use (spine §8
 * ethics). Scoped to the namespaces a client reads about their own standing.
 */
const GUARDED_NAMESPACES = ['clientCard.', 'account.', 'booking.paused.'];
const BANNED_PHRASES: readonly RegExp[] = [
  /ще загуби/iu,
  /побързай/iu,
  /остава(?:т)? само/iu,
  /последен шанс/iu,
  /\byou(?:'|’)?ll lose\b/iu,
  /\bhurry\b/iu,
  /\bonly\b[^.!?]*\bleft\b/iu,
  /\blast chance\b/iu,
];

/** Where the refusal copy lives — `translateDomainError` reads `errors.<errorCode>`. */
const ERRORS_PREFIX = 'errors.';
const SCREAMING_CHARS = /^[A-Z][A-Z0-9_]*$/;

/**
 * SCREAMING_SNAKE — a leading letter, then `_`-separated non-empty segments
 * of capitals and digits. Checked without a nested quantifier: the character
 * class plus "no empty segment" (`__`) and "no trailing separator".
 */
const isScreamingSnake = (code: string): boolean =>
  SCREAMING_CHARS.test(code) && !code.includes('__') && !code.endsWith('_');

function leaves(node: unknown, path = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, child] of Object.entries(node)) {
      for (const entry of leaves(child, path ? `${path}.${key}` : key)) {
        out.set(...entry);
      }
    }
  } else {
    out.set(path, node);
  }
  return out;
}

/** Transloco's `{{ name }}` and the single-brace slots split by hand. */
function placeholders(value: unknown): string {
  if (typeof value !== 'string') return '';
  const names = [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}|\{([\w.]+)\}/g)]
    .map((match) => match[1] ?? match[2] ?? '')
    .filter((name) => name !== '');
  return [...new Set(names)].sort().join();
}

const BG: Catalogue = { lang: 'bg', leaves: leaves(bg) };
const EN: Catalogue = { lang: 'en', leaves: leaves(en) };
const BOTH = [BG, EN] as const;
const otherThan = (catalogue: Catalogue) => (catalogue === BG ? EN : BG);

describe('i18n catalogue parity', () => {
  it('bg and en hold the same leaf keys, apart from the language-specific ones', () => {
    for (const catalogue of BOTH) {
      const other = otherThan(catalogue);
      const missing = [...catalogue.leaves.keys()].filter(
        (key) =>
          !other.leaves.has(key) &&
          LANGUAGE_SPECIFIC_KEYS.get(key) !== catalogue.lang,
      );
      expect(
        missing,
        `keys in ${catalogue.lang}.json missing from ${other.lang}.json`,
      ).toEqual([]);
    }
  });

  it('every language-specific key exists in its language only', () => {
    // Keeps the allowlist honest: an entry whose key was deleted or added
    // to both catalogues would otherwise excuse a future gap silently.
    for (const [key, lang] of LANGUAGE_SPECIFIC_KEYS) {
      const home = lang === 'bg' ? BG : EN;
      const other = otherThan(home);
      expect(home.leaves.has(key), `${key} in ${home.lang}.json`).toBe(true);
      expect(other.leaves.has(key), `${key} in ${other.lang}.json`).toBe(false);
    }
  });

  it('every leaf is a non-empty string', () => {
    for (const { lang, leaves: entries } of BOTH) {
      const bad = [...entries]
        .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
        .map(([key]) => key);
      expect(bad, `empty or non-string values in ${lang}.json`).toEqual([]);
    }
  });

  it('a key interpolates the same parameters in both languages', () => {
    const mismatched = [...BG.leaves.keys()]
      .filter((key) => EN.leaves.has(key))
      .filter(
        (key) =>
          placeholders(BG.leaves.get(key)) !== placeholders(EN.leaves.get(key)),
      );
    expect(mismatched).toEqual([]);
  });

  it('every `errors` key is an errorCode — its first segment SCREAMING', () => {
    // An `errors` key is `<errorCode>` or `<errorCode>.<reason>`, the
    // errorCode a SCREAMING dictionary value (Law 7.5) — the dotted keys of
    // the legacy classes were retired in Phase 4b (phase-4b-delete.md §2).
    for (const { lang, leaves: entries } of BOTH) {
      const dotted = [...entries.keys()]
        .filter((key) => key.startsWith(ERRORS_PREFIX))
        .filter((key) => {
          const [errorCode = ''] = key.slice(ERRORS_PREFIX.length).split('.');
          return !isScreamingSnake(errorCode);
        });
      expect(dotted, `non-errorCode errors keys in ${lang}.json`).toEqual([]);
    }
  });

  it('every plural `.one` has its `.other`', () => {
    for (const { lang, leaves: entries } of BOTH) {
      const orphans = [...entries.keys()]
        .filter((key) => key.endsWith('.one'))
        .filter((key) => !entries.has(`${key.slice(0, -'.one'.length)}.other`));
      expect(orphans, `.one without .other in ${lang}.json`).toEqual([]);
    }
  });

  it('client-facing copy carries no urgency or loss framing', () => {
    const hits: string[] = [];
    for (const { lang, leaves: entries } of BOTH) {
      for (const [key, value] of entries) {
        if (!GUARDED_NAMESPACES.some((prefix) => key.startsWith(prefix))) {
          continue;
        }
        const banned = BANNED_PHRASES.find(
          (phrase) => typeof value === 'string' && phrase.test(value),
        );
        if (banned) hits.push(`${lang}:${key} matches ${banned}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
