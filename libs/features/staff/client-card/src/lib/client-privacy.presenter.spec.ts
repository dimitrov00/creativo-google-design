import { describe, expect, it } from 'vitest';
import {
  type ClientPrivacyCall,
  ErasureCensus,
  ErasureOffer,
  ErasureStatus,
} from '@core/components';
import {
  HttpsStatus,
  PipelineError,
  PipelineErrorCode,
  PrivacyErrorCode,
} from '@core/errors';
import { deepFreeze } from '@core/testing';
import type { TranslateCode } from '@creativo/infrastructure/i18n';
import { catalogueOf, wordsOf } from '../testing/client-card.fixtures';
import { CustomerId } from '@core/primitives';
import {
  type ClientErasureInput,
  type ClientErasureState,
  type ClientExportState,
  type ClientPrivacyInput,
  clientErasureVm,
  clientPrivacyVm,
} from './client-privacy.presenter';
import {
  ClientErasurePhase,
  ClientExportPhase,
  ErasureAlertAnswer,
} from './client-pages.vm';

/** `errors.<code>` from the real catalogue, the code itself when it has none (`translateCodedError`'s contract). */
function errorsOf(lang: 'bg' | 'en'): TranslateCode {
  const errors = new Map(
    Object.entries(catalogueOf(lang)['errors'] as Record<string, string>),
  );
  return (code) => errors.get(code) ?? code;
}

function inputOf(
  lang: 'bg' | 'en',
  exportState: ClientExportState,
): ClientPrivacyInput {
  return {
    words: wordsOf(lang).privacy,
    exportState,
    translateCode: errorsOf(lang),
  };
}

const refusedWith = (errorCode: string, status: HttpsStatus) =>
  ({
    clientExportPhase: ClientExportPhase.Refused,
    exportError: PipelineError.fromWire(`functions/${status}`, { errorCode }),
  }) as const;

describe('clientPrivacyVm — «Лични данни» (audit-hardening Phase 3, WS-C)', () => {
  it('words the group and its export, with no line while idle or on its way', () => {
    for (const phase of [ClientExportPhase.Idle, ClientExportPhase.Running]) {
      expect(
        clientPrivacyVm(inputOf('bg', { clientExportPhase: phase })),
      ).toEqual({
        groupLabel: 'Лични данни',
        exportLabel: 'Изтегли данните',
        exportStatus: null,
      });
      expect(
        clientPrivacyVm(inputOf('en', { clientExportPhase: phase })),
      ).toEqual({
        groupLabel: 'Personal data',
        exportLabel: 'Download the data',
        exportStatus: null,
      });
    }
  });

  it('says the file is downloaded once the export is done', () => {
    const done = { clientExportPhase: ClientExportPhase.Done } as const;
    expect(clientPrivacyVm(inputOf('bg', done)).exportStatus).toBe(
      'Файлът е изтеглен.',
    );
    expect(clientPrivacyVm(inputOf('en', done)).exportStatus).toBe(
      'The file is downloaded.',
    );
  });

  it('words a refusal in the server’s own words (wordPipelineError)', () => {
    const tooLarge = refusedWith(
      PrivacyErrorCode.ExportTooLarge,
      HttpsStatus.FailedPrecondition,
    );
    expect(clientPrivacyVm(inputOf('bg', tooLarge)).exportStatus).toBe(
      'Данните са твърде много за един файл. Свържи се с поддръжката.',
    );
    expect(clientPrivacyVm(inputOf('en', tooLarge)).exportStatus).toBe(
      "There's too much data for one file. Contact support.",
    );
    const forbidden = refusedWith(
      PrivacyErrorCode.Forbidden,
      HttpsStatus.PermissionDenied,
    );
    expect(clientPrivacyVm(inputOf('bg', forbidden)).exportStatus).toBe(
      'Нямаш права за това. Влез отново или питай администратора.',
    );
    const off = refusedWith(
      PrivacyErrorCode.Unavailable,
      HttpsStatus.FailedPrecondition,
    );
    expect(clientPrivacyVm(inputOf('en', off)).exportStatus).toBe(
      "This isn't on for the shop yet.",
    );
    const gone = refusedWith(
      PrivacyErrorCode.ClientNotFound,
      HttpsStatus.NotFound,
    );
    expect(clientPrivacyVm(inputOf('bg', gone)).exportStatus).toBe(
      'Не намерихме този клиент.',
    );
  });

  it('falls back to the generic line for a refusal with no words of its own, or none from the server', () => {
    const invalid = refusedWith(
      PrivacyErrorCode.InvalidInput,
      HttpsStatus.InvalidArgument,
    );
    expect(clientPrivacyVm(inputOf('bg', invalid)).exportStatus).toBe(
      'Нещо се обърка. Опитай пак.',
    );
    const unreachable = {
      clientExportPhase: ClientExportPhase.Refused,
      exportError: PipelineError.bare(PipelineErrorCode.Unavailable),
    } as const;
    expect(clientPrivacyVm(inputOf('en', unreachable)).exportStatus).toBe(
      'Something went wrong. Try again.',
    );
  });

  it('is pure: the same input gives the same output and is left untouched', () => {
    const input = deepFreeze(
      inputOf(
        'bg',
        refusedWith(PrivacyErrorCode.Forbidden, HttpsStatus.PermissionDenied),
      ),
    );
    expect(clientPrivacyVm(input)).toEqual(clientPrivacyVm(input));
  });
});

