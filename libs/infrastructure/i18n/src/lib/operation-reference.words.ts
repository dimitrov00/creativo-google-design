import type { ClientOperationId } from '@core/primitives';
import type { TranslateCode } from './word-pipeline-error';

/*
 * THE REFERENCE LINE (audit-hardening WS-4.5, RU-28) — the words a failed
 * call's surface prints under its own error sentence, so a person can read
 * out the operation id their report is traced by (the server logged every
 * line of that call under it). Words only: the id itself is the value the
 * surface prints and copies, which it already holds on its `PipelineError`
 * (`operationId`, stamped by the web's callable client). Beside
 * `wordPipelineError`, the ONE path every callable failure is worded by;
 * a wording helper (Law 10.4), pure — the translate step arrives as an input.
 */

/** The catalogue keys of the reference line — the `operation` namespace. */
const REFERENCE_KEY = 'operation.reference';
const COPIED_KEY = 'operation.referenceCopied';

/** The reference line's words: the line itself and its copy confirmation. */
export type OperationReferenceWords = {
  /** «Код за справка: <id>» / "Reference: <id>" — the id interpolated as `ref`. */
  readonly text: string;
  /** What the surface announces once the id is copied. */
  readonly copiedText: string;
};

/**
 * The reference line of a failed call, or `null` when the failure carries
 * no id (a client-side refusal, the issue sink, a call that sent none) — the
 * surface then prints no line at all. `translate` looks a catalogue key up
 * with its parameters (`transloco.translate`).
 */
export function operationReferenceWords(
  operationId: ClientOperationId | null,
  translate: TranslateCode,
): OperationReferenceWords | null {
  if (operationId === null) return null;
  return {
    text: translate(REFERENCE_KEY, { ref: operationId }),
    copiedText: translate(COPIED_KEY, {}),
  };
}
