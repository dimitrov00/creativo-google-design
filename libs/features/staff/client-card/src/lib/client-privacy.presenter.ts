import { type ClientPrivacyCall, ErasureOffer } from '@core/components';
import { type PipelineError, PipelineErrorCode } from '@core/errors';
import type { CustomerId } from '@core/primitives';
import {
  type TranslateCode,
  wordPipelineError,
} from '@creativo/infrastructure/i18n';
import type {
  ClientErasureWords,
  ClientPrivacyWords,
} from './client-card.words';
import {
  type ClientErasureAlertVm,
  ClientErasurePhase,
  type ClientErasureVm,
  ClientExportPhase,
  type ClientPrivacyVm,
  ErasureAlertAnswer,
} from './client-pages.vm';

/**
 * The card's export as the store holds it: the phase, and the refusal the
 * callable answered when it was refused.
 */
export type ClientExportState =
  | {
      readonly clientExportPhase: Exclude<
        ClientExportPhase,
        typeof ClientExportPhase.Refused
      >;
    }
  | {
      readonly clientExportPhase: typeof ClientExportPhase.Refused;
      readonly exportError: PipelineError;
    };

/** What the privacy block is worded from. */
export interface ClientPrivacyInput {
  /** The group's words in the card's language (`clientCard.privacy.*`). */
  readonly words: ClientPrivacyWords;
  /** Where the export stands. */
  readonly exportState: ClientExportState;
  /** `errors.<code>` in the card's language, the code itself when the catalogue has none. */
  readonly translateCode: TranslateCode;
}

/**
 * L «Лични данни» (audit-hardening Phase 3, WS-C) — the admin's privacy
 * block in words. Whether the block exists at all (the port, the flag, an
 * admin viewer, a known record, the network) is the store's gate; this
 * words what it is handed and decides nothing: the phase picks its line,
 * and a refusal is said in the server's own words when the catalogue has
 * them (`wordPipelineError`), else the generic `PIPELINE_UNKNOWN` line.
 */
export function clientPrivacyVm(input: ClientPrivacyInput): ClientPrivacyVm {
  const { words } = input;
  return {
    groupLabel: words.groupLabel,
    exportLabel: words.export,
    exportStatus: exportStatusOf(input),
  };
}

/** The line under the export row: nothing while idle or on its way. */
function exportStatusOf(input: ClientPrivacyInput): string | null {
  const state = input.exportState;
  switch (state.clientExportPhase) {
    case ClientExportPhase.Idle:
    case ClientExportPhase.Running:
      return null;
    case ClientExportPhase.Done:
      return input.words.exportDone;
    case ClientExportPhase.Refused:
      return wordPipelineError(
        state.exportError,
        input.translateCode,
        PipelineErrorCode.Unknown,
      );
  }
}

// ── The erasure (audit-hardening Phase 3, WS-D) ─────────────────────────

/**
 * The card's erasure act as the store holds it: the phase, and the refusal
 * the callable answered when it was refused.
 */
export type ClientErasureState =
  | {
      readonly clientErasurePhase: Exclude<
        ClientErasurePhase,
        typeof ClientErasurePhase.Refused
      >;
    }
  | {
      readonly clientErasurePhase: typeof ClientErasurePhase.Refused;
      readonly erasureError: PipelineError;
    };

/** What the erasure's rows and its ONE alert are worded from. */
export interface ClientErasureInput {
  /** The erasure's words in the card's language. */
  readonly words: ClientErasureWords;
  /** What the system offers for the record (`ClientPrivacySystem.erasureOffer`). */
  readonly offer: ErasureOffer;
  /** Where the act stands. */
  readonly erasureState: ClientErasureState;
  /** A previewed act waits for its answer: the alert is open. */
  readonly alertOpen: boolean;
  /** The last preview the alert was opened on — `null` before the first. */
  readonly preview: ClientPrivacyCall.ErasurePreview | null;
  /** The sibling records the record's last preview named, in its order. */
  readonly siblings: readonly CustomerId[];
  /**
   * The sibling records the alert's act names: for the card's own record
   * the list the card keeps (`ClientPrivacySystem.siblingsAfterPreview`),
   * for a sibling's own act its preview's list (P3-DEP-35).
   */
  readonly alertSiblings: readonly CustomerId[];
  /** `errors.<code>` in the card's language, the code itself when the catalogue has none. */
  readonly translateCode: TranslateCode;
}

/**
 * L — the erasure's rows (audit-hardening Phase 3, WS-D, P3-DEP-22) in
 * words. It decides nothing (Law 10.2): the system's offer picks the
 * record's lines — `ERASE` and `RESWEEP` the one erase row, `RESWEEP`
 * beside the erased line, `RESUME` the same row with the unfinished line —
 * the act's phase picks the status (a refusal in the server's own words,
 * else the generic `PIPELINE_UNKNOWN` line), and the alert's figures are
 * the server's census counts as they came (visits, notes, photos, sign-in
 * accounts) and the number of sibling records the act names (the store's
 * `alertSiblings` — the rows the card shows for its own record).
 */
export function clientErasureVm(input: ClientErasureInput): ClientErasureVm {
  const { words } = input;
  return {
    eraseLabel: words.erase,
    erasedLine: input.offer === ErasureOffer.Resweep ? words.erased : null,
    eraseStatus: eraseStatusOf(input),
    siblings: input.siblings.map((customerId, index) => ({
      customerId,
      label: words.eraseSibling,
      testId: `client-privacy-sibling-${index + 1}`,
    })),
    alert: alertOf(input),
  };
}

/** The line under the erasure's rows: the act's outcome first, else what the offer says. */
function eraseStatusOf(input: ClientErasureInput): string | null {
  const state = input.erasureState;
  switch (state.clientErasurePhase) {
    case ClientErasurePhase.Previewing:
    case ClientErasurePhase.Running:
      return null;
    case ClientErasurePhase.Unfinished:
      return input.words.eraseUnfinished;
    case ClientErasurePhase.Refused:
      return wordPipelineError(
        state.erasureError,
        input.translateCode,
        PipelineErrorCode.Unknown,
      );
    case ClientErasurePhase.Idle:
      return input.offer === ErasureOffer.Resume
        ? input.words.eraseUnfinished
        : null;
  }
}

/** The ONE alert: the question, the preview's figures, the destructive answer first and the safe one last. */
function alertOf(input: ClientErasureInput): ClientErasureAlertVm {
  const { words, preview } = input;
  return {
    open: input.alertOpen,
    title: words.alertTitle,
    body:
      preview === null
        ? null
        : words.alertBody({
            visits: preview.erasureVisitCount,
            notes: preview.erasureNoteCount,
            photos: preview.erasurePhotoCount,
            accounts: preview.erasureAccountCount,
            siblings: input.alertSiblings.length,
          }),
    actions: [
      {
        id: ErasureAlertAnswer.Erase,
        label: words.eraseConfirm,
        role: 'destructive',
        preferred: false,
        testId: 'client-privacy-erase-confirm',
      },
      {
        id: ErasureAlertAnswer.Keep,
        label: words.eraseKeep,
        role: 'cancel',
        preferred: true,
        testId: 'client-privacy-erase-keep',
      },
    ],
  };
}
