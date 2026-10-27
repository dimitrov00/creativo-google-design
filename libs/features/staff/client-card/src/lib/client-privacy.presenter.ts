import { type PipelineError, PipelineErrorCode } from '@core/errors';
import {
  type TranslateCode,
  wordPipelineError,
} from '@creativo/infrastructure/i18n';
import type { ClientPrivacyWords } from './client-card.words';
import { ClientExportPhase, type ClientPrivacyVm } from './client-pages.vm';

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
