import { PlacementKind } from '../components/placement-kind.data';
import {
  BackfillJobKind,
  type BackfillJobEntity,
} from '../entities/backfill-job.entity';

/**
 * The pure half of the ops backfill (`apps/functions/src/lib/ops/
 * backfill-plan.ts:14-171`, and the page bookkeeping of `run-backfill.ts:
 * 383-570`): which job, which page, where the next call starts, what a
 * stored appointment's mirrors lack. The pipeline reads, walks and writes.
 *
 * `subjectMirror` stamps the R33 mirrors on rows written before them;
 * `clientStats` stamps them too and recomputes every subject on the page,
 * then every STORED client — the order the legacy-import runbook runs them
 * in (§12.5.6).
 */

/** Every job a run may name, in runbook order. */
const JOBS: readonly BackfillJobKind[] = [
  BackfillJobKind.SubjectMirror,
  BackfillJobKind.ClientStats,
];

/** Appointments (or stored clients) per call at most — one page read. */
const PAGE_SIZE = 200;

/**
 * Rows handled between two looks at the call's time budget: small enough
 * that the chunk in hand always finishes inside the timeout's reserve.
 */
const CHUNK_SIZE = 25;

/**
 * Marks a stored-client cursor. Outside the document-id charset, so no
 * appointment id can ever be read as one.
 */
const STORED_CLIENTS_MARK = '~';

const DOC_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The commit audit rows that say who placed a booking (§12.5.1). */
const STAFF_CREATED_ACTION = 'booking.staff_created';
const COMMITTED_ACTION = 'booking.committed';

/**
 * The two walks a run makes — the ONLY source of these strings. Every job
 * pages the appointments; `clientStats` then pages the stored `clientStats`
 * documents themselves, because a person no appointment names any more is
 * reachable only from their own document (§12.4 P0).
 */
export const BackfillPhase = {
  Appointments: 'appointments',
  StoredClients: 'storedClients',
} as const;
export type BackfillPhase = (typeof BackfillPhase)[keyof typeof BackfillPhase];

export type BackfillPosition = {
  readonly phase: BackfillPhase;
  /** The document id to continue after, `null` at the phase's start. */
  readonly after: string | null;
};

/** Where a call asks to start — the ONLY source of these strings. */
export const BackfillStartKind = {
  /** No cursor sent: continue wherever the job's progress document says. */
  Resume: 'resume',
  /** `cursor: null` sent: start over from the top. */
  Top: 'top',
  /** A wire cursor a previous call returned. */
  After: 'after',
} as const;
export type BackfillStartKind =
  (typeof BackfillStartKind)[keyof typeof BackfillStartKind];

export type BackfillStart =
  | { readonly kind: typeof BackfillStartKind.Resume }
  | { readonly kind: typeof BackfillStartKind.Top }
  | { readonly kind: typeof BackfillStartKind.After; readonly cursor: string };

/** A validated `runBackfill({ job, cursor? })` payload. */
export type BackfillRequest = {
  readonly job: BackfillJobKind;
  readonly start: BackfillStart;
};

/** A stored appointment's mirrors, as the backfill judges them. */
export type MirrorRow = {
  /** The stored subject mirror; `null` when the row has none, or it is not a list. */
  readonly storedSubjectUserIds: readonly unknown[] | null;
  /** The subjects the seats name — every account once, sorted (R33). */
  readonly seatSubjectUserIds: readonly string[];
  /** The COMMIT's own placement stamp. */
  readonly placement: PlacementKind | null;
  /** The backfill's earlier inference. */
  readonly inferredPlacement: PlacementKind | null;
};

/** What a row's mirrors lack; a `null` field writes nothing. */
export type MirrorPatch = {
  /** The re-derived subject list, when the stored one disagrees with the seats. */
  readonly subjectUserIds: readonly string[] | null;
  /** An inference to fill in — never the commit's own `placement`. */
  readonly inferredPlacement: PlacementKind | null;
};

/** What one page walked, before the progress document records it. */
export type BackfillPageWalk = {
  readonly next: BackfillPosition;
  /** The walk ran off the end of its phase. */
  readonly exhausted: boolean;
  /** The budget ran out before the page did; `next` is the last row handled. */
  readonly stoppedEarly: boolean;
};

/** The counts a page adds to its run. */
export type BackfillCounts = {
  readonly processed: number;
  readonly storedClients: number;
  readonly stamped: number;
  readonly recomputed: number;
};

