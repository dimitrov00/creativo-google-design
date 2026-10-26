import { TestBed } from '@angular/core/testing';
import {
  Translation,
  TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import {
  AccountsErrorCode,
  BookingErrorCode,
  CompleteRegistrationRefusalCode,
  EngagementErrorCode,
  IdentityErrorCode,
  PhoneErrorCode,
  PhoneInvalidReason,
  RepositoryErrorCode,
  SchedulingErrorCode,
} from '@core/errors';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import en from '../assets/i18n/en.json';
import bg from '../assets/i18n/bg.json';
import { translateCodedError } from './translate-coded-error';

const CATALOGS = new Map<string, Translation>([
  ['en', en],
  ['bg', bg],
]);

class FixtureLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(CATALOGS.get(lang) as Translation);
  }
}

/** One row of the Phase 4b succession table (phase-4b-delete.md §2). */
interface SuccessorRow {
  readonly row: number;
  /** The successor key under `errors`, as the catalogue spells it. */
  readonly key: string;
  readonly error: { readonly errorCode: string } & Record<string, unknown>;
  readonly reason?: PhoneInvalidReason;
  readonly enWords: string;
  readonly bgWords: string;
}

const coded = (
  row: number,
  errorCode: string,
  enWords: string,
  bgWords: string,
): SuccessorRow => ({
  row,
  key: errorCode,
  error: { errorCode },
  enWords,
  bgWords,
});

const PHONE_EXAMPLE = '088 123 4567';

const phoned = (
  row: number,
  reason: PhoneInvalidReason,
  enWords: string,
  bgWords: string,
): SuccessorRow => ({
  row,
  key: `${PhoneErrorCode.Invalid}.${reason}`,
  error: { errorCode: PhoneErrorCode.Invalid, example: PHONE_EXAMPLE },
  reason,
  enWords,
  bgWords,
});

const SUCCESSOR_WORDS: readonly SuccessorRow[] = [
  coded(
    1,
    AccountsErrorCode.UploadAvatarUploadFailed,
    "We couldn't upload the photo. Try again.",
    'Не успяхме да качим снимката. Опитай пак.',
  ),
  coded(
    2,
    AccountsErrorCode.RemoveAvatarRemoveFailed,
    "We couldn't remove the photo. Try again.",
    'Не успяхме да премахнем снимката. Опитай пак.',
  ),
  coded(
    3,
    AccountsErrorCode.UpdateProfileRepositoryFailure,
    "We couldn't save that right now. Try again.",
    'Не успяхме да запазим това. Опитай пак.',
  ),
  coded(
    4,
    IdentityErrorCode.IdentifierMissing,
    "We couldn't find your phone number or email. Sign in again.",
    'Не намерихме телефонния ти номер или имейл. Влез отново.',
  ),
  coded(
    5,
    IdentityErrorCode.CallFailed,
    'Something went wrong. Try again.',
    'Нещо се обърка. Опитай пак.',
  ),
  coded(
    6,
    AccountsErrorCode.RepositoryFailure,
    'Something went wrong on our end. Try again.',
    'Нещо се обърка от наша страна. Опитай пак.',
  ),
  coded(
    7,
    EngagementErrorCode.RepositoryFailure,
    'Something went wrong on our end. Try again.',
    'Нещо се обърка от наша страна. Опитай пак.',
  ),
  phoned(
    8,
    PhoneInvalidReason.NotANumber,
    `Enter a phone number, like ${PHONE_EXAMPLE}.`,
    `Въведи телефонен номер, например ${PHONE_EXAMPLE}.`,
  ),
  phoned(
    9,
    PhoneInvalidReason.TooShort,
    `This number looks too short — for example, ${PHONE_EXAMPLE}.`,
    `Този номер изглежда твърде кратък — например ${PHONE_EXAMPLE}.`,
  ),
  phoned(
    10,
    PhoneInvalidReason.TooLong,
    `This number looks too long — for example, ${PHONE_EXAMPLE}.`,
    `Този номер изглежда твърде дълъг — например ${PHONE_EXAMPLE}.`,
  ),
  phoned(
    11,
    PhoneInvalidReason.InvalidCountry,
    `We don't recognize that country code — for example, ${PHONE_EXAMPLE}.`,
    `Не разпознаваме този телефонен код — например ${PHONE_EXAMPLE}.`,
  ),
  phoned(
    12,
    PhoneInvalidReason.Invalid,
    `This doesn't look like a valid phone number — for example, ${PHONE_EXAMPLE}.`,
    `Този номер не изглежда валиден — например ${PHONE_EXAMPLE}.`,
  ),
  coded(
    13,
    BookingErrorCode.CallFailed,
    'Something went wrong. Try again.',
    'Нещо се обърка. Опитай пак.',
  ),
  coded(
    14,
    BookingErrorCode.TransitionSeatResolved,
    'That seat is already settled.',
    'Това място вече е приключено.',
  ),
];

