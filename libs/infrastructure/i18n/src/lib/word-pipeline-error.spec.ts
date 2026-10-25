import { TestBed } from '@angular/core/testing';
import {
  Translation,
  TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { BookingStatus } from '@core/primitives';
import {
  BookingErrorCode,
  CancellationRefusalCode,
  HttpsStatus,
  IdentityErrorCode,
  MoveErrorCode,
  PipelineError,
  PipelineErrorCode,
  StaffEditErrorCode,
  TimeErrorCode,
} from '@core/errors';
import bg from '../assets/i18n/bg.json';
import en from '../assets/i18n/en.json';
import { bookingStatusWords } from './booking-status-words';
import { translateCodedError } from './translate-coded-error';
import { wordPipelineError } from './word-pipeline-error';

/*
 * The cases of the legacy `wordError` (`booking-gateway.port.spec.ts`,
 * deleted in Phase 4b; ledger `docs/architecture/flips/phase-4b-delete.md`
 * §11.1), on the flipped vocabulary — plus the two consuming surfaces' copy
 * and the staff day's transition sentence, byte for byte in bg and en.
 */

/** A catalogue as a lookup: copy for the codes it knows, the code itself else. */
function catalogue(copy: Readonly<Record<string, string>>) {
  const known = new Map(Object.entries(copy));
  const asked: string[] = [];
  return {
    asked,
    translate: (code: string): string => {
      asked.push(code);
      return known.get(code) ?? code;
    },
  };
}

/** The real catalogue's `errors.<code>`, interpolated — `translateCodedError`'s contract. */
function errorsOf(errors: Readonly<Record<string, unknown>>) {
  return (code: string, params: Readonly<Record<string, unknown>>): string => {
    const template = Object.getOwnPropertyDescriptor(errors, code)?.value;
    if (typeof template !== 'string') return code;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(Object.getOwnPropertyDescriptor(params, name)?.value ?? ''),
    );
  };
}

const wired = (
  serverErrorCode: string,
  reason: { readonly refusal?: string; readonly field?: string } = {},
  serverParams: Readonly<Record<string, string | number>> = {},
): PipelineError => ({
  ...PipelineError.of(
    PipelineErrorCode.InvalidRequest,
    serverErrorCode,
    reason.refusal ?? null,
    reason.field ?? null,
  ),
  serverParams,
});

describe('wordPipelineError — the most specific words the catalogue has', () => {
  it('tries the server’s code one level deep, then the code, then the surface’s own', () => {
    const words = catalogue({ [BookingErrorCode.CallFailed]: 'generic' });
    const error = wired(BookingErrorCode.InvalidInput, {
      field: 'person_overlap',
    });
    expect(
      wordPipelineError(error, words.translate, BookingErrorCode.CallFailed),
    ).toBe('generic');
    expect(words.asked).toEqual([
      'BOOKING_INVALID_INPUT.person_overlap',
      'BOOKING_INVALID_INPUT',
      BookingErrorCode.CallFailed,
    ]);
  });

  it('stops at the first code with copy', () => {
    const words = catalogue({
      BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE: 'carried',
      'BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE.shop_only': 'shop only',
    });
    const refused = (refusal: string) =>
      wired(MoveErrorCode.CarriedSeatUnplaceable, { refusal });
    expect(wordPipelineError(refused('shop_only'), words.translate, 'x')).toBe(
      'shop only',
    );
    // A reason the catalogue does not know yet is the code's own copy.
    expect(wordPipelineError(refused('newer'), words.translate, 'x')).toBe(
      'carried',
    );
  });

  it('words a server code that names no reason by itself — the retryable cancel', () => {
    const words = catalogue({
      BOOKING_CANCEL_POLICY_UNAVAILABLE: 'try again in a moment',
      [BookingErrorCode.CallFailed]: 'generic',
    });
    const error = {
      ...PipelineError.of(
        PipelineErrorCode.Unavailable,
        CancellationRefusalCode.PolicyUnavailable,
        null,
        null,
      ),
    };
    expect(
      wordPipelineError(error, words.translate, BookingErrorCode.CallFailed),
    ).toBe('try again in a moment');
  });

  it('is the surface’s own code when the server sent none', () => {
    const words = catalogue({ [BookingErrorCode.CallFailed]: 'generic' });
    expect(
      wordPipelineError(
        PipelineError.bare(PipelineErrorCode.Unavailable),
        words.translate,
        BookingErrorCode.CallFailed,
      ),
    ).toBe('generic');
    expect(words.asked).toEqual([BookingErrorCode.CallFailed]);
  });
});

