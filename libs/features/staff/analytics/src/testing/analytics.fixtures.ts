import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BarberId, ServiceId } from '@core/primitives';
import type { VisitTranslate } from '@creativo/features/shared/visits';
import type { AnalyticsNames } from '../lib/analytics.presenter';
import { type AnalyticsWords, analyticsWordsOf } from '../lib/analytics.words';

/*
 * TEST SUPPORT (Node only) — the app's real catalogue and a fixed catalogue
 * of names for the screen's specs. Outside the lib's build
 * (`tsconfig.lib.json` excludes `src/testing/**`), imported by specs only.
 */

type Catalogue = Record<string, unknown>;

/** The raw catalogue for a language — what a spec hands Transloco's loader. */
export function catalogueOf(lang: 'bg' | 'en'): Catalogue {
  return JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
    readFileSync(
      resolve(
        __dirname,
        `../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
      ),
      'utf8',
    ),
  ) as Catalogue;
}

/** Transloco's reading, in miniature: a dotted key, `{{param}}` filled in; a missing key throws. */
export function translatorOf(lang: 'bg' | 'en'): VisitTranslate {
  const tree = catalogueOf(lang);
  return (key, params = {}) => {
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
    const filled = new Map(Object.entries(params));
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
      String(filled.get(name) ?? ''),
    );
  };
}

/** The screen's words from the real catalogue. */
export function wordsOf(lang: 'bg' | 'en' = 'bg'): AnalyticsWords {
  return analyticsWordsOf(translatorOf(lang), lang);
}

const SERVICES = new Map<string, string>([
  ['haircut', 'Подстригване'],
  ['beard', 'Брада'],
]);
const BARBERS = new Map<string, string>([
  ['ivan', 'Иван Колев'],
  ['niko', 'Нико Петров'],
]);
const LOCATIONS = new Map<string, string>([
  ['loc-centre', 'Център'],
  ['loc-mladost', 'Младост'],
]);

/** The shop's names: two services, two barbers, two locations, no portraits. */
export const NAMES: AnalyticsNames = {
  serviceName: (id) => SERVICES.get(id) ?? null,
  serviceOrder: (id) => {
    const order = [...SERVICES.keys()].indexOf(id);
    return order === -1 ? null : order;
  },
  barberName: (id) => BARBERS.get(id) ?? null,
  barberAvatarSrc: () => null,
  locationName: (id) => LOCATIONS.get(id) ?? null,
};

export const IVAN = BarberId.of('ivan');
export const NIKO = BarberId.of('niko');
export const HAIRCUT = ServiceId.of('haircut');

/** `formatCents`' bg and en output keeps a no-break space before the sign: spell it in a spec. */
export const nbsp = (text: string): string => text.replaceAll(' ', ' ');
