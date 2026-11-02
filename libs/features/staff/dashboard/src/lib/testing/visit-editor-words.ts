import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Currency } from '@core/primitives';
import { visitEditorWordsOf } from '../visit-editor/visit-editor.presenter';
import type {
  VisitEditorWords,
  VisitWording,
} from '../visit-editor/visit-editor.vm';

/*
 * The visit sheet's words from the app's REAL catalogue, for the presenters'
 * specs: a key a presenter names and the catalogue lacks fails there, not on
 * a screen.
 */

type Lang = 'bg' | 'en';

function catalogue(lang: Lang): Record<string, unknown> {
  return JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
    readFileSync(
      resolve(
        __dirname,
        `../../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;
}

/** The catalogue's string at a dotted key; a key it lacks throws. */
function wordAt(tree: Record<string, unknown>, key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object'
          ? new Map(Object.entries(node)).get(part)
          : undefined,
      tree,
    );
  if (typeof value !== 'string') throw new Error(`missing word ${key}`);
  return value;
}

/** The words a sheet reads in `lang`, as Transloco would answer them. */
export function catalogueWords(lang: Lang): VisitEditorWords {
  const tree = catalogue(lang);
  return visitEditorWordsOf(
    (key) => wordAt(tree, key),
    (key, params) => {
      const filled = new Map(Object.entries(params));
      return wordAt(tree, key).replace(
        /\{\{\s*(\w+)\s*\}\}/g,
        (_, name: string) => String(filled.get(name) ?? ''),
      );
    },
  );
}

/** A bill in euro, worded in `lang`. */
export function catalogueWording(lang: Lang): VisitWording {
  return {
    words: catalogueWords(lang),
    currency: Currency.EUR,
    intlLocale: lang === 'bg' ? 'bg-BG' : 'en-GB',
    lang,
  };
}