// ── The erasure (audit-hardening Phase 3, WS-D) ─────────────────────────

const SIBLING_A = CustomerId.of('cus_aaaaaaaaaaaaaaaaaaaa');
const SIBLING_B = CustomerId.of('cus_bbbbbbbbbbbbbbbbbbbb');

/** A preview's census: 1 200 visits, 2 notes, 3 photos, one sign-in account, two siblings. */
const PREVIEW: ClientPrivacyCall.ErasurePreview = {
  ...ErasureCensus.EMPTY,
  erasureStatus: ErasureStatus.None,
  erasureRecordCount: 1,
  erasureAccountCount: 1,
  erasureContactCount: 9,
  erasureVisitCount: 1200,
  erasureNoteCount: 2,
  erasurePhotoCount: 3,
  erasureSiblingCustomerIds: [SIBLING_A, SIBLING_B],
};

const IDLE = { clientErasurePhase: ClientErasurePhase.Idle } as const;

function erasureInputOf(
  lang: 'bg' | 'en',
  overrides: Partial<ClientErasureInput> = {},
): ClientErasureInput {
  return {
    words: wordsOf(lang).erasure,
    offer: ErasureOffer.Erase,
    erasureState: IDLE,
    alertOpen: false,
    preview: null,
    siblings: [],
    alertSiblings: [],
    translateCode: errorsOf(lang),
    ...overrides,
  };
}

const erasureRefusedWith = (
  errorCode: string,
  status: HttpsStatus,
): ClientErasureState => ({
  clientErasurePhase: ClientErasurePhase.Refused,
  erasureError: PipelineError.fromWire(`functions/${status}`, { errorCode }),
});

