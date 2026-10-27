import { TestBed } from '@angular/core/testing';
import {
  type Translation,
  type TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import {
  AccountsError,
  IdentityError,
  IdentityErrorCode,
  PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import en from '../assets/i18n/en.json';
import bg from '../assets/i18n/bg.json';
import { wordFlowFailure } from './word-flow-failure';

type Lang = 'bg' | 'en';

const CATALOGS = new Map<string, Translation>([
  ['en', en],
  ['bg', bg],
]);

class FixtureLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(CATALOGS.get(lang) as Translation);
  }
}

/** The `errors` line of `code` in `lang`, as the catalogue ships it. */
function line(lang: Lang, code: string): string {
  const errors = (lang === 'en' ? en : bg).errors as Record<string, string>;
  return new Map(Object.entries(errors)).get(code) ?? '';
}

async function translocoIn(lang: Lang): Promise<TranslocoService> {
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: {
          availableLangs: ['bg', 'en'],
          defaultLang: lang,
          fallbackLang: lang,
          missingHandler: { logMissingKey: false },
        },
        loader: FixtureLoader,
      }),
    ],
  });
  const transloco = TestBed.inject(TranslocoService);
  await firstValueFrom(transloco.selectTranslation(lang));
  return transloco;
}

/*
 * The ONE "server code, else IDENTITY_CALL_FAILED" rule of the identity
 * flows (pass D §2.11, E-11) — the rule the auth store's `messageOf` and the
 * onboarding store's registration branch each spelled before, now one
 * helper over the flow states' structs. Words byte-identical to today's.
 */
describe('wordFlowFailure', () => {
  it.each(['bg', 'en'] as const)(
    'words a failed call by the server’s own code, in %s',
    async (lang) => {
      const transloco = await translocoIn(lang);
      const refused = PipelineError.fromWire('invalid-argument', {
        errorCode: IdentityErrorCode.OtpWrongCode,
      });

      expect(wordFlowFailure(transloco, refused)).toBe(
        line(lang, IdentityErrorCode.OtpWrongCode),
      );
    },
  );

  it.each(['bg', 'en'] as const)(
    'words a failed call the server named no code for as the generic copy, in %s',
    async (lang) => {
      const transloco = await translocoIn(lang);

      expect(
        wordFlowFailure(
          transloco,
          PipelineError.bare(PipelineErrorCode.Unavailable),
        ),
      ).toBe(line(lang, IdentityErrorCode.CallFailed));
    },
  );

  it('names the seconds left on a throttled code request — its one allowlisted figure (OR-9)', async () => {
    const refused = PipelineError.fromWire('resource-exhausted', {
      errorCode: IdentityErrorCode.OtpRateLimited,
      retryAfterSeconds: 42,
    });

    expect(wordFlowFailure(await translocoIn('bg'), refused)).toBe(
      'Вече ти изпратихме код. Нов можеш да поискаш след 42 сек.',
    );
    TestBed.resetTestingModule();
    expect(wordFlowFailure(await translocoIn('en'), refused)).toBe(
      'We already sent you a code. You can ask for a new one in 42 s.',
    );
  });

  it('words the deployed sender’s refusal as its own copy, never the lockout and never a retry (WS-0)', async () => {
    const refused = PipelineError.fromWire('failed-precondition', {
      errorCode: IdentityErrorCode.OtpSendUnavailable,
    });
    expect(PipelineError.isBlocked(refused)).toBe(false);

    expect(wordFlowFailure(await translocoIn('bg'), refused)).toBe(
      'Кодовете за вход още не се изпращат. Свържи се със салона.',
    );
    TestBed.resetTestingModule();
    expect(wordFlowFailure(await translocoIn('en'), refused)).toBe(
      "Sign-in codes aren't being sent yet. Contact the shop.",
    );
  });

  it('falls back to the raw server code the catalogue has no copy for, as before', async () => {
    const transloco = await translocoIn('bg');

    expect(
      wordFlowFailure(
        transloco,
        PipelineError.fromWire('internal', { errorCode: 'NO_SUCH_CODE' }),
      ),
    ).toBe('NO_SUCH_CODE');
  });

  it.each(['bg', 'en'] as const)(
    'words every other refusal as itself, its own fields the params, in %s',
    async (lang) => {
      const transloco = await translocoIn(lang);

      expect(
        wordFlowFailure(transloco, IdentityError.birthDateTooOld(121, 120)),
      ).toBe(
        line(lang, IdentityErrorCode.BirthDateTooOld).replace(
          '{{maxAge}}',
          '120',
        ),
      );
      expect(wordFlowFailure(transloco, IdentityError.otpWrongCode())).toBe(
        line(lang, IdentityErrorCode.OtpWrongCode),
      );
      expect(
        wordFlowFailure(transloco, IdentityError.identifierMissing()),
      ).toBe(line(lang, IdentityErrorCode.IdentifierMissing));
      expect(
        wordFlowFailure(
          transloco,
          AccountsError.updateProfileRepositoryFailure(),
        ),
      ).toBe(line(lang, 'ACCOUNTS_UPDATE_PROFILE_REPOSITORY_FAILURE'));
      expect(
        wordFlowFailure(
          transloco,
          IdentityError.registrationFieldMissing('firstName'),
        ),
      ).toBe(line(lang, IdentityErrorCode.RegistrationFieldMissing));
    },
  );
});
