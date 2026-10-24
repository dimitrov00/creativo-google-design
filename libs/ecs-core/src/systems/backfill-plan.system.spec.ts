import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AuditAction, Placement, BackfillJobName } from '@core/components';
import type { BackfillJob } from '@core/entities';
import {
  BackfillJobId,
  CustomerId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { customerOf, deepFreeze, unwrapOk, utcMs } from '@core/testing';
import {
  BackfillPhase,
  type BackfillPageWalk,
  BackfillPlanSystem,
  type BackfillPosition,
  BackfillStart,
  type MirrorPatch,
  type MirrorRow,
} from './backfill-plan.system';

/*
 * The cases of apps/functions/src/lib/ops/backfill-plan.spec.ts, copied (the
 * legacy spec ran against its shim until a flip deleted it) and
 * re-targeted: a stored row
 * — in the flat seat layout (`seatSubject`, `subjectUserId`) with SCREAMING
 * placements — is read into a `MirrorRow` first (`rowOf` — the seats'
 * subjects derived the R33 way as `UserId`s, the placements through the
 * `Placement` guard), a request names its job as `backfillJobName` and its
 * start as a `BackfillStartRequest` instead of an absent key, and the audit
 * actions are `AuditAction` values. Then the page bookkeeping of
 * `run-backfill.ts`, which the system now owns, on `UtcEpochMs` stamps.
 *
 * D29 (flip 1): each account seat carries its client record beside its uid,
 * and the row stores a second mirror, `subjectCustomerIds`. A stored row
 * that names only `subjectUserIds` stands for a writer that wrote BOTH
 * mirrors from the same seats (`rowOf` derives the record mirror of those
 * uids), so the legacy cases keep their meaning; the cases at the end of
 * `mirrorPatch` give the two mirrors apart.
 */

/** A client record, derived as the pipelines derive it. */
const cus = (uid: string): CustomerId => customerOf(UserId.of(uid));
/** The record mirror of the default seats — ana's and zora's, sorted. */
const RECORDS: readonly CustomerId[] = [cus('ana'), cus('zora')].sort();

const {
  cursorOf,
  inferPlacement,
  lacksPlacement,
  mayLackMirrors,
  mirrorPatch,
  positionOf,
  requestOf,
} = BackfillPlanSystem;

const seats = [
  {
    seatSubject: 'ACCOUNT',
    subjectUserId: 'zora',
    subjectCustomerId: cus('zora'),
    subjectRelationship: 'COMPANION',
  },
  { seatSubject: 'ANONYMOUS', guestLabel: 'Гост' },
  {
    seatSubject: 'ACCOUNT',
    subjectUserId: 'ana',
    subjectCustomerId: cus('ana'),
    subjectRelationship: 'SELF',
  },
];

type StoredRow = {
  readonly seats: readonly Record<string, unknown>[];
  readonly subjectUserIds?: unknown;
  readonly subjectCustomerIds?: unknown;
  readonly placement?: unknown;
  readonly inferredPlacement?: unknown;
};

/** The record mirror a writer would have stored beside this account mirror. */
function pairedRecords(stored: unknown): readonly unknown[] | null {
  if (!Array.isArray(stored)) return null;
  return stored
    .map((uid: unknown) => (typeof uid === 'string' ? cus(uid) : uid))
    .sort();
}

/**
 * A stored row as the backfill reads it: every account and every client
 * record on its seats once, sorted.
 */
function rowOf(data: StoredRow): MirrorRow {
  const subjects = new Set<string>();
  const records = new Set<string>();
  for (const seat of data.seats) {
    const { seatSubject, subjectUserId, subjectCustomerId } = seat;
    if (seatSubject === 'ACCOUNT' && typeof subjectUserId === 'string') {
      subjects.add(subjectUserId);
    }
    if (seatSubject === 'ACCOUNT' && typeof subjectCustomerId === 'string') {
      records.add(subjectCustomerId);
    }
  }
  return {
    storedSubjectUserIds: Array.isArray(data.subjectUserIds)
      ? (data.subjectUserIds as readonly unknown[])
      : null,
    seatSubjectUserIds: [...subjects].sort().map(UserId.of),
    storedSubjectCustomerIds:
      'subjectCustomerIds' in data
        ? Array.isArray(data.subjectCustomerIds)
          ? (data.subjectCustomerIds as readonly unknown[])
          : null
        : pairedRecords(data.subjectUserIds),
    seatSubjectCustomerIds: [...records].sort().map(CustomerId.of),
    placement: Placement.parse(data.placement ?? null),
    inferredPlacement: Placement.parse(data.inferredPlacement ?? null),
  };
}

/** The row with the patch applied, as the shell's `update()` would leave it. */
function patched(row: MirrorRow, patch: MirrorPatch | null): MirrorRow {
  if (patch === null) return row;
  return {
    ...row,
    storedSubjectUserIds: patch.subjectUserIds ?? row.storedSubjectUserIds,
    storedSubjectCustomerIds:
      patch.subjectCustomerIds ?? row.storedSubjectCustomerIds,
    inferredPlacement: patch.inferredPlacement ?? row.inferredPlacement,
  };
}

const resume = { backfillStart: BackfillStart.Resume } as const;
const top = { backfillStart: BackfillStart.Top } as const;
const after = (cursor: string) =>
  ({ backfillStart: BackfillStart.After, cursor }) as const;

describe('requestOf (toBackfillRequest)', () => {
  it('takes a known job, with a cursor to resume after, null to restart, or none', () => {
    expect(requestOf({ backfillJobName: 'CLIENT_STATS' })).toEqual({
      backfillJobName: 'CLIENT_STATS',
      start: resume,
    });
    expect(
      requestOf({ backfillJobName: 'SUBJECT_MIRROR', cursor: null }),
    ).toEqual({
      backfillJobName: 'SUBJECT_MIRROR',
      start: top,
    });
    expect(
      requestOf({ backfillJobName: 'CLIENT_STATS', cursor: 'appt_42' }),
    ).toEqual({
      backfillJobName: 'CLIENT_STATS',
      start: after('appt_42'),
    });
  });

  it('refuses an unknown job and a cursor that is not a document id', () => {
    expect(requestOf({ backfillJobName: 'DROP_EVERYTHING' })).toBeNull();
    // The pre-flatten spelling is no job here: the shim translates the wire.
    expect(requestOf({ backfillJobName: 'clientStats' })).toBeNull();
    expect(requestOf(null)).toBeNull();
    expect(
      requestOf({ backfillJobName: 'CLIENT_STATS', cursor: '../users/x' }),
    ).toBeNull();
    expect(
      requestOf({ backfillJobName: 'CLIENT_STATS', cursor: 7 }),
    ).toBeNull();
    expect(
      requestOf({ backfillJobName: 'CLIENT_STATS', cursor: '~../users/x' }),
    ).toBeNull();
  });

  it('takes a stored-client cursor for the stats job only', () => {
    expect(requestOf({ backfillJobName: 'CLIENT_STATS', cursor: '~' })).toEqual(
      {
        backfillJobName: 'CLIENT_STATS',
        start: after('~'),
      },
    );
    expect(
      requestOf({ backfillJobName: 'CLIENT_STATS', cursor: '~ana' }),
    ).toEqual({
      backfillJobName: 'CLIENT_STATS',
      start: after('~ana'),
    });
    expect(
      requestOf({ backfillJobName: 'SUBJECT_MIRROR', cursor: '~' }),
    ).toBeNull();
  });

  it('reads an explicit undefined cursor as none, and a non-object as no request', () => {
    expect(
      requestOf({ backfillJobName: 'SUBJECT_MIRROR', cursor: undefined }),
    ).toEqual({
      backfillJobName: 'SUBJECT_MIRROR',
      start: resume,
    });
    expect(requestOf('CLIENT_STATS')).toBeNull();
    expect(
      requestOf({ backfillJobName: 'SUBJECT_MIRROR', cursor: 'a/b' }),
    ).toBeNull();
  });
});

describe('the backfill cursor', () => {
  it('round-trips both phases, and an appointment id stays what it was', () => {
    const positions: readonly BackfillPosition[] = [
      { backfillPhase: 'APPOINTMENTS', after: null },
      { backfillPhase: 'APPOINTMENTS', after: 'appt_42' },
      { backfillPhase: 'STORED_CLIENTS', after: null },
      { backfillPhase: 'STORED_CLIENTS', after: 'dev-client-3' },
    ];
    for (const position of positions) {
      expect(positionOf(cursorOf(position))).toEqual(position);
    }
    expect(cursorOf({ backfillPhase: 'APPOINTMENTS', after: 'appt_42' })).toBe(
      'appt_42',
    );
  });
});

describe('inferPlacement (§12.5.1)', () => {
  it('believes the commit row when there is one', () => {
    expect(inferPlacement([AuditAction.BookingStaffCreated])).toBe('STAFF');
    expect(
      inferPlacement([
        AuditAction.BookingTipRecorded,
        AuditAction.BookingCommitted,
      ]),
    ).toBe('SELF');
  });

  // A legacy import has no audit rows and must import WITHOUT a placement,
  // or every legacy visit reads as the client's own request for good.
  it('infers nothing without a commit row, owner or not', () => {
    expect(inferPlacement([])).toBeNull();
    expect(inferPlacement([AuditAction.BookingTipRecorded])).toBeNull();
  });
});

describe('mirrorPatch', () => {
  it('fills in both mirrors on a row written before them, the placement as an inference', () => {
    expect(mirrorPatch(rowOf({ seats }), Placement.Staff)).toEqual({
      subjectUserIds: ['ana', 'zora'],
      subjectCustomerIds: RECORDS,
      inferredPlacement: 'STAFF',
    });
  });

  // The bug this shape exists for: stamping `placement` here made a pre-P0
  // row's defaulted `SPECIFIC` seats read as requests (§11.2 #6).
  it('never writes the commit’s own placement stamp', () => {
    expect(mirrorPatch(rowOf({ seats }), Placement.Self)).not.toHaveProperty(
      'placement',
    );
    expect(
      mirrorPatch(
        rowOf({ seats, subjectUserIds: ['ana', 'zora'] }),
        Placement.Staff,
      ),
    ).toEqual({
      subjectUserIds: null,
      subjectCustomerIds: null,
      inferredPlacement: 'STAFF',
    });
  });

  it('leaves an unknown placement unwritten, so a rerun stays a no-op', () => {
    expect(mirrorPatch(rowOf({ seats }), null)).toEqual({
      subjectUserIds: ['ana', 'zora'],
      subjectCustomerIds: RECORDS,
      inferredPlacement: null,
    });
    expect(
      mirrorPatch(rowOf({ seats, subjectUserIds: ['ana', 'zora'] }), null),
    ).toBeNull();
  });

  it('corrects a subject mirror that disagrees with the seats', () => {
    expect(
      mirrorPatch(
        rowOf({ seats, subjectUserIds: ['ana'], placement: 'SELF' }),
        Placement.Staff,
      ),
    ).toEqual({
      subjectUserIds: ['ana', 'zora'],
      subjectCustomerIds: RECORDS,
      inferredPlacement: null,
    });
  });

  it('infers nothing over a placement the commit stamped', () => {
    expect(
      mirrorPatch(
        rowOf({ seats, subjectUserIds: ['ana', 'zora'], placement: 'SELF' }),
        Placement.Staff,
      ),
    ).toBeNull();
  });

  it('never overwrites an inference it already made', () => {
    expect(
      mirrorPatch(
        rowOf({
          seats,
          subjectUserIds: ['ana', 'zora'],
          inferredPlacement: 'SELF',
        }),
        Placement.Staff,
      ),
    ).toBeNull();
  });

  it('is null on a complete row, which is what makes a second run a no-op', () => {
    expect(
      mirrorPatch(
        rowOf({ seats: [], subjectUserIds: [], placement: 'STAFF' }),
        Placement.Self,
      ),
    ).toBeNull();
  });
});

describe('mirrorPatch — the client-record mirror beside the accounts (D29)', () => {
  it('fills in a missing record mirror on a row whose account mirror is right', () => {
    expect(
      mirrorPatch(
        rowOf({
          seats,
          subjectUserIds: ['ana', 'zora'],
          subjectCustomerIds: undefined,
          placement: 'SELF',
        }),
        null,
      ),
    ).toEqual({
      subjectUserIds: null,
      subjectCustomerIds: RECORDS,
      inferredPlacement: null,
    });
  });

  it('corrects a record mirror that disagrees with the seats, and leaves a right one alone', () => {
    expect(
      mirrorPatch(
        rowOf({
          seats,
          subjectUserIds: ['ana', 'zora'],
          subjectCustomerIds: [cus('ana')],
          placement: 'SELF',
        }),
        null,
      ),
    ).toEqual({
      subjectUserIds: null,
      subjectCustomerIds: RECORDS,
      inferredPlacement: null,
    });
    expect(
      mirrorPatch(
        rowOf({
          seats,
          subjectUserIds: ['ana'],
          subjectCustomerIds: RECORDS,
          placement: 'SELF',
        }),
        null,
      ),
    ).toEqual({
      subjectUserIds: ['ana', 'zora'],
      subjectCustomerIds: null,
      inferredPlacement: null,
    });
  });

  it('flags a row whose record mirror alone is off', () => {
    expect(
      mayLackMirrors(
        rowOf({
          seats,
          subjectUserIds: ['ana', 'zora'],
          subjectCustomerIds: [],
          placement: 'STAFF',
        }),
      ),
    ).toBe(true);
  });
});

describe('mirrorPatch — properties', () => {
  const placementArb = fc.constantFrom('SELF', 'STAFF', null, 'robot');
  const rowArb = fc.record(
    {
      seats: fc.constantFrom(seats, [], seats.slice(1)),
      subjectUserIds: fc.constantFrom(['ana', 'zora'], ['ana'], [], 'x'),
      placement: placementArb,
      inferredPlacement: placementArb,
    },
    { requiredKeys: ['seats'] },
  );
  const inferredArb = fc.constantFrom(Placement.Self, Placement.Staff, null);

  it('is idempotent: a patched row needs no second patch', () => {
    fc.assert(
      fc.property(rowArb, inferredArb, (raw, inferred) => {
        const row = rowOf(raw);
        const after = patched(row, mirrorPatch(row, inferred));
        expect(mirrorPatch(after, inferred)).toBeNull();
        expect(mayLackMirrors(after)).toBe(
          lacksPlacement(after.placement, after.inferredPlacement),
        );
      }),
    );
  });

  it('never writes `placement`, and never changes a stamped one', () => {
    fc.assert(
      fc.property(rowArb, inferredArb, (raw, inferred) => {
        const row = rowOf(raw);
        const patch = mirrorPatch(row, inferred);
        expect(patch ?? {}).not.toHaveProperty('placement');
        if (!lacksPlacement(row.placement, row.inferredPlacement)) {
          expect(patch?.inferredPlacement ?? null).toBeNull();
        }
      }),
    );
  });
});

describe('mayLackMirrors', () => {
  it('flags a row whose subjects disagree or which has no placement of either kind', () => {
    expect(mayLackMirrors(rowOf({ seats, placement: 'SELF' }))).toBe(true);
    expect(
      mayLackMirrors(rowOf({ seats, subjectUserIds: ['ana', 'zora'] })),
    ).toBe(true);
    expect(
      mayLackMirrors(
        rowOf({ seats, subjectUserIds: ['ana', 'zora'], placement: 'STAFF' }),
      ),
    ).toBe(false);
    expect(
      mayLackMirrors(
        rowOf({
          seats,
          subjectUserIds: ['ana', 'zora'],
          inferredPlacement: 'STAFF',
        }),
      ),
    ).toBe(false);
  });
});

/* ── The page bookkeeping (run-backfill.ts) ───────────────────────────── */

const NOW = utcMs('2026-09-25T08:00:00.000Z');
/** `NOW` moved by `ms`. */
const nowPlus = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(NOW + ms));