describe('clientErasureVm — the erasure’s rows and its ONE alert (audit-hardening Phase 3, WS-D)', () => {
  it('words the erase row per the system’s offer: ERASE alone, RESUME with the unfinished line, RESWEEP beside the erased line', () => {
    const erase = clientErasureVm(erasureInputOf('bg'));
    expect(erase.eraseLabel).toBe('Изтрий личните данни');
    expect(erase.erasedLine).toBeNull();
    expect(erase.eraseStatus).toBeNull();

    const resume = clientErasureVm(
      erasureInputOf('bg', { offer: ErasureOffer.Resume }),
    );
    expect(resume.eraseLabel).toBe('Изтрий личните данни');
    expect(resume.erasedLine).toBeNull();
    expect(resume.eraseStatus).toBe(
      'Изтриването още не е завършило. Опитай пак.',
    );

    const resweep = clientErasureVm(
      erasureInputOf('en', { offer: ErasureOffer.Resweep }),
    );
    expect(resweep.eraseLabel).toBe('Erase personal data');
    expect(resweep.erasedLine).toBe('Erased client');
    expect(resweep.eraseStatus).toBeNull();
  });

  it('words the alert: the question, the five figures, the destructive answer first and the safe one last and preferred', () => {
    const bg = clientErasureVm(
      erasureInputOf('bg', {
        alertOpen: true,
        preview: PREVIEW,
        siblings: PREVIEW.erasureSiblingCustomerIds,
        alertSiblings: PREVIEW.erasureSiblingCustomerIds,
      }),
    ).alert;
    expect(bg).toEqual({
      open: true,
      title: 'Да изтрием ли личните данни?',
      body:
        'Посещения: 1200 · Бележки: 2 · Снимки: 3 · Профили за вход: 1 · ' +
        'Други записи със същия телефон или имейл: 2. Името, телефонът и ' +
        'имейлът изчезват, профилът за вход се изтрива. Посещенията и ' +
        'плащанията остават.',
      actions: [
        {
          id: ErasureAlertAnswer.Erase,
          label: 'Изтрий',
          role: 'destructive',
          preferred: false,
          testId: 'client-privacy-erase-confirm',
        },
        {
          id: ErasureAlertAnswer.Keep,
          label: 'Отказ',
          role: 'cancel',
          preferred: true,
          testId: 'client-privacy-erase-keep',
        },
      ],
    });
    const en = clientErasureVm(
      erasureInputOf('en', {
        alertOpen: true,
        preview: PREVIEW,
        alertSiblings: PREVIEW.erasureSiblingCustomerIds,
      }),
    ).alert;
    expect(en.title).toBe('Erase personal data?');
    expect(en.body).toBe(
      'Visits: 1,200 · Notes: 2 · Photos: 3 · Sign-in accounts: 1 · ' +
        'Other records with this phone or e-mail: 2. The name, phone and ' +
        'e-mail are removed and the sign-in account is deleted. Visits and ' +
        'payments stay.',
    );
    expect(en.actions.map((action) => action.label)).toEqual([
      'Erase',
      'Cancel',
    ]);
  });

  it('counts the siblings the act names (the store’s list), not the preview’s — a preview after the stamp names none while the card keeps two rows (P3-DEP-35)', () => {
    const after: ClientPrivacyCall.ErasurePreview = {
      ...PREVIEW,
      erasureStatus: ErasureStatus.Erasing,
      erasureSiblingCustomerIds: [],
    };
    const input = {
      alertOpen: true,
      preview: after,
      siblings: [SIBLING_A, SIBLING_B],
      alertSiblings: [SIBLING_A, SIBLING_B],
    };
    expect(clientErasureVm(erasureInputOf('bg', input)).alert.body).toContain(
      'Други записи със същия телефон или имейл: 2.',
    );
    expect(clientErasureVm(erasureInputOf('en', input)).alert.body).toContain(
      'Other records with this phone or e-mail: 2.',
    );
  });

  it('keeps the alert worded once it closes, and has no figures before the first preview', () => {
    const closed = clientErasureVm(
      erasureInputOf('bg', { alertOpen: false, preview: PREVIEW }),
    ).alert;
    expect(closed.open).toBe(false);
    expect(closed.body).toContain('Посещения: 1200');
    expect(clientErasureVm(erasureInputOf('bg')).alert.body).toBeNull();
  });

  it('lists one row per sibling record, in the preview’s order, with no name', () => {
    const vm = clientErasureVm(
      erasureInputOf('bg', { siblings: [SIBLING_A, SIBLING_B] }),
    );
    expect(vm.siblings).toEqual([
      {
        customerId: SIBLING_A,
        label: 'Изтрий записа със същия телефон или имейл',
        testId: 'client-privacy-sibling-1',
      },
      {
        customerId: SIBLING_B,
        label: 'Изтрий записа със същия телефон или имейл',
        testId: 'client-privacy-sibling-2',
      },
    ]);
    expect(
      clientErasureVm(erasureInputOf('en', { siblings: [SIBLING_A] }))
        .siblings[0]?.label,
    ).toBe('Erase the record with the same phone or e-mail');
  });

  it('says nothing while the preview or the calls are on their way, and «not finished yet» when the calls ran out', () => {
    for (const phase of [
      ClientErasurePhase.Previewing,
      ClientErasurePhase.Running,
    ] as const) {
      expect(
        clientErasureVm(
          erasureInputOf('bg', {
            offer: ErasureOffer.Resume,
            erasureState: { clientErasurePhase: phase },
          }),
        ).eraseStatus,
      ).toBeNull();
    }
    expect(
      clientErasureVm(
        erasureInputOf('en', {
          erasureState: { clientErasurePhase: ClientErasurePhase.Unfinished },
        }),
      ).eraseStatus,
    ).toBe("The erasure isn't finished yet. Try again.");
  });

  it('words a refusal in the server’s own words, else the generic line', () => {
    const staff = erasureRefusedWith(
      PrivacyErrorCode.ErasureStaffAccount,
      HttpsStatus.FailedPrecondition,
    );
    expect(
      clientErasureVm(erasureInputOf('bg', { erasureState: staff }))
        .eraseStatus,
    ).toBe('Профил на служител не може да се изтрие оттук.');
    const mismatch = erasureRefusedWith(
      PrivacyErrorCode.AccountLinkMismatch,
      HttpsStatus.FailedPrecondition,
    );
    expect(
      clientErasureVm(erasureInputOf('en', { erasureState: mismatch }))
        .eraseStatus,
    ).toBe("The account doesn't match the client's record. Contact support.");
    const tooLarge = erasureRefusedWith(
      PrivacyErrorCode.ErasureTooLarge,
      HttpsStatus.FailedPrecondition,
    );
    expect(
      clientErasureVm(erasureInputOf('bg', { erasureState: tooLarge }))
        .eraseStatus,
    ).toBe(
      'Записите са твърде много за едно изтриване. Свържи се с поддръжката.',
    );
    const unreachable: ClientErasureState = {
      clientErasurePhase: ClientErasurePhase.Refused,
      erasureError: PipelineError.bare(PipelineErrorCode.Unavailable),
    };
    expect(
      clientErasureVm(erasureInputOf('bg', { erasureState: unreachable }))
        .eraseStatus,
    ).toBe('Нещо се обърка. Опитай пак.');
  });

  it('is pure: the same input gives the same output and is left untouched', () => {
    const input = deepFreeze(
      erasureInputOf('bg', {
        offer: ErasureOffer.Resweep,
        alertOpen: true,
        preview: PREVIEW,
        siblings: [SIBLING_A],
      }),
    );
    expect(clientErasureVm(input)).toEqual(clientErasureVm(input));
  });
});