describe('wordPipelineError — today’s copy, in the real catalogues', () => {
  it('words the closed cancellation window with its hours and the surface’s reach (appointments page)', () => {
    const error = wired(
      CancellationRefusalCode.WindowClosed,
      {},
      {
        windowHours: 24,
      },
    );
    expect(
      wordPipelineError(
        error,
        errorsOf(en.errors),
        BookingErrorCode.CallFailed,
        {
          reach: en.booking.reach.call,
        },
      ),
    ).toBe(
      'Free cancellation ends 24 h before the appointment — call the shop.',
    );
    expect(
      wordPipelineError(
        error,
        errorsOf(bg.errors),
        BookingErrorCode.CallFailed,
        {
          reach: bg.booking.reach.call,
        },
      ),
    ).toBe(
      `Безплатното отказване е до 24 ч. преди часа — ${bg.booking.reach.call}.`,
    );
  });

  it('words a lost slot on the review step', () => {
    expect(
      wordPipelineError(
        wired(BookingErrorCode.SlotUnavailable),
        errorsOf(en.errors),
        BookingErrorCode.CallFailed,
      ),
    ).toBe('That time is already taken.');
  });

  it('words the staff day’s refused transition with today’s lowercase words — exact bg and en', () => {
    const error = wired(
      BookingErrorCode.TransitionNotAllowed,
      {},
      {
        fromBookingStatus: BookingStatus.Completed,
        toBookingStatus: BookingStatus.Confirmed,
      },
    );
    const words = {
      from: bookingStatusWords[BookingStatus.Completed],
      to: bookingStatusWords[BookingStatus.Confirmed],
    };
    expect(
      wordPipelineError(
        error,
        errorsOf(en.errors),
        IdentityErrorCode.CallFailed,
        words,
      ),
    ).toBe('The appointment cannot move from "completed" to "confirmed".');
    expect(
      wordPipelineError(
        error,
        errorsOf(bg.errors),
        IdentityErrorCode.CallFailed,
        words,
      ),
    ).toBe('Часът не може да мине от „completed“ към „confirmed“.');
  });
});

/**
 * One refusal a web surface can receive that had no `errors.<code>` words
 * before pass E (E-18, DEP-8): the status the edge answers it with
 * (`apps/functions/src/edge.ts`), the surface's own fallback, and its words
 * in both catalogues. Before, the staff day and the appointments page printed
 * their generic copy for these, and the onboarding flow the raw code.
 */
type WordedRefusal = {
  readonly errorCode: string;
  readonly status: HttpsStatus;
  readonly fallbackCode: string;
  readonly en: string;
  readonly bg: string;
};

const SIGN_IN_AGAIN = {
  en: 'Sign in again to continue.',
  bg: 'Влез отново, за да продължиш.',
} as const;
const STAFF_ONLY = {
  en: 'Only staff can do that.',
  bg: 'Само служители могат да правят това.',
} as const;
const NOT_VALID = {
  en: 'That request is not valid.',
  bg: 'Заявката не е валидна.',
} as const;
const GONE = {
  en: 'That appointment no longer exists.',
  bg: 'Този час вече не съществува.',
} as const;

type Words = { readonly en: string; readonly bg: string };

/** A refusal worded against `fallbackCode` — the copy its surface printed before. */
const refusalOn =
  (fallbackCode: string) =>
  (errorCode: string, status: HttpsStatus, words: Words): WordedRefusal => ({
    errorCode,
    status,
    fallbackCode,
    ...words,
  });

/**
 * The appointments page's cancel (`client-appointments.ts`,
 * `translateCancelError`) and the staff day's callables (`staff-dashboard.ts`,
 * `describeError`): their generic copy is `BOOKING_CALL_FAILED`.
 */
const booking = refusalOn(BookingErrorCode.CallFailed);
/**
 * The onboarding flow's registration (`wordFlowFailure`, which printed the
 * raw code for these): the identity flows' generic copy stands in as the
 * fallback here.
 */
const identity = refusalOn(IdentityErrorCode.CallFailed);

const S = HttpsStatus;