/** How a run continues after one page. */
export type BackfillPageVerdict = {
  /** The wire cursor the next call starts after (also what the progress document stores). */
  readonly cursor: string | null;
  /** Both walks are over and nothing — not even the closing sample — waits. */
  readonly done: boolean;
  /** The closing sample is to be taken by THIS call. */
  readonly takeSample: boolean;
  /** The closing sample waits for the next call: the budget is spent. */
  readonly sampleDeferred: boolean;
};

/** Where a call starts, and what it carries over from the run it continues. */
export type BackfillResume = {
  /** The cursor this page starts after, as resolved. */
  readonly cursor: string | null;
  readonly carried: BackfillCounts & { readonly startedAtMs: number };
};

const ZERO_COUNTS: BackfillCounts = {
  processed: 0,
  storedClients: 0,
  stamped: 0,
  recomputed: 0,
};

function isJob(raw: unknown): raw is BackfillJobKind {
  for (let i = 0; i < JOBS.length; i++) if (JOBS[i] === raw) return true;
  return false;
}

/** Two plain lists, the same by their JSON — what the stored mirror is compared by. */
function sameList(
  stored: readonly unknown[] | null,
  derived: readonly string[],
): boolean {
  return stored !== null && JSON.stringify(stored) === JSON.stringify(derived);
}

