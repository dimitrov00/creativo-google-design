import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PlacementKind } from '../components/placement-kind.data';
import {
  BackfillJobId,
  BackfillJobKind,
  type BackfillJobEntity,
} from '../entities/backfill-job.entity';
import { deepFreeze } from '../testing';
import {
  BackfillPhase,
  type BackfillPageWalk,
  BackfillPlanSystem,
  type BackfillPosition,
  BackfillStartKind,
  type MirrorPatch,
  type MirrorRow,
} from './backfill-plan.system';

/*
 * The cases of apps/functions/src/lib/ops/backfill-plan.spec.ts, copied (the
 * legacy spec keeps running against its shim) and re-targeted: a stored row
 * is read into a `MirrorRow` first (`rowOf` — the seats' subjects derived
 * the R33 way, the placements through the `PlacementKind` guard), and a
 * request names its start as a `BackfillStart` instead of an absent key.
 * Then the page bookkeeping of `run-backfill.ts`, which the system now owns.
 */

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
  { subject: { kind: 'account', userId: 'zora', relationship: 'companion' } },
  { subject: { kind: 'anonymous', label: 'Гост' } },
  { subject: { kind: 'account', userId: 'ana', relationship: 'self' } },
];

type StoredRow = {
  readonly seats: readonly { readonly subject: Record<string, unknown> }[];
  readonly subjectUserIds?: unknown;
  readonly placement?: unknown;
  readonly inferredPlacement?: unknown;
};

/** A stored row as the backfill reads it: every account on its seats once, sorted. */
function rowOf(data: StoredRow): MirrorRow {
  const subjects = new Set<string>();
  for (const seat of data.seats) {
    const { kind, userId } = seat.subject;
    if (kind === 'account' && typeof userId === 'string') subjects.add(userId);
  }
  return {
    storedSubjectUserIds: Array.isArray(data.subjectUserIds)
      ? (data.subjectUserIds as readonly unknown[])
      : null,
    seatSubjectUserIds: [...subjects].sort(),
    placement: PlacementKind.parse(data.placement ?? null),
    inferredPlacement: PlacementKind.parse(data.inferredPlacement ?? null),
  };
}

/** The row with the patch applied, as the shell's `update()` would leave it. */
function patched(row: MirrorRow, patch: MirrorPatch | null): MirrorRow {
  if (patch === null) return row;
  return {
    ...row,
    storedSubjectUserIds: patch.subjectUserIds ?? row.storedSubjectUserIds,
    inferredPlacement: patch.inferredPlacement ?? row.inferredPlacement,
  };
}

const resume = { kind: BackfillStartKind.Resume } as const;
const top = { kind: BackfillStartKind.Top } as const;
const after = (cursor: string) =>
  ({ kind: BackfillStartKind.After, cursor }) as const;

describe('requestOf (toBackfillRequest)', () => {
  it('takes a known job, with a cursor to resume after, null to restart, or none', () => {
    expect(requestOf({ job: 'clientStats' })).toEqual({
      job: 'clientStats',
      start: resume,
    });
    expect(requestOf({ job: 'subjectMirror', cursor: null })).toEqual({
      job: 'subjectMirror',
      start: top,
    });
    expect(requestOf({ job: 'clientStats', cursor: 'appt_42' })).toEqual({
      job: 'clientStats',
      start: after('appt_42'),
    });
  });

  it('refuses an unknown job and a cursor that is not a document id', () => {
    expect(requestOf({ job: 'dropEverything' })).toBeNull();
    expect(requestOf(null)).toBeNull();
    expect(requestOf({ job: 'clientStats', cursor: '../users/x' })).toBeNull();
    expect(requestOf({ job: 'clientStats', cursor: 7 })).toBeNull();
    expect(requestOf({ job: 'clientStats', cursor: '~../users/x' })).toBeNull();
  });

  it('takes a stored-client cursor for the stats job only', () => {
    expect(requestOf({ job: 'clientStats', cursor: '~' })).toEqual({
      job: 'clientStats',
      start: after('~'),
    });
    expect(requestOf({ job: 'clientStats', cursor: '~ana' })).toEqual({
      job: 'clientStats',
      start: after('~ana'),
    });
    expect(requestOf({ job: 'subjectMirror', cursor: '~' })).toBeNull();
  });

  it('reads an explicit undefined cursor as none, and a non-object as no request', () => {
    expect(requestOf({ job: 'subjectMirror', cursor: undefined })).toEqual({
      job: 'subjectMirror',
      start: resume,
    });
    expect(requestOf('clientStats')).toBeNull();
    expect(BackfillPlanSystem.isDocId('appt_42')).toBe(true);
    expect(BackfillPlanSystem.isDocId('a/b')).toBe(false);
  });
});

describe('the backfill cursor', () => {
  it('round-trips both phases, and an appointment id stays what it was', () => {
    const positions: readonly BackfillPosition[] = [
      { phase: 'appointments', after: null },
      { phase: 'appointments', after: 'appt_42' },
      { phase: 'storedClients', after: null },
      { phase: 'storedClients', after: 'dev-client-3' },
    ];
    for (const position of positions) {
      expect(positionOf(cursorOf(position))).toEqual(position);
    }
    expect(cursorOf({ phase: 'appointments', after: 'appt_42' })).toBe(
      'appt_42',
    );
  });
});

describe('inferPlacement (§12.5.1)', () => {
  it('believes the commit row when there is one', () => {
    expect(inferPlacement(['booking.staff_created'])).toBe('staff');
    expect(inferPlacement(['booking.tip_recorded', 'booking.committed'])).toBe(
      'self',
    );
  });

  // A legacy import has no audit rows and must import WITHOUT a placement,
  // or every legacy visit reads as the client's own request for good.
  it('infers nothing without a commit row, owner or not', () => {
    expect(inferPlacement([])).toBeNull();
    expect(inferPlacement(['booking.tip_recorded'])).toBeNull();
  });
});

