import { describe, expect, it } from 'vitest';
import {
  HttpsStatus,
  PipelineError,
  PipelineErrorCode,
  PrivacyErrorCode,
} from '@core/errors';
import { deepFreeze } from '@core/testing';
import type { TranslateCode } from '@creativo/infrastructure/i18n';
import { catalogueOf, wordsOf } from '../testing/client-card.fixtures';
import {
  type ClientExportState,
  type ClientPrivacyInput,
  clientPrivacyVm,
} from './client-privacy.presenter';
import { ClientExportPhase } from './client-pages.vm';

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