function progress(overrides: Partial<BackfillJob> = {}): BackfillJob {
  return {
    id: BackfillJobId.of('clientStats'),
    backfillJobName: BackfillJobName.ClientStats,
    cursor: 'appt_9',
    processed: 40,
    storedClients: 3,
    stamped: 2,
    recomputed: 7,
    startedAtUtcMs: nowPlus(-60_000),
    finishedAtUtcMs: null,
    updatedAtUtcMs: nowPlus(-1_000),
    sampleChecked: null,
    sampleMismatched: [],
    ...overrides,
  };
}

const ZERO = { processed: 0, storedClients: 0, stamped: 0, recomputed: 0 };

describe('chunk — bounded fan-out', () => {
  it('slices in order, the last slice short, at least one wide', () => {
    expect(BackfillPlanSystem.chunk([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 2],
      [3, 4],
      [5],
    ]);
    expect(BackfillPlanSystem.chunk([], 30)).toEqual([]);
    expect(BackfillPlanSystem.chunk(['a', 'b'], 0)).toEqual([['a'], ['b']]);
  });

  it('loses and repeats nothing', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 80 }),
        fc.integer({ min: 1, max: 31 }),
        (items, width) => {
          const slices = BackfillPlanSystem.chunk(items, width);
          expect(slices.flat()).toEqual(items);
          for (const slice of slices)
            expect(slice.length).toBeLessThanOrEqual(width);
        },
      ),
    );
  });
});

