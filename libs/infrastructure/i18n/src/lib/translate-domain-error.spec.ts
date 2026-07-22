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

  // Every `code` a `DomainError` in `apps/functions/src/use-cases/{request,verify}-otp.errors.ts`
  // carries — the auth flow's `requestOtpChallenge`/`verifyOtpChallenge`
  // callables surface these via `FunctionsError.details`, and
  // `translateFunctionsError` routes them through `translateDomainError`.
  const AUTH_FLOW_ERROR_CODES = [
    'invalid_input',
    'otp_rate_limited',
    'repository_failure',
    'otp_send_failure',
    'otp_validation_failed',
    'otp_not_found',
    'otp_already_consumed',
    'otp_expired',
    'otp_locked_out',
    'otp_incorrect_code',
    'user_validation_failed',
    'otp_destination_corrupted',
    'token_minting_failure',
  ];

  it.each(AUTH_FLOW_ERROR_CODES)(
    'resolves auth-flow error code %s in en (not a raw-code fallback)',
    async (code) => {
      await transloco.load('en').toPromise();
      transloco.setActiveLang('en');
      expect(translateDomainError(transloco, { code })).not.toBe(code);
    },
  );

  it.each(AUTH_FLOW_ERROR_CODES)(
    'resolves auth-flow error code %s in bg (not a raw-code fallback)',
    async (code) => {
      await transloco.load('bg').toPromise();
      transloco.setActiveLang('bg');
      expect(translateDomainError(transloco, { code })).not.toBe(code);
    },
  );
});
