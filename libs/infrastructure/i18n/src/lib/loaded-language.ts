import type { TranslocoService } from '@jsverse/transloco';
import { type Observable, map, switchMap } from 'rxjs';

/**
 * The language the catalogue has LOADED, each time one has: the active
 * language, emitted only once its words are there. A surface that words
 * with `translate(…, lang)` inside a `computed` reads this (through
 * `toSignal(…, { initialValue: null })`), so no lookup there can start a
 * load — a write the computed would read back and never settle on — and a
 * line on screen re-words when the language switches. ONE rule for every
 * page and store that words that way (pass D: it was spelled out eight
 * times).
 */
export function loadedLanguage(
  transloco: TranslocoService,
): Observable<string> {
  return transloco.langChanges$.pipe(
    switchMap((lang) =>
      transloco.selectTranslation(lang).pipe(map(() => lang)),
    ),
  );
}
