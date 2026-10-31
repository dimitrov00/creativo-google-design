import {
  type ClientOperationId,
  CustomerId,
  Result,
  StoredFields,
  UtcEpochMs,
} from '@core/primitives';
import { type PipelineError } from '@core/errors';
import { CallAnswer } from './call-answer.data';
import type { ErasureCensus } from './erasure-census.data';
import { ErasureStatus } from './erasure-lifecycle.data';

/** The export bundle's format version — bumped by any change of a section's shape or order. */
const EXPORT_VERSION = 1;

/**
 * THE PRIVACY WIRE (audit-hardening Phase 3, WS-C / WS-D) — what the web
 * sends to an admin's data-subject callable (`exportClientData`, and the
 * erasure's `previewClientErasure` and `eraseClient`, which take the same
 * struct): the client RECORD the request is about and
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
    const exportedAt = StoredFields.field(answer, 'exportedAtUtcMs');
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

  /**
   * `previewClientErasure`'s answer, read through {@link CallAnswer}: the
   * record's erasure tag, every census count a whole number ≥ 0 and each
   * sibling id through `CustomerId.parse` — anything else is
   * `PIPELINE_UNKNOWN` (the alert never words a figure the server did not
   * send).
   */
  decodeErasurePreview(
    raw: unknown,
  ): Result<ClientPrivacyCall.ErasurePreview, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const erasureStatus = CallAnswer.tag(
      answer,
      'erasureStatus',
      ErasureStatus,
    );
    const census = censusOf(answer);
    const siblings = customerIdsOf(
      StoredFields.field(answer, 'erasureSiblingCustomerIds'),
    );
    if (erasureStatus === null || census === null || siblings === null) {
      return CallAnswer.unusable();
    }
    return Result.ok({
      erasureStatus,
      erasureSiblingCustomerIds: siblings,
      ...census,
    });
  },

  /**
   * `eraseClient`'s answer — the record's erasure tag after the call,
   * whether the erasure is done, and the residue census — read through
   * {@link CallAnswer}; anything else is `PIPELINE_UNKNOWN`.
   */
  decodeErasure(
    raw: unknown,
  ): Result<ClientPrivacyCall.Erasure, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const erasureStatus = CallAnswer.tag(
      answer,
      'erasureStatus',
      ErasureStatus,
    );
    const erasureDone = CallAnswer.flag(answer, 'erasureDone');
    const census = censusOf(answer);
    if (erasureStatus === null || erasureDone === null || census === null) {
      return CallAnswer.unusable();
    }
    return Result.ok({ erasureStatus, erasureDone, ...census });
  },
} as const;

/**
 * The eleven census counts of an answer, each a whole number ≥ 0, in the
 * census's field order — `null` when any is missing or malformed.
 */
function censusOf(answer: CallAnswer): ErasureCensus | null {
  const erasureRecordCount = CallAnswer.whole(answer, 'erasureRecordCount', 0);
  const erasureAccountCount = CallAnswer.whole(
    answer,
    'erasureAccountCount',
    0,
  );
  const erasureContactCount = CallAnswer.whole(
    answer,
    'erasureContactCount',
    0,
  );
  const erasureLabelCount = CallAnswer.whole(answer, 'erasureLabelCount', 0);
  const erasureNoteCount = CallAnswer.whole(answer, 'erasureNoteCount', 0);
  const erasurePhotoCount = CallAnswer.whole(answer, 'erasurePhotoCount', 0);
  const erasureDocumentCount = CallAnswer.whole(
    answer,
    'erasureDocumentCount',
    0,
  );
  const erasurePseudonymCount = CallAnswer.whole(
    answer,
    'erasurePseudonymCount',
    0,
  );
  const erasureVisitCount = CallAnswer.whole(answer, 'erasureVisitCount', 0);
  const erasureContactKeptCount = CallAnswer.whole(
    answer,
    'erasureContactKeptCount',
    0,
  );
  const erasureJournalCount = CallAnswer.whole(
    answer,
    'erasureJournalCount',
    0,
  );
  if (
    erasureRecordCount === null ||
    erasureAccountCount === null ||
    erasureContactCount === null ||
    erasureLabelCount === null ||
    erasureNoteCount === null ||
    erasurePhotoCount === null ||
    erasureDocumentCount === null ||
    erasurePseudonymCount === null ||
    erasureVisitCount === null ||
    erasureContactKeptCount === null ||
    erasureJournalCount === null
  ) {
    return null;
  }
  return {
    erasureRecordCount,
    erasureAccountCount,
    erasureContactCount,
    erasureLabelCount,
    erasureNoteCount,
    erasurePhotoCount,
    erasureDocumentCount,
    erasurePseudonymCount,
    erasureVisitCount,
    erasureContactKeptCount,
    erasureJournalCount,
  };
}

/** A list of client record ids, each through `CustomerId.parse` — `null` when it is no array or any id is malformed. */
function customerIdsOf(raw: unknown): readonly CustomerId[] | null {
  if (!Array.isArray(raw)) return null;
  const out: CustomerId[] = [];
  for (const id of raw as readonly unknown[]) {
    if (typeof id !== 'string') return null;
    const parsed = CustomerId.parse(id);
    if (!parsed.ok) return null;
    out.push(parsed.value);
  }
  return out;
}

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
  /**
   * `previewClientErasure`'s answer — read-only, no row (P3-L-17): the
   * record's erasure tag and the census of the person's footprint (what an
   * erasure would clear, and what it would keep), which the card's ONE alert
   * words in figures, beside the sibling walk-in records.
   */
  export type ErasurePreview = {
    readonly erasureStatus: ErasureStatus;
    /**
     * Existing walk-in records keyed by the person's phone / e-mail, the
     * record itself excluded (P3-L-7) — ids only, an admin-only answer;
     * empty once the stamp has cleared the contact values.
     */
    readonly erasureSiblingCustomerIds: readonly CustomerId[];
  } & ErasureCensus;
  /**
   * `eraseClient`'s answer — one resumable call's outcome: `ERASING` while
   * work is left (`erasureDone` false — call again with the SAME act),
   * `ERASED` when done; the census is the residue after this call.
   */
  export type Erasure = {
    readonly erasureStatus: ErasureStatus;
    readonly erasureDone: boolean;
  } & ErasureCensus;
}
