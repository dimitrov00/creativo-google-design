import {
  type AppointmentPlacement,
  type PersistedDocument,
  inferredPlacementFromDocument,
  placementFromDocument,
  subjectUserIdsFromDocument,
} from '@creativo/application/booking';
import {
  BackfillPlanSystem,
  type BackfillRequest as EcsBackfillRequest,
  BackfillStartKind,
  type MirrorPatch,
  type MirrorRow,
} from '@creativo/ecs-core';

/**
 * The pure half of `runBackfill` (§12.5.3): which job, which page, and what
 * a stored appointment is missing. The shell reads and writes.
 *
 * Phase 2 shim: the decisions are `BackfillPlanSystem` in
 * `@creativo/ecs-core`; this file keeps the legacy names and shapes for its
 * callers and reads the stored rows through their mappers.
 */

/**
 * `subjectMirror` stamps the R33 mirrors on rows written before them;
 * `clientStats` stamps them too and recomputes every subject on the page,
 * then every STORED client — the order the legacy-import runbook runs them
 * in (§12.5.6).
 */
export const BACKFILL_JOBS = ['subjectMirror', 'clientStats'] as const;
export type BackfillJob = (typeof BACKFILL_JOBS)[number];

/** Appointments (or stored clients) per call at most — one page read. */
export const BACKFILL_PAGE_SIZE = BackfillPlanSystem.PAGE_SIZE;

/**
 * Rows handled between two looks at the call's time budget: small enough
 * that the chunk in hand always finishes inside the timeout's reserve.
 */
export const BACKFILL_CHUNK_SIZE = BackfillPlanSystem.CHUNK_SIZE;

export const BACKFILL_JOBS_COLLECTION = 'backfillJobs';

export interface BackfillRequest {
  readonly job: BackfillJob;
  /**
   * Where to continue: an opaque cursor a previous call returned, `null` to
   * start over, or absent to resume wherever the job's progress document
   * says — so a runner that lost its place just calls again.
   */
  readonly cursor?: string | null;
}

/**
 * The two walks a run makes. Every job pages the appointments; `clientStats`
 * then pages the stored `clientStats` documents themselves, because a person
 * no appointment names any more — dropped from a party while the trigger's
 * event was lost — is reachable only from their own document, and the
 * backfill is the documented repair for exactly that (§12.4 P0).
 */
export type BackfillPhase = 'appointments' | 'storedClients';

export interface BackfillPosition {
  readonly phase: BackfillPhase;
  /** The document id to continue after, `null` at the phase's start. */
  readonly after: string | null;
}

/** The wire cursor for a position: an appointment id as before, `~uid` after. */
export function cursorOf(position: BackfillPosition): string | null {
  return BackfillPlanSystem.cursorOf(position);
}

/** The position a wire cursor names; `null` starts at the very top. */
export function positionOf(cursor: string | null): BackfillPosition {
  return BackfillPlanSystem.positionOf(cursor);
}

/** The wire payload, shaped without trusting it; `null` when it names no job. */
export function toBackfillRequest(raw: unknown): BackfillRequest | null {
  const request = BackfillPlanSystem.requestOf(raw);
  return request === null ? null : toLegacyRequest(request);
}

/**
 * Who placed a stored booking, reconstructed (§12.5.1) — from the commit's
 * audit row, and from nothing else. `null` when there is no such row: a
 * legacy import has none. Guessing from the owner would mark every legacy
 * visit `self`, and a guess would look exactly like an audit-backed answer.
 *
 * What this returns is an INFERENCE and is stored as one
 * (`inferredPlacement`), never as the commit's `placement` stamp: the rows it
 * is for were written by the pre-P0 commit path, which stored an omitted
 * barber preference as `specific`, so their seats are no evidence of a
 * request whoever placed them (the preferred barber, §11.2 #6).
 */
export function inferPlacement(
  auditActions: readonly string[],
): AppointmentPlacement | null {
  return BackfillPlanSystem.inferPlacement(auditActions);
}

/** Neither the commit's stamp nor an inference yet: the audit trail may know. */
export function lacksPlacement(data: PersistedDocument): boolean {
  return BackfillPlanSystem.lacksPlacement(
    placementFromDocument(data),
    inferredPlacementFromDocument(data),
  );
}

/**
 * Could this row be missing a mirror? A subject list that disagrees with the
 * seats, or no placement of either kind yet — whether the audit trail can
 * supply one is the shell's to find out, and `mirrorPatch` then says what is
 * actually written.
 */
export function mayLackMirrors(data: PersistedDocument): boolean {
  return BackfillPlanSystem.mayLackMirrors(mirrorRowOf(data));
}

/**
 * What a stored appointment's mirrors lack, as an `update()` patch, or
 * `null` when it lacks nothing that can be filled — which is what makes a
 * second run a no-op.
 *
 * `subjectUserIds` is re-derived from the seats and replaced whenever it
 * disagrees. The audit trail's placement is only ever filled in, into
 * `inferredPlacement`, on a row that has neither that nor the commit's
 * `placement` — and only from evidence: an unknown placement (`null`)
 * writes nothing. The commit's `placement` is never written here, so a
 * backfilled row can never read as one whose preferences were recorded.
 */
export function mirrorPatch(
  data: PersistedDocument,
  inferred: AppointmentPlacement | null,
): Record<string, unknown> | null {
  return toLegacyPatch(
    BackfillPlanSystem.mirrorPatch(mirrorRowOf(data), inferred),
  );
}

/** A stored row as the system judges its mirrors. */
function mirrorRowOf(data: PersistedDocument): MirrorRow {
  const stored: unknown = data['subjectUserIds'];
  return {
    storedSubjectUserIds: Array.isArray(stored) ? stored : null,
    seatSubjectUserIds: subjectUserIdsFromDocument(data),
    placement: placementFromDocument(data),
    inferredPlacement: inferredPlacementFromDocument(data),
  };
}

/** The patch as the `update()` fields it writes — only the ones it fills. */
function toLegacyPatch(
  patch: MirrorPatch | null,
): Record<string, unknown> | null {
  if (patch === null) return null;
  const fields: Record<string, unknown> = {};
  if (patch.subjectUserIds !== null) {
    fields['subjectUserIds'] = patch.subjectUserIds;
  }
  if (patch.inferredPlacement !== null) {
    fields['inferredPlacement'] = patch.inferredPlacement;
  }
  return fields;
}

/** The validated request with its start as the legacy optional cursor. */
function toLegacyRequest(request: EcsBackfillRequest): BackfillRequest {
  switch (request.start.kind) {
    case BackfillStartKind.Resume:
      return { job: request.job };
    case BackfillStartKind.Top:
      return { job: request.job, cursor: null };
    case BackfillStartKind.After:
      return { job: request.job, cursor: request.start.cursor };
  }
}