describe('resume — where a call starts', () => {
  it('continues an unfinished run from its progress when no cursor is sent, carrying its counts', () => {
    expect(BackfillPlanSystem.resume(resume, progress(), NOW)).toEqual({
      cursor: 'appt_9',
      carried: {
        processed: 40,
        storedClients: 3,
        stamped: 2,
        recomputed: 7,
        startedAtUtcMs: nowPlus(-60_000),
      },
    });
  });

  it('starts a new run from the top after a finished one, with no progress, or when asked to', () => {
    const fresh = { cursor: null, carried: { ...ZERO, startedAtUtcMs: NOW } };
    expect(
      BackfillPlanSystem.resume(
        resume,
        progress({ finishedAtUtcMs: nowPlus(-5) }),
        NOW,
      ),
    ).toEqual(fresh);
    expect(BackfillPlanSystem.resume(resume, null, NOW)).toEqual(fresh);
    expect(BackfillPlanSystem.resume(top, progress(), NOW)).toEqual(fresh);
  });

  it('takes a sent cursor, carrying counts only while continuing an unfinished run', () => {
    expect(
      BackfillPlanSystem.resume(after('appt_3'), progress(), NOW).carried
        .processed,
    ).toBe(40);
    expect(BackfillPlanSystem.resume(after('appt_3'), null, NOW)).toEqual({
      cursor: 'appt_3',
      carried: { ...ZERO, startedAtUtcMs: NOW },
    });
  });
});

