import {
  type ClientOperationId,
  CustomerId,
  Result,
  UtcEpochMs,
} from '@core/primitives';
import { type PipelineError } from '@core/errors';
import { CallAnswer } from './call-answer.data';

/** The export bundle's format version — bumped by any change of a section's shape or order. */
const EXPORT_VERSION = 1;

/**
 * THE PRIVACY WIRE (audit-hardening Phase 3, WS-C) — what the web sends to
 * an admin's data-subject callable (`exportClientData`; the erasure's
 * calls take the same struct): the client RECORD the request is about and
 * the act's own minted id, REQUIRED — one id per act, kept for a retry of
 * the same act, so a replay answers what the first call did. The server
 * adds the caller.
 */
export type ClientPrivacyCall = {
  readonly customerId: CustomerId;
  readonly operationId: ClientOperationId;
};

export const ClientPrivacyCall = {
  /** The bundle's format version — bumped by any change of a section's shape or order. */
  EXPORT_VERSION,

  /**
   * `exportClientData`'s answer, read through {@link CallAnswer}: every
   * field present and well-typed, the version this build reads — anything
   * else is `PIPELINE_UNKNOWN` (a bundle of another format is never handed
   * on as if it were this one). `exportJson` is kept byte for byte: the
   * browser saves it verbatim.
   */
  decodeExported(
    raw: unknown,
  ): Result<ClientPrivacyCall.Exported, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const clientExportVersion = CallAnswer.whole(
      answer,
      'clientExportVersion',
      1,
    );
    const exportedCustomerId = CallAnswer.parsed(
      answer,
      'exportedCustomerId',
      CustomerId.parse,
    );
    const exportedAt = CallAnswer.field(answer, 'exportedAtUtcMs');
    const exportedAtUtcMs =
      typeof exportedAt === 'number' ? UtcEpochMs.of(exportedAt) : null;
    const exportDocumentCount = CallAnswer.whole(
      answer,
      'exportDocumentCount',
      0,
    );
    const exportByteCount = CallAnswer.whole(answer, 'exportByteCount', 0);
    const exportJson = CallAnswer.text(answer, 'exportJson');
    if (
      clientExportVersion !== EXPORT_VERSION ||
      exportedCustomerId === null ||
      exportedAtUtcMs === null ||
      !exportedAtUtcMs.ok ||
      exportDocumentCount === null ||
      exportByteCount === null ||
      exportJson === null
    ) {
      return CallAnswer.unusable();
    }
    return Result.ok({
      clientExportVersion,
      exportedCustomerId,
      exportedAtUtcMs: exportedAtUtcMs.value,
      exportDocumentCount,
      exportByteCount,
      exportJson,
    });
  },
} as const;

export namespace ClientPrivacyCall {
  /**
   * `exportClientData`'s answer: the person's ONE JSON bundle as the
   * server's canonical text (`CanonicalJsonSystem.of`, sorted keys — decided
   * byte for byte on the server) beside its counts. Never a log field.
   */
  export type Exported = {
    /** `=== ClientPrivacyCall.EXPORT_VERSION` — the decoder refuses another. */
    readonly clientExportVersion: number;
    readonly exportedCustomerId: CustomerId;
    readonly exportedAtUtcMs: UtcEpochMs;
    /** The documents in the bundle, audit rows included. */
    readonly exportDocumentCount: number;
    /** The UTF-8 bytes of {@link Exported.exportJson}. */
    readonly exportByteCount: number;
    /** The canonical JSON of the bundle. */
    readonly exportJson: string;
  };
}
