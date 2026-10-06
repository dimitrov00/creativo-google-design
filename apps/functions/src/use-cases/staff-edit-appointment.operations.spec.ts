import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { operationDigest } from './staff-edit-appointment.operations';

// The ledger's own specs live with its persisted shape, in
// `@creativo/application/booking` (`applied-operations-document.spec.ts`).

const MOVE = { kind: 'move', startIso: '2026-08-03T11:00:00.000+03:00' };

describe('operationDigest', () => {
  it('is the same for the same batch and different for a different one', () => {
    expect(operationDigest([MOVE])).toBe(operationDigest([{ ...MOVE }]));
    expect(operationDigest([MOVE])).not.toBe(
      operationDigest([{ ...MOVE, startIso: '2026-08-03T12:00:00.000+03:00' }]),
    );
    // Order is part of the intent: a move then a resize is not a resize
    // then a move.
    const resize = { kind: 'resize', edge: 'end', atIso: MOVE.startIso };
    expect(operationDigest([MOVE, resize])).not.toBe(
      operationDigest([resize, MOVE]),
    );
  });

  it('is sixteen hex digits whatever goes in', () => {
    fc.assert(
      fc.property(fc.array(fc.jsonValue(), { maxLength: 6 }), (commands) => {
        expect(operationDigest(commands)).toMatch(/^[0-9a-f]{16}$/);
      }),
    );
  });
});
