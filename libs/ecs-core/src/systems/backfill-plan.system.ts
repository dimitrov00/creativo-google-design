import { AuditAction } from '../components/audit-context.data';
import { Placement } from '../components/placement-kind.data';
import {
  BackfillJobName,
  type BackfillJob,
} from '../entities/backfill-job.entity';
import type { UserId } from '../primitives/ids.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/**
 * The pure half of the ops backfill (`apps/functions/src/lib/ops/
 * backfill-plan.ts:14-171`, and the page bookkeeping of `run-backfill.ts:
 * 383-570`): which job, which page, where the next call starts, what a
 * stored appointment's mirrors lack. The pipeline reads, walks and writes.
 *
 * `SUBJECT_MIRROR` stamps the R33 mirrors on rows written before them;
 * `CLIENT_STATS` stamps them too and recomputes every subject on the page,
 * then every STORED client — the order the legacy-import runbook runs them
 * in (§12.5.6).
 */

/** Every job a run may name, in runbook order. */
const JOBS: readonly BackfillJobName[] = [
  BackfillJobName.SubjectMirror,
  BackfillJobName.ClientStats,
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

/**
 * The two walks a run makes — the ONLY source of these strings, the field
 * `backfillPhase`. Every job pages the appointments; `CLIENT_STATS` then
 * pages the stored `clientStats` documents themselves, because a person no
 * appointment names any more is reachable only from their own document
 * (§12.4 P0).
 */
export const BackfillPhase = {
  Appointments: 'APPOINTMENTS',
  StoredClients: 'STORED_CLIENTS',
} as const;
export type BackfillPhase = (typeof BackfillPhase)[keyof typeof BackfillPhase];

export type BackfillPosition = {
  readonly backfillPhase: BackfillPhase;
  /** The document id to continue after, `null` at the phase's start. */
  readonly after: string | null;
};

/** Where a call asks to start — the ONLY source of these strings, the field `backfillStart`. */
export const BackfillStart = {
  /** No cursor sent: continue wherever the job's progress document says. */
  Resume: 'RESUME',
  /** `cursor: null` sent: start over from the top. */
  Top: 'TOP',
  /** A wire cursor a previous call returned. */
  After: 'AFTER',
} as const;
export type BackfillStart = (typeof BackfillStart)[keyof typeof BackfillStart];

export type BackfillStartRequest =
  | { readonly backfillStart: typeof BackfillStart.Resume }
  | { readonly backfillStart: typeof BackfillStart.Top }
  | {
      readonly backfillStart: typeof BackfillStart.After;
      readonly cursor: string;
    };

/** A validated `runBackfill({ backfillJobName, cursor? })` payload. */
export type BackfillRequest = {
  readonly backfillJobName: BackfillJobName;
  readonly start: BackfillStartRequest;
};

/** A stored appointment's mirrors, as the backfill judges them. */
export type MirrorRow = {
  /** The stored subject mirror; `null` when the row has none, or it is not a list. */
  readonly storedSubjectUserIds: readonly unknown[] | null;
  /** The subjects the seats name — every account once, sorted (R33); `UserId` until flip (1). */
  readonly seatSubjectUserIds: readonly UserId[];
  /** The COMMIT's own placement stamp. */
  readonly placement: Placement | null;
  /** The backfill's earlier inference. */
  readonly inferredPlacement: Placement | null;
};

/** What a row's mirrors lack; a `null` field writes nothing. */
export type MirrorPatch = {
  /** The re-derived subject list, when the stored one disagrees with the seats — `UserId` until flip (1). */
  readonly subjectUserIds: readonly UserId[] | null;
  /** An inference to fill in — never the commit's own `placement`. */
  readonly inferredPlacement: Placement | null;
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
  readonly carried: BackfillCounts & { readonly startedAtUtcMs: UtcEpochMs };
};

const ZERO_COUNTS: BackfillCounts = {
  processed: 0,
  storedClients: 0,
  stamped: 0,
  recomputed: 0,
};

function isJob(raw: unknown): raw is BackfillJobName {
  for (let i = 0; i < JOBS.length; i++) if (JOBS[i] === raw) return true;
  return false;
}

/** Two plain lists, the same by their JSON — what the stored mirror is compared by. */
function sameList(
  stored: readonly unknown[] | null,
  derived: readonly UserId[],
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
    if (position.backfillPhase === BackfillPhase.Appointments) {
      return position.after;
    }
    return `${STORED_CLIENTS_MARK}${position.after ?? ''}`;
  },

  /** The position a wire cursor names; `null` starts at the very top. */
  positionOf(cursor: string | null): BackfillPosition {
    if (cursor !== null && cursor.startsWith(STORED_CLIENTS_MARK)) {
      const after = cursor.slice(STORED_CLIENTS_MARK.length);
      return {
        backfillPhase: BackfillPhase.StoredClients,
        after: after.length > 0 ? after : null,
      };
    }
    return { backfillPhase: BackfillPhase.Appointments, after: cursor };
  },

  /**
   * The payload `{ backfillJobName, cursor? }`, shaped without trusting it;
   * `null` when it names no job, or a cursor that is not a document id — a
   * cursor becomes a `startAfter`, and anything else would start a scan from
   * somewhere nobody chose. Only the stats job walks the stored clients.
   */
  requestOf(raw: unknown): BackfillRequest | null {
    if (raw === null || typeof raw !== 'object') return null;
    const backfillJobName =
      'backfillJobName' in raw ? raw.backfillJobName : undefined;
    if (!isJob(backfillJobName)) return null;
    if (!('cursor' in raw) || raw.cursor === undefined) {
      return {
        backfillJobName,
        start: { backfillStart: BackfillStart.Resume },
      };
    }
    const cursor = raw.cursor;
    if (cursor === null) {
      return { backfillJobName, start: { backfillStart: BackfillStart.Top } };
    }
    if (typeof cursor !== 'string') return null;
    const position = BackfillPlanSystem.positionOf(cursor);
    const valid =
      position.backfillPhase === BackfillPhase.StoredClients
        ? backfillJobName === BackfillJobName.ClientStats &&
          (position.after === null || DOC_ID.test(position.after))
        : DOC_ID.test(cursor);
    return valid
      ? {
          backfillJobName,
          start: { backfillStart: BackfillStart.After, cursor },
        }
      : null;
  },

  /**
   * Who placed a stored booking, reconstructed (§12.5.1) — from the
   * commit's audit row and nothing else; `null` without one. What this
   * returns is an INFERENCE and is stored as one (`inferredPlacement`),
   * never as the commit's `placement`: guessing from the owner would mark
   * every legacy visit `SELF`, and look exactly like an audit-backed answer.
   */
  inferPlacement(auditActions: readonly AuditAction[]): Placement | null {
    if (auditActions.includes(AuditAction.BookingStaffCreated)) {
      return Placement.Staff;
    }
    if (auditActions.includes(AuditAction.BookingCommitted)) {
      return Placement.Self;
    }
    return null;
  },

  /** Neither the commit's stamp nor an inference yet: the audit trail may know. */
  lacksPlacement(
    placement: Placement | null,
    inferredPlacement: Placement | null,
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
  mirrorPatch(row: MirrorRow, inferred: Placement | null): MirrorPatch | null {
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
   * top starts a new one at `nowUtcMs`.
   */
  resume(
    start: BackfillStartRequest,
    previous: BackfillJob | null,
    nowUtcMs: UtcEpochMs,
  ): BackfillResume {
    const resuming = previous !== null && previous.finishedAtUtcMs === null;
    const cursor =
      start.backfillStart === BackfillStart.Resume
        ? resuming
          ? previous.cursor
          : null
        : start.backfillStart === BackfillStart.Top
          ? null
          : start.cursor;
    const carried =
      resuming && cursor !== null
        ? {
            processed: previous.processed,
            storedClients: previous.storedClients,
            stamped: previous.stamped,
            recomputed: previous.recomputed,
            startedAtUtcMs: previous.startedAtUtcMs,
          }
        : { ...ZERO_COUNTS, startedAtUtcMs: nowUtcMs };
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
    backfillPhase: BackfillPhase,
    ids: readonly string[],
    handled: number,
    after: string | null,
    pageSize: number,
  ): BackfillPageWalk {
    const stoppedEarly = handled < ids.length;
    return {
      next: {
        backfillPhase,
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
    backfillJobName: BackfillJobName,
    walk: BackfillPageWalk,
    worked: BackfillCounts,
    spent: () => boolean,
  ): BackfillPageVerdict {
    const nextPhase =
      walk.exhausted &&
      walk.next.backfillPhase === BackfillPhase.Appointments &&
      backfillJobName === BackfillJobName.ClientStats;
    const walkedAll = walk.exhausted && !nextPhase;
    const sampleDue =
      walkedAll && backfillJobName === BackfillJobName.ClientStats;
    const workedAlready = worked.processed + worked.storedClients > 0;
    const sampleDeferred = sampleDue && workedAlready && spent();
    const done = walkedAll && !sampleDeferred;
    return {
      cursor: BackfillPlanSystem.cursorOf(
        nextPhase
          ? { backfillPhase: BackfillPhase.StoredClients, after: null }
          : walk.next,
      ),
      done,
      takeSample: done && sampleDue,
      sampleDeferred,
    };
  },
} as const;