const E18_WORDS: readonly WordedRefusal[] = [
  // The appointments page's cancel.
  booking(CancellationRefusalCode.NotCancellable, S.FailedPrecondition, {
    en: 'This appointment can no longer be cancelled.',
    bg: 'Този час вече не може да се откаже.',
  }),
  booking(
    CancellationRefusalCode.Unauthenticated,
    S.Unauthenticated,
    SIGN_IN_AGAIN,
  ),
  booking(CancellationRefusalCode.InvalidInput, S.InvalidArgument, NOT_VALID),
  booking(CancellationRefusalCode.NotFound, S.NotFound, GONE),
  // The staff day: the walk-in commit, the lifecycle moves, the arrival, the
  // tip and the visit editor's save.
  booking(BookingErrorCode.CommitForbidden, S.PermissionDenied, STAFF_ONLY),
  booking(BookingErrorCode.TransitionReopenWindowClosed, S.FailedPrecondition, {
    en: 'A settled appointment can only be reopened on its own day.',
    bg: 'Приключен час може да се отвори отново само в същия ден.',
  }),
  booking(BookingErrorCode.TransitionSlotTaken, S.FailedPrecondition, {
    en: "That time was taken in the meantime, so the appointment can't be restored.",
    bg: 'Този час междувременно е зает, затова не може да се възстанови.',
  }),
  booking(
    BookingErrorCode.ArrivedUnauthenticated,
    S.Unauthenticated,
    SIGN_IN_AGAIN,
  ),
  booking(BookingErrorCode.ArrivedForbidden, S.PermissionDenied, STAFF_ONLY),
  booking(BookingErrorCode.ArrivedInvalidInput, S.InvalidArgument, NOT_VALID),
  booking(BookingErrorCode.ArrivedNotFound, S.NotFound, GONE),
  booking(BookingErrorCode.ArrivedNotAllowed, S.FailedPrecondition, {
    en: "A settled appointment's arrival can't be changed.",
    bg: 'Пристигането на приключен час не може да се променя.',
  }),
  booking(
    BookingErrorCode.TipUnauthenticated,
    S.Unauthenticated,
    SIGN_IN_AGAIN,
  ),
  booking(BookingErrorCode.TipForbidden, S.PermissionDenied, STAFF_ONLY),
  booking(BookingErrorCode.TipInvalidInput, S.InvalidArgument, NOT_VALID),
  booking(BookingErrorCode.TipNotFound, S.NotFound, {
    en: 'That appointment or seat no longer exists.',
    bg: 'Този час или това място вече не съществува.',
  }),
  booking(StaffEditErrorCode.Unauthenticated, S.Unauthenticated, SIGN_IN_AGAIN),
  // The onboarding flow's registration.
  identity(IdentityErrorCode.RegistrationUserNotFound, S.FailedPrecondition, {
    en: "We couldn't find your profile — please sign in again.",
    bg: 'Не открихме профила ви — моля, влезте отново.',
  }),
  // `internal` on the wire, but its details reach the flow, which printed
  // the raw code (`wordFlowFailure`): worded like the identity flows' other
  // "our side" failures (`IDENTITY_TOKEN_MINTING_FAILURE`).
  identity(IdentityErrorCode.ClaimsPromotionFailure, S.Internal, {
    en: "We couldn't finish your registration — please try again.",
    bg: 'Не успяхме да завършим регистрацията ви — моля, опитайте отново.',
  }),
];

describe('wordPipelineError — every UI-reachable refusal words as itself (E-18)', () => {
  it.each(E18_WORDS)(
    'words $errorCode in its own en and bg words, not the surface’s fallback',
    ({ errorCode, status, fallbackCode, en: enWords, bg: bgWords }) => {
      const refused = PipelineError.fromWire(`functions/${status}`, {
        errorCode,
      });
      expect(refused.serverErrorCode).toBe(errorCode);
      expect(
        wordPipelineError(refused, errorsOf(en.errors), fallbackCode),
      ).toBe(enWords);
      expect(
        wordPipelineError(refused, errorsOf(bg.errors), fallbackCode),
      ).toBe(bgWords);
    },
  );
});

const CATALOGUES = new Map<string, Translation>([
  ['en', en],
  ['bg', bg],
]);

class CatalogueLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(CATALOGUES.get(lang) as Translation);
  }
}

describe('wordPipelineError — the DST gap end to end, wire to words', () => {
  let transloco: TranslocoService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideTransloco({
          config: { availableLangs: ['en', 'bg'], defaultLang: 'en' },
          loader: CatalogueLoader,
        }),
      ],
    });
    transloco = TestBed.inject(TranslocoService);
  });

  // The callable refuses a wall clock the spring-forward erased; its
  // allowlisted details (`localDate`, `minute`, `timeZone`) ride the wire
  // into `PipelineError.serverParams` (`pipeline.error.spec.ts`), and the
  // surface's translate step — `translateCodedError`, as the review step and
  // the staff day call it — adds the `wallClock` the copy names.
  it.each([
    [
      'en',
      "2027-03-28T03:30 doesn't exist in Europe/Sofia — the clocks jump past it. Pick another time.",
    ],
    [
      'bg',
      '2027-03-28T03:30 не съществува в Europe/Sofia — часовникът го прескача. Избери друг час.',
    ],
  ])(
    'words the refused 03:30 with its wall clock and zone in %s',
    async (lang, sentence) => {
      await firstValueFrom(transloco.load(lang));
      transloco.setActiveLang(lang);
      const refused = PipelineError.fromWire('functions/invalid-argument', {
        errorCode: TimeErrorCode.DstGap,
        localDate: '2027-03-28',
        minute: 210,
        timeZone: 'Europe/Sofia',
      });

      expect(
        wordPipelineError(
          refused,
          (code, params) =>
            translateCodedError(transloco, { ...params, errorCode: code }),
          BookingErrorCode.CallFailed,
        ),
      ).toBe(sentence);
    },
  );
});