describe('pageWalk and nextPage — how a run goes on', () => {
  const walkOf = (
    handled: number,
    ids: readonly string[] = ['a', 'b', 'c'],
    pageSize = 3,
    phase: BackfillPhase = BackfillPhase.Appointments,
  ): BackfillPageWalk =>
    BackfillPlanSystem.pageWalk(phase, ids, handled, 'x', pageSize);

  it('stops at the last row handled, early when the budget left rows, exhausted on a short full page', () => {
    expect(walkOf(2)).toEqual({
      next: { backfillPhase: 'APPOINTMENTS', after: 'b' },
      exhausted: false,
      stoppedEarly: true,
    });
    expect(walkOf(0)).toMatchObject({
      next: { after: 'x' },
      stoppedEarly: true,
    });
    expect(walkOf(3)).toMatchObject({ exhausted: false, stoppedEarly: false });
    expect(walkOf(2, ['a', 'b'])).toMatchObject({
      next: { after: 'b' },
      exhausted: true,
    });
    expect(walkOf(0, [])).toMatchObject({
      next: { after: 'x' },
      exhausted: true,
      stoppedEarly: false,
    });
  });

  it('sends the stats job on to the stored clients when the appointments run out', () => {
    const verdict = BackfillPlanSystem.nextPage(
      BackfillJobName.ClientStats,
      walkOf(2, ['a', 'b']),
      { ...ZERO, processed: 2 },
      () => {
        throw new Error('the budget is no question here');
      },
    );
    expect(verdict).toEqual({
      cursor: '~',
      done: false,
      takeSample: false,
      sampleDeferred: false,
    });
  });

  it('finishes the mirror job at the end of the appointments, with no sample', () => {
    expect(
      BackfillPlanSystem.nextPage(
        BackfillJobName.SubjectMirror,
        walkOf(2, ['a', 'b']),
        { ...ZERO, processed: 2 },
        () => true,
      ),
    ).toEqual({
      cursor: 'b',
      done: true,
      takeSample: false,
      sampleDeferred: false,
    });
  });

  it('closes the stats job with a sample — deferred once when this call already worked and spent its budget', () => {
    const end = walkOf(1, ['c1'], 3, BackfillPhase.StoredClients);
    expect(
      BackfillPlanSystem.nextPage(
        BackfillJobName.ClientStats,
        end,
        { ...ZERO, storedClients: 1 },
        () => true,
      ),
    ).toEqual({
      cursor: '~c1',
      done: false,
      takeSample: false,
      sampleDeferred: true,
    });
    expect(
      BackfillPlanSystem.nextPage(
        BackfillJobName.ClientStats,
        end,
        { ...ZERO, storedClients: 1 },
        () => false,
      ),
    ).toMatchObject({ done: true, takeSample: true });
    // The next call finds the phase empty and takes the sample first thing.
    expect(
      BackfillPlanSystem.nextPage(
        BackfillJobName.ClientStats,
        BackfillPlanSystem.pageWalk(
          BackfillPhase.StoredClients,
          [],
          0,
          'c1',
          3,
        ),
        ZERO,
        () => true,
      ),
    ).toEqual({
      cursor: '~c1',
      done: true,
      takeSample: true,
      sampleDeferred: false,
    });
  });

  it('carries on mid-page', () => {
    expect(
      BackfillPlanSystem.nextPage(
        BackfillJobName.ClientStats,
        walkOf(3),
        { ...ZERO, processed: 3 },
        () => true,
      ),
    ).toEqual({
      cursor: 'c',
      done: false,
      takeSample: false,
      sampleDeferred: false,
    });
  });
});

describe('purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const row = deepFreeze(rowOf({ seats, subjectUserIds: ['ana'] }));
    const actions = deepFreeze([AuditAction.BookingCommitted]);
    const once = mirrorPatch(row, inferPlacement(actions));
    const twice = mirrorPatch(row, inferPlacement(actions));
    expect(twice).toEqual(once);
    const previous = deepFreeze(progress());
    expect(BackfillPlanSystem.resume(resume, previous, NOW)).toEqual(
      BackfillPlanSystem.resume(resume, previous, NOW),
    );
    const items = deepFreeze([1, 2, 3]);
    expect(BackfillPlanSystem.chunk(items, 2)).toEqual(
      BackfillPlanSystem.chunk(items, 2),
    );
    expect(
      requestOf(
        deepFreeze({ backfillJobName: 'CLIENT_STATS', cursor: '~ana' }),
      ),
    ).toEqual(requestOf({ backfillJobName: 'CLIENT_STATS', cursor: '~ana' }));
  });
});
