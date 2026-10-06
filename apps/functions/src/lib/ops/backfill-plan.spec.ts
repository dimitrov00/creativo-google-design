import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  cursorOf,
  inferPlacement,
  lacksPlacement,
  mayLackMirrors,
  mirrorPatch,
  positionOf,
  toBackfillRequest,
} from './backfill-plan';

const seats = [
  { subject: { kind: 'account', userId: 'zora', relationship: 'companion' } },
  { subject: { kind: 'anonymous', label: 'Гост' } },
  { subject: { kind: 'account', userId: 'ana', relationship: 'self' } },
];

describe('toBackfillRequest', () => {
  it('takes a known job, with a cursor to resume after, null to restart, or none', () => {
    expect(toBackfillRequest({ job: 'clientStats' })).toEqual({
      job: 'clientStats',
    });
    expect(toBackfillRequest({ job: 'subjectMirror', cursor: null })).toEqual({
      job: 'subjectMirror',
      cursor: null,
    });
    expect(
      toBackfillRequest({ job: 'clientStats', cursor: 'appt_42' }),
    ).toEqual({ job: 'clientStats', cursor: 'appt_42' });
  });

  it('refuses an unknown job and a cursor that is not a document id', () => {
    expect(toBackfillRequest({ job: 'dropEverything' })).toBeNull();
    expect(toBackfillRequest(null)).toBeNull();
    expect(
      toBackfillRequest({ job: 'clientStats', cursor: '../users/x' }),
    ).toBeNull();
    expect(toBackfillRequest({ job: 'clientStats', cursor: 7 })).toBeNull();
    expect(
      toBackfillRequest({ job: 'clientStats', cursor: '~../users/x' }),
    ).toBeNull();
  });

  it('takes a stored-client cursor for the stats job only', () => {
    expect(toBackfillRequest({ job: 'clientStats', cursor: '~' })).toEqual({
      job: 'clientStats',
      cursor: '~',
    });
    expect(toBackfillRequest({ job: 'clientStats', cursor: '~ana' })).toEqual({
      job: 'clientStats',
      cursor: '~ana',
    });
    expect(toBackfillRequest({ job: 'subjectMirror', cursor: '~' })).toBeNull();
  });
});

describe('the backfill cursor', () => {
  it('round-trips both phases, and an appointment id stays what it was', () => {
    const positions = [
      { phase: 'appointments', after: null },
      { phase: 'appointments', after: 'appt_42' },
      { phase: 'storedClients', after: null },
      { phase: 'storedClients', after: 'dev-client-3' },
    ] as const;
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
    expect(mirrorPatch({ seats }, 'staff')).toEqual({
      subjectUserIds: ['ana', 'zora'],
      inferredPlacement: 'staff',
    });
  });

  // The bug this shape exists for: stamping `placement` here made a pre-P0
  // row's defaulted `specific` seats read as requests (§11.2 #6).
  it('never writes the commit’s own placement stamp', () => {
    expect(mirrorPatch({ seats }, 'self')).not.toHaveProperty('placement');
    expect(
      mirrorPatch({ seats, subjectUserIds: ['ana', 'zora'] }, 'staff'),
    ).toEqual({ inferredPlacement: 'staff' });
  });

  it('leaves an unknown placement unwritten, so a rerun stays a no-op', () => {
    expect(mirrorPatch({ seats }, null)).toEqual({
      subjectUserIds: ['ana', 'zora'],
    });
    expect(
      mirrorPatch({ seats, subjectUserIds: ['ana', 'zora'] }, null),
    ).toBeNull();
  });

  it('corrects a subject mirror that disagrees with the seats', () => {
    expect(
      mirrorPatch(
        { seats, subjectUserIds: ['ana'], placement: 'self' },
        'staff',
      ),
    ).toEqual({ subjectUserIds: ['ana', 'zora'] });
  });

  it('infers nothing over a placement the commit stamped', () => {
    expect(
      mirrorPatch(
        { seats, subjectUserIds: ['ana', 'zora'], placement: 'self' },
        'staff',
      ),
    ).toBeNull();
  });

  it('never overwrites an inference it already made', () => {
    expect(
      mirrorPatch(
        { seats, subjectUserIds: ['ana', 'zora'], inferredPlacement: 'self' },
        'staff',
      ),
    ).toBeNull();
  });

  it('is null on a complete row, which is what makes a second run a no-op', () => {
    expect(
      mirrorPatch(
        { seats: [], subjectUserIds: [], placement: 'staff' },
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
      fc.property(rowArb, inferredArb, (row, inferred) => {
        const patched = { ...row, ...mirrorPatch(row, inferred) };
        expect(mirrorPatch(patched, inferred)).toBeNull();
        expect(mayLackMirrors(patched)).toBe(lacksPlacement(patched));
      }),
    );
  });

  it('never writes `placement`, and never changes a stamped one', () => {
    fc.assert(
      fc.property(rowArb, inferredArb, (row, inferred) => {
        const patch = mirrorPatch(row, inferred) ?? {};
        expect(patch).not.toHaveProperty('placement');
        if (!lacksPlacement(row)) {
          expect(patch).not.toHaveProperty('inferredPlacement');
        }
      }),
    );
  });
});

describe('mayLackMirrors', () => {
  it('flags a row whose subjects disagree or which has no placement of either kind', () => {
    expect(mayLackMirrors({ seats, placement: 'self' })).toBe(true);
    expect(mayLackMirrors({ seats, subjectUserIds: ['ana', 'zora'] })).toBe(
      true,
    );
    expect(
      mayLackMirrors({
        seats,
        subjectUserIds: ['ana', 'zora'],
        placement: 'staff',
      }),
    ).toBe(false);
    expect(
      mayLackMirrors({
        seats,
        subjectUserIds: ['ana', 'zora'],
        inferredPlacement: 'staff',
      }),
    ).toBe(false);
  });
});
