import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VisitsCatalogue } from './visit-fixtures';

/*
 * TEST SUPPORT (Node only) — the app's catalogues read off disk for the
 * specs, apart from `visit-fixtures.ts` so the fixtures themselves stay
 * browser-safe. Excluded from the library build with the rest of
 * `src/lib/testing/**`.
 */

/** The app's own catalogue, read from the i18n library's assets. */
export function appCatalogue(lang: 'bg' | 'en'): VisitsCatalogue {
  return JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
    readFileSync(
      resolve(
        __dirname,
        `../../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
      ),
      'utf8',
    ),
  ) as VisitsCatalogue;
}