describe('mirrorPatch', () => {
  it('fills in both mirrors on a row written before them, the placement as an inference', () => {
    expect(mirrorPatch(rowOf({ seats }), 'staff')).toEqual({
      subjectUserIds: ['ana', 'zora'],
      inferredPlacement: 'staff',
    });
  });

  // The bug this shape exists for: stamping `placement` here made a pre-P0
  // row's defaulted `specific` seats read as requests (§11.2 #6).
  it('never writes the commit’s own placement stamp', () => {
    expect(mirrorPatch(rowOf({ seats }), 'self')).not.toHaveProperty(
      'placement',
    );
    expect(
      mirrorPatch(rowOf({ seats, subjectUserIds: ['ana', 'zora'] }), 'staff'),
    ).toEqual({ subjectUserIds: null, inferredPlacement: 'staff' });
  });

  it('leaves an unknown placement unwritten, so a rerun stays a no-op', () => {
    expect(mirrorPatch(rowOf({ seats }), null)).toEqual({
      subjectUserIds: ['ana', 'zora'],
      inferredPlacement: null,
    });
    expect(
      mirrorPatch(rowOf({ seats, subjectUserIds: ['ana', 'zora'] }), null),
    ).toBeNull();
  });

  it('corrects a subject mirror that disagrees with the seats', () => {
    expect(
      mirrorPatch(
        rowOf({ seats, subjectUserIds: ['ana'], placement: 'self' }),
        'staff',
      ),
    ).toEqual({ subjectUserIds: ['ana', 'zora'], inferredPlacement: null });
  });

  it('infers nothing over a placement the commit stamped', () => {
    expect(
      mirrorPatch(
        rowOf({ seats, subjectUserIds: ['ana', 'zora'], placement: 'self' }),
        'staff',
      ),
    ).toBeNull();
  });

  it('never overwrites an inference it already made', () => {
    expect(
      mirrorPatch(
        rowOf({
          seats,
          subjectUserIds: ['ana', 'zora'],
          inferredPlacement: 'self',
        }),
        'staff',
      ),
    ).toBeNull();
  });

  it('is null on a complete row, which is what makes a second run a no-op', () => {
    expect(
      mirrorPatch(
        rowOf({ seats: [], subjectUserIds: [], placement: 'staff' }),
        'self',
      ),
    ).toBeNull();
  });
});

describe('mirrorPatch — properties', () => {
  const placementArb = fc.constantFrom('self', 'staff', null, 'robot');
  const rowArb = fc.record(
    {
      seats: fc.constantFrom(seats, [], seats.slice(1)),
      subjectUserIds: fc.constantFrom(['ana', 'zora'], ['ana'], [], 'x'),
      placement: placementArb,
      inferredPlacement: placementArb,
    },
    { requiredKeys: ['seats'] },
  );
  const inferredArb = fc.constantFrom('self' as const, 'staff' as const, null);

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
    expect(mayLackMirrors(rowOf({ seats, placement: 'self' }))).toBe(true);
    expect(
      mayLackMirrors(rowOf({ seats, subjectUserIds: ['ana', 'zora'] })),
    ).toBe(true);
    expect(
      mayLackMirrors(
        rowOf({ seats, subjectUserIds: ['ana', 'zora'], placement: 'staff' }),
      ),
    ).toBe(false);
    expect(
      mayLackMirrors(
        rowOf({
          seats,
          subjectUserIds: ['ana', 'zora'],
          inferredPlacement: 'staff',
        }),
      ),
    ).toBe(false);
  });
});

/* ── The page bookkeeping (run-backfill.ts) ───────────────────────────── */

const NOW = Date.parse('2026-09-25T08:00:00.000Z');

function progress(
  overrides: Partial<BackfillJobEntity> = {},
): BackfillJobEntity {
  return {
    id: BackfillJobId.of('clientStats'),
    job: BackfillJobKind.ClientStats,
    cursor: 'appt_9',
    processed: 40,
    storedClients: 3,
    stamped: 2,
    recomputed: 7,
    startedAtMs: NOW - 60_000,
    finishedAtMs: null,
    updatedAtMs: NOW - 1_000,
    sample: null,
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
        startedAtMs: NOW - 60_000,
      },
    });
  });

  it('starts a new run from the top after a finished one, with no progress, or when asked to', () => {
    const fresh = { cursor: null, carried: { ...ZERO, startedAtMs: NOW } };
    expect(
      BackfillPlanSystem.resume(
        resume,
        progress({ finishedAtMs: NOW - 5 }),
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
      carried: { ...ZERO, startedAtMs: NOW },
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
      next: { phase: 'appointments', after: 'b' },
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
      BackfillJobKind.ClientStats,
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
        BackfillJobKind.SubjectMirror,
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
        BackfillJobKind.ClientStats,
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
        BackfillJobKind.ClientStats,
        end,
        { ...ZERO, storedClients: 1 },
        () => false,
      ),
    ).toMatchObject({ done: true, takeSample: true });
    // The next call finds the phase empty and takes the sample first thing.
    expect(
      BackfillPlanSystem.nextPage(
        BackfillJobKind.ClientStats,
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
        BackfillJobKind.ClientStats,
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
    const actions = deepFreeze(['booking.committed']);
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
      requestOf(deepFreeze({ job: 'clientStats', cursor: '~ana' })),
    ).toEqual(requestOf({ job: 'clientStats', cursor: '~ana' }));
  });
});
