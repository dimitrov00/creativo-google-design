import {
  type AppointmentPlacement,
  type PersistedDocument,
  inferredPlacementFromDocument,
  placementFromDocument,
  subjectUserIdsFromDocument,
} from '@creativo/application/booking';

/**
 * The pure half of `runBackfill` (§12.5.3): which job, which page, and what
 * a stored appointment is missing. The shell reads and writes.
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
export const BACKFILL_PAGE_SIZE = 200;

/**
 * Rows handled between two looks at the call's time budget: small enough
 * that the chunk in hand always finishes inside the timeout's reserve.
 */
export const BACKFILL_CHUNK_SIZE = 25;

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

/**
 * Marks a stored-client cursor. Outside the document-id charset, so no
 * appointment id can ever be read as one.
 */
const STORED_CLIENTS_MARK = '~';

const DOC_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The wire cursor for a position: an appointment id as before, `~uid` after. */
export function cursorOf(position: BackfillPosition): string | null {
  if (position.phase === 'appointments') return position.after;
  return `${STORED_CLIENTS_MARK}${position.after ?? ''}`;
}

/** The position a wire cursor names; `null` starts at the very top. */
export function positionOf(cursor: string | null): BackfillPosition {
  if (cursor !== null && cursor.startsWith(STORED_CLIENTS_MARK)) {
    const after = cursor.slice(STORED_CLIENTS_MARK.length);
    return { phase: 'storedClients', after: after.length > 0 ? after : null };
  }
  return { phase: 'appointments', after: cursor };
}

/** The wire payload, shaped without trusting it; `null` when it names no job. */
export function toBackfillRequest(raw: unknown): BackfillRequest | null {
  if (raw === null || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const job = BACKFILL_JOBS.find((candidate) => candidate === data['job']);
  if (job === undefined) return null;
  const cursor = data['cursor'];
  if (cursor === undefined) return { job };
  if (cursor === null) return { job, cursor: null };
  // A cursor becomes a `startAfter` document id; anything else is refused
  // rather than turned into a scan from somewhere nobody chose.
  if (typeof cursor !== 'string') return null;
  const position = positionOf(cursor);
  if (position.phase === 'storedClients') {
    // Only the stats job walks the stored clients.
    return job === 'clientStats' &&
      (position.after === null || DOC_ID.test(position.after))
      ? { job, cursor }
      : null;
  }
  return DOC_ID.test(cursor) ? { job, cursor } : null;
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
  if (auditActions.includes('booking.staff_created')) return 'staff';
  if (auditActions.includes('booking.committed')) return 'self';
  return null;
}

/** Neither the commit's stamp nor an inference yet: the audit trail may know. */
export function lacksPlacement(data: PersistedDocument): boolean {
  return (
    placementFromDocument(data) === null &&
    inferredPlacementFromDocument(data) === null
  );
}

/**
 * Could this row be missing a mirror? A subject list that disagrees with the
 * seats, or no placement of either kind yet — whether the audit trail can
 * supply one is the shell's to find out, and `mirrorPatch` then says what is
 * actually written.
 */
export function mayLackMirrors(data: PersistedDocument): boolean {
  return mirrorPatch(data, null) !== null || lacksPlacement(data);
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
  const patch: Record<string, unknown> = {};
  const subjects = subjectUserIdsFromDocument(data);
  const stored = data['subjectUserIds'];
  // Both sides are plain string lists, so their JSON is their identity.
  const same =
    Array.isArray(stored) &&
    JSON.stringify(stored) === JSON.stringify(subjects);
  if (!same) patch['subjectUserIds'] = subjects;
  if (inferred !== null && lacksPlacement(data)) {
    patch['inferredPlacement'] = inferred;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
