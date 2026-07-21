import { TestBed } from '@angular/core/testing';
import {
  Translation,
  TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import en from '../assets/i18n/en.json';
import bg from '../assets/i18n/bg.json';
import { translateDomainError } from './translate-domain-error';

const CATALOGS = new Map<string, Translation>([
  ['en', en],
  ['bg', bg],
]);

class FixtureLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(CATALOGS.get(lang) as Translation);
  }
}

describe('translateDomainError', () => {
  let transloco: TranslocoService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideTransloco({
          config: {
            availableLangs: ['en', 'bg'],
            defaultLang: 'en',
            reRenderOnLangChange: true,
          },
          loader: FixtureLoader,
        }),
      ],
    });
    transloco = TestBed.inject(TranslocoService);
  });

  it('resolves a real code to the active locale (en) catalog string', async () => {
    await transloco.load('en').toPromise();
    transloco.setActiveLang('en');

    expect(
      translateDomainError(transloco, {
        code: 'invalid_email',
        params: { rawValue: 'nope' },
      }),
    ).toBe('"nope" is not a valid email address.');
  });

  it('resolves a real code to the bg catalog string', async () => {
    await transloco.load('bg').toPromise();
    transloco.setActiveLang('bg');

    expect(
      translateDomainError(transloco, {
        code: 'invalid_email',
        params: { rawValue: 'nope' },
      }),
    ).toBe('„nope“ не е валиден имейл адрес.');
  });

  it('falls back to the raw code for an unknown code', async () => {
    await transloco.load('en').toPromise();
    transloco.setActiveLang('en');

    expect(
      translateDomainError(transloco, { code: 'totally_made_up_code' }),
    ).toBe('totally_made_up_code');
  });
});