export const BackfillPlanSystem = {
  JOBS,
  PAGE_SIZE,
  CHUNK_SIZE,
  STORED_CLIENTS_MARK,

  /** Is this a Firestore document id a cursor may name? */
  isDocId(raw: string): boolean {
    return DOC_ID.test(raw);
  },

  /** The wire cursor for a position: an appointment id as before, `~uid` after. */
  cursorOf(position: BackfillPosition): string | null {
    if (position.phase === BackfillPhase.Appointments) return position.after;
    return `${STORED_CLIENTS_MARK}${position.after ?? ''}`;
  },

  /** The position a wire cursor names; `null` starts at the very top. */
  positionOf(cursor: string | null): BackfillPosition {
    if (cursor !== null && cursor.startsWith(STORED_CLIENTS_MARK)) {
      const after = cursor.slice(STORED_CLIENTS_MARK.length);
      return {
        phase: BackfillPhase.StoredClients,
        after: after.length > 0 ? after : null,
      };
    }
    return { phase: BackfillPhase.Appointments, after: cursor };
  },

  /**
   * The wire payload, shaped without trusting it; `null` when it names no
   * job, or a cursor that is not a document id — a cursor becomes a
   * `startAfter`, and anything else would start a scan from somewhere
   * nobody chose. Only the stats job walks the stored clients.
   */
  requestOf(raw: unknown): BackfillRequest | null {
    if (raw === null || typeof raw !== 'object') return null;
    const job = 'job' in raw ? raw.job : undefined;
    if (!isJob(job)) return null;
    if (!('cursor' in raw) || raw.cursor === undefined) {
      return { job, start: { kind: BackfillStartKind.Resume } };
    }
    const cursor = raw.cursor;
    if (cursor === null) return { job, start: { kind: BackfillStartKind.Top } };
    if (typeof cursor !== 'string') return null;
    const position = BackfillPlanSystem.positionOf(cursor);
    const valid =
      position.phase === BackfillPhase.StoredClients
        ? job === BackfillJobKind.ClientStats &&
          (position.after === null || DOC_ID.test(position.after))
        : DOC_ID.test(cursor);
    return valid
      ? { job, start: { kind: BackfillStartKind.After, cursor } }
      : null;
  },

  /**
   * Who placed a stored booking, reconstructed (§12.5.1) — from the
   * commit's audit row and nothing else; `null` without one. What this
   * returns is an INFERENCE and is stored as one (`inferredPlacement`),
   * never as the commit's `placement`: guessing from the owner would mark
   * every legacy visit `self`, and look exactly like an audit-backed answer.
   */
  inferPlacement(auditActions: readonly string[]): PlacementKind | null {
    if (auditActions.includes(STAFF_CREATED_ACTION)) return PlacementKind.Staff;
    if (auditActions.includes(COMMITTED_ACTION)) return PlacementKind.Self;
    return null;
  },

  /** Neither the commit's stamp nor an inference yet: the audit trail may know. */
  lacksPlacement(
    placement: PlacementKind | null,
    inferredPlacement: PlacementKind | null,
  ): boolean {
    return placement === null && inferredPlacement === null;
  },

  /**
   * What a stored appointment's mirrors lack, or `null` when it lacks
   * nothing that can be filled — which is what makes a second run a no-op.
   * The subject list is re-derived and replaced whenever it disagrees; an
   * inferred placement is only ever filled in, on a row with neither kind,
   * and only from evidence. The commit's `placement` is never written here.
   */
  mirrorPatch(
    row: MirrorRow,
    inferred: PlacementKind | null,
  ): MirrorPatch | null {
    const subjectUserIds = sameList(
      row.storedSubjectUserIds,
      row.seatSubjectUserIds,
    )
      ? null
      : row.seatSubjectUserIds;
    const inferredPlacement =
      inferred !== null &&
      BackfillPlanSystem.lacksPlacement(row.placement, row.inferredPlacement)
        ? inferred
        : null;
    return subjectUserIds === null && inferredPlacement === null
      ? null
      : { subjectUserIds, inferredPlacement };
  },

  /**
   * Could this row be missing a mirror? A subject list that disagrees with
   * the seats, or no placement of either kind yet — whether the audit trail
   * can supply one is the pipeline's to find out.
   */
  mayLackMirrors(row: MirrorRow): boolean {
    return (
      BackfillPlanSystem.mirrorPatch(row, null) !== null ||
      BackfillPlanSystem.lacksPlacement(row.placement, row.inferredPlacement)
    );
  },

  /**
   * `items` in consecutive slices of `width` (at least one) — a bounded
   * fan-out, or the 30 values an `in` query takes.
   */
  chunk<T>(items: readonly T[], width: number): readonly (readonly T[])[] {
    const size = Math.max(1, Math.floor(width));
    const out: (readonly T[])[] = [];
    for (let start = 0; start < items.length; start += size) {
      out.push(items.slice(start, start + size));
    }
    return out;
  },

  /**
   * Where a call starts, and what it carries over. A call with no cursor
   * resumes an unfinished run where its progress document stopped; counts
   * carry over only while continuing an unfinished run, and a call from the
   * top starts a new one at `nowMs`.
   */
  resume(
    start: BackfillStart,
    previous: BackfillJobEntity | null,
    nowMs: number,
  ): BackfillResume {
    const resuming = previous !== null && previous.finishedAtMs === null;
    const cursor =
      start.kind === BackfillStartKind.Resume
        ? resuming
          ? previous.cursor
          : null
        : start.kind === BackfillStartKind.Top
          ? null
          : start.cursor;
    const carried =
      resuming && cursor !== null
        ? {
            processed: previous.processed,
            storedClients: previous.storedClients,
            stamped: previous.stamped,
            recomputed: previous.recomputed,
            startedAtMs: previous.startedAtMs,
          }
        : { ...ZERO_COUNTS, startedAtMs: nowMs };
    return { cursor, carried };
  },

  /**
   * What one page of `ids` (read after `after`, at most `pageSize`) came to
   * once `handled` of them were walked: the next position is the last row
   * handled (or `after` when none was), the walk stopped early when the
   * budget left rows unhandled, and the phase is exhausted when a full walk
   * of a short page ran off its end.
   */
  pageWalk(
    phase: BackfillPhase,
    ids: readonly string[],
    handled: number,
    after: string | null,
    pageSize: number,
  ): BackfillPageWalk {
    const stoppedEarly = handled < ids.length;
    return {
      next: {
        phase,
        after: handled > 0 ? (ids[handled - 1] ?? after) : after,
      },
      exhausted: !stoppedEarly && ids.length < pageSize,
      stoppedEarly,
    };
  },

  /**
   * How the run goes on after one page. The appointments ran out: the stats
   * job goes on to the stored clients, every other job is finished. The
   * stats job closes with a sample, which is new work too — with the budget
   * spent it waits for the next call, which finds the phase empty past this
   * cursor and takes it then, as its first unit, so it is never deferred
   * twice. `spent` is asked only when that is the question.
   */
  nextPage(
    job: BackfillJobKind,
    walk: BackfillPageWalk,
    worked: BackfillCounts,
    spent: () => boolean,
  ): BackfillPageVerdict {
    const nextPhase =
      walk.exhausted &&
      walk.next.phase === BackfillPhase.Appointments &&
      job === BackfillJobKind.ClientStats;
    const walkedAll = walk.exhausted && !nextPhase;
    const sampleDue = walkedAll && job === BackfillJobKind.ClientStats;
    const workedAlready = worked.processed + worked.storedClients > 0;
    const sampleDeferred = sampleDue && workedAlready && spent();
    const done = walkedAll && !sampleDeferred;
    return {
      cursor: BackfillPlanSystem.cursorOf(
        nextPhase
          ? { phase: BackfillPhase.StoredClients, after: null }
          : walk.next,
      ),
      done,
      takeSample: done && sampleDue,
      sampleDeferred,
    };
  },
} as const;
