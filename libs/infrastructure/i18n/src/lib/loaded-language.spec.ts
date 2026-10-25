import { TestBed } from '@angular/core/testing';
import {
  type Translation,
  type TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, Subject, firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { loadedLanguage } from './loaded-language';

/** A loader whose catalogues arrive only when the spec says so. */
class GatedLoader implements TranslocoLoader {
  static readonly gates = new Map<string, Subject<Translation>>();
  getTranslation(lang: string): Observable<Translation> {
    const gate = new Subject<Translation>();
    GatedLoader.gates.set(lang, gate);
    return gate;
  }
}

class InstantLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of({ hello: lang });
  }
}

function transloco(loader: new () => TranslocoLoader): TranslocoService {
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: {
          availableLangs: ['bg', 'en'],
          defaultLang: 'bg',
          fallbackLang: 'bg',
          missingHandler: { logMissingKey: false },
        },
        loader,
      }),
    ],
  });
  return TestBed.inject(TranslocoService);
}

describe('loadedLanguage', () => {
  it('names the active language once its catalogue has loaded, never before', () => {
    GatedLoader.gates.clear();
    const service = transloco(GatedLoader);
    const seen: string[] = [];
    const subscription = loadedLanguage(service).subscribe((lang) =>
      seen.push(lang),
    );
    expect(seen).toEqual([]);
    GatedLoader.gates.get('bg')?.next({ hello: 'здравей' });
    GatedLoader.gates.get('bg')?.complete();
    expect(seen).toEqual(['bg']);

    // A switch waits for the new language's words; the old one is not
    // named again in between.
    service.setActiveLang('en');
    expect(seen).toEqual(['bg']);
    GatedLoader.gates.get('en')?.next({ hello: 'hello' });
    GatedLoader.gates.get('en')?.complete();
    expect(seen).toEqual(['bg', 'en']);
    subscription.unsubscribe();
  });

  it('answers a language already loaded at once', async () => {
    const service = transloco(InstantLoader);
    expect(await firstValueFrom(loadedLanguage(service))).toBe('bg');
    service.setActiveLang('en');
    expect(await firstValueFrom(loadedLanguage(service))).toBe('en');
  });
});