describe('translateCodedError', () => {
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
      translateCodedError(transloco, {
        errorCode: SchedulingErrorCode.ContactInvalidEmail,
        rawValue: 'nope',
      }),
    ).toBe('"nope" is not a valid email address.');
  });

  it('resolves a real code to the bg catalog string', async () => {
    await transloco.load('bg').toPromise();
    transloco.setActiveLang('bg');

    expect(
      translateCodedError(transloco, {
        errorCode: SchedulingErrorCode.ContactInvalidEmail,
        rawValue: 'nope',
      }),
    ).toBe('„nope“ не е валиден имейл адрес.');
  });

  it('reads an ecs-core struct: errors.<errorCode>, the struct as its params (en)', async () => {
    await transloco.load('en').toPromise();
    transloco.setActiveLang('en');

    expect(
      translateCodedError(transloco, {
        errorCode: 'DST_GAP_INVALID_TIME',
        localDate: '2026-03-29',
        minute: 210,
        timeZone: 'Europe/Sofia',
      }),
    ).toBe(
      "2026-03-29T03:30 doesn't exist in Europe/Sofia — the clocks jump past it. Pick another time.",
    );
    expect(
      translateCodedError(transloco, {
        errorCode: 'TIME_INVALID_TIME_ZONE',
        rawZone: 'Mars/Base',
      }),
    ).toBe('"Mars/Base" is not a valid time zone.');
    expect(
      translateCodedError(transloco, {
        errorCode: 'PRIMITIVE_ID_EMPTY',
        raw: '',
        brand: 'AppointmentId',
      }),
    ).toBe('Invalid value.');
  });

  it('reads an ecs-core struct in bg: errors.<errorCode>, the struct as its params', async () => {
    await transloco.load('bg').toPromise();
    transloco.setActiveLang('bg');

    expect(
      translateCodedError(transloco, {
        errorCode: 'TIME_INVALID_DATE_TIME',
        rawValue: 'x',
        dateTimeInvalidReason: 'UNPARSABLE',
      }),
    ).toBe('„x“ не е валидна дата и час.');
    expect(
      translateCodedError(transloco, {
        errorCode: 'DST_GAP_INVALID_TIME',
        localDate: '2026-03-29',
        minute: 210,
        timeZone: 'Europe/Sofia',
      }),
    ).toBe(
      '2026-03-29T03:30 не съществува в Europe/Sofia — часовникът го прескача. Избери друг час.',
    );
  });

  it('falls back to the raw errorCode for an unknown struct', async () => {
    await transloco.load('en').toPromise();
    transloco.setActiveLang('en');

    expect(
      translateCodedError(transloco, { errorCode: 'NOT_A_REAL_CODE' }),
    ).toBe('NOT_A_REAL_CODE');
  });

  it('reads a reason one level down: errors.<errorCode>.<reason>, the struct as its params (en, bg)', async () => {
    await transloco.load('en').toPromise();
    await transloco.load('bg').toPromise();
    const refusal = {
      errorCode: PhoneErrorCode.Invalid,
      example: '088 123 4567',
    };

    transloco.setActiveLang('en');
    expect(
      translateCodedError(transloco, refusal, PhoneInvalidReason.TooShort),
    ).toBe('This number looks too short — for example, 088 123 4567.');
    transloco.setActiveLang('bg');
    expect(
      translateCodedError(transloco, refusal, PhoneInvalidReason.TooShort),
    ).toBe('Този номер изглежда твърде кратък — например 088 123 4567.');
    // Every reason the dictionary declares keys its own words, as it is.
    for (const lang of ['en', 'bg']) {
      transloco.setActiveLang(lang);
      for (const reason of Object.values(PhoneInvalidReason)) {
        expect(translateCodedError(transloco, refusal, reason)).not.toBe(
          `${PhoneErrorCode.Invalid}.${reason}`,
        );
      }
    }
  });

  it('falls back to the raw <errorCode>.<reason> for a reason the catalogue has no words for', async () => {
    await transloco.load('en').toPromise();
    transloco.setActiveLang('en');

    expect(
      translateCodedError(
        transloco,
        { errorCode: PhoneErrorCode.Invalid, example: '088 123 4567' },
        'not-a-real-reason',
      ),
    ).toBe('PHONE_INVALID.not-a-real-reason');
  });

  // Every refusal the auth flow's OTP and registration callables answer with
  // — the SCREAMING successors (`legacy-wire-successors.spec.ts`) of the codes
  // the auth-flow legacy errors carried, each worded by the client through
  // `translateCodedError`. The ledger's dead `otp_validation_failed` left the
  // list with its row (no handler raises it, so it has no successor).
  const AUTH_FLOW_ERROR_CODES: readonly string[] = [
    IdentityErrorCode.InvalidInput,
    IdentityErrorCode.OtpRateLimited,
    IdentityErrorCode.RepositoryFailure,
    IdentityErrorCode.OtpSendFailure,
    IdentityErrorCode.OtpNotFound,
    IdentityErrorCode.OtpAlreadyConsumed,
    IdentityErrorCode.OtpExpired,
    IdentityErrorCode.OtpLockedOut,
    IdentityErrorCode.OtpWrongCode,
    CompleteRegistrationRefusalCode.ProfileInvalid,
    IdentityErrorCode.OtpDestinationCorrupted,
    IdentityErrorCode.TokenMintingFailure,
  ];

  it.each(AUTH_FLOW_ERROR_CODES)(
    'resolves auth-flow error code %s in en (not a raw-code fallback)',
    async (errorCode) => {
      await transloco.load('en').toPromise();
      transloco.setActiveLang('en');
      expect(translateCodedError(transloco, { errorCode })).not.toBe(errorCode);
    },
  );

  it.each(AUTH_FLOW_ERROR_CODES)(
    'resolves auth-flow error code %s in bg (not a raw-code fallback)',
    async (errorCode) => {
      await transloco.load('bg').toPromise();
      transloco.setActiveLang('bg');
      expect(translateCodedError(transloco, { errorCode })).not.toBe(errorCode);
    },
  );

  // Phase 4b retired the dotted keys only after every still-read one had a
  // SCREAMING successor holding its words (4B-1; the table is §2 of
  // `docs/architecture/flips/phase-4b-delete.md`) — the permanent pin of their
  // words, exact, in both locales; the phone rows through `reason`. The voice
  // pass (OR-51) re-worded them once, on purpose: «ти», no «моля» or
  // "please", and «Опитай пак» / "Try again" as the one retry phrase.
  it.each(SUCCESSOR_WORDS)(
    'the Phase 4b successors carry the retired keys’ words — §2 row $row, errors.$key',
    async ({ error, reason, enWords, bgWords }) => {
      await transloco.load('en').toPromise();
      await transloco.load('bg').toPromise();

      transloco.setActiveLang('en');
      expect(translateCodedError(transloco, error, reason)).toBe(enWords);
      transloco.setActiveLang('bg');
      expect(translateCodedError(transloco, error, reason)).toBe(bgWords);
    },
  );

  // The five store codes say what each one means (OR-54, DEP-F38) — no
  // longer all "couldn't save": a read, a write (or a create that met a
  // document already there), a store out of reach, and a record damaged for
  // good, which offers no retry because none can succeed.
  const REPOSITORY_WORDS: readonly (readonly [
    errorCode: string,
    enWords: string,
    bgWords: string,
  ])[] = [
    [
      RepositoryErrorCode.ReadFailed,
      "We couldn't load that. Try again.",
      'Не успяхме да заредим това. Опитай пак.',
    ],
    [
      RepositoryErrorCode.WriteFailed,
      "We couldn't save that. Try again.",
      'Не успяхме да запазим това. Опитай пак.',
    ],
    [
      RepositoryErrorCode.AlreadyExists,
      "We couldn't save that. Try again.",
      'Не успяхме да запазим това. Опитай пак.',
    ],
    [
      RepositoryErrorCode.Unavailable,
      "Can't connect right now. Try again in a moment.",
      'Няма връзка в момента. Опитай пак след малко.',
    ],
    [
      RepositoryErrorCode.Malformed,
      "This record is damaged and can't be used.",
      'Този запис е повреден и не може да се използва.',
    ],
  ];

  it.each(REPOSITORY_WORDS)(
    'words %s by what it means, in en and bg',
    async (errorCode, enWords, bgWords) => {
      await transloco.load('en').toPromise();
      await transloco.load('bg').toPromise();
      const refusal = { errorCode, path: 'appointments/a1' };

      transloco.setActiveLang('en');
      expect(translateCodedError(transloco, refusal)).toBe(enWords);
      transloco.setActiveLang('bg');
      expect(translateCodedError(transloco, refusal)).toBe(bgWords);
    },
  );

  // A throttled code request names the seconds left (OR-9, DEP-F8): the
  // copy's one parameter is `seconds`, which the lookup fills from the
  // refusal's own `retryAfterSeconds` — the struct as it is minted.
  it('names the seconds left before a new code may be asked for, in en and bg', async () => {
    await transloco.load('en').toPromise();
    await transloco.load('bg').toPromise();
    const throttled = {
      errorCode: IdentityErrorCode.OtpRateLimited,
      retryAfterSeconds: 42,
    };

    transloco.setActiveLang('en');
    expect(translateCodedError(transloco, throttled)).toBe(
      'We already sent you a code. You can ask for a new one in 42 s.',
    );
    transloco.setActiveLang('bg');
    expect(translateCodedError(transloco, throttled)).toBe(
      'Вече ти изпратихме код. Нов можеш да поискаш след 42 сек.',
    );
  });
});
