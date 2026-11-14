import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StaffTranslate } from './staff-day.vm';

/*
 * The app's REAL catalogue, read the way Transloco reads it, for the staff
 * day's presenter specs — a key a presenter names and the catalogue lacks
 * fails there, not on a screen. Specs only: `tsconfig.lib.json` excludes it,
 * and nothing in the page imports it.
 */

type Catalogue = Record<string, unknown>;

function catalogue(lang: 'bg' | 'en'): Catalogue {
  return JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
    readFileSync(
      resolve(
        __dirname,
        `../../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
      ),
      'utf8',
    ),
  ) as Catalogue;
}

/**
 * The leaf a dotted key names, as Transloco's flattened catalogue answers
 * it: a segment may itself hold a dot (`errors.ACCESS_DENIED.HOURS` sits
 * beside `errors.ACCESS_DENIED` as the flat key `ACCESS_DENIED.HOURS`), so
 * at each level the longest run of segments that IS a key wins.
 */
function leafOf(node: unknown, parts: readonly string[]): unknown {
  if (parts.length === 0) return node;
  if (node === null || typeof node !== 'object') return undefined;
  const children = new Map(Object.entries(node));
  for (let taken = parts.length; taken > 0; taken--) {
    const name = parts.slice(0, taken).join('.');
    if (!children.has(name)) continue;
    const found = leafOf(children.get(name), parts.slice(taken));
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Transloco's reading, in miniature: a dotted key, `{{param}}` filled in. */
export function catalogueTranslate(lang: 'bg' | 'en'): StaffTranslate {
  const tree = catalogue(lang);
  return (key, params = {}) => {
    const value = leafOf(tree, key.split('.'));
    if (typeof value !== 'string') throw new Error(`missing word ${key}`);
    const filled = new Map(Object.entries(params));
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
      String(filled.get(name) ?? ''),
    );
  };
}
