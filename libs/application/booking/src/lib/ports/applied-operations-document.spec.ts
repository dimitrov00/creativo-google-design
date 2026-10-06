import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  APPOINTMENT_DOCUMENT_FIELDS,
  preservedAppointmentFields,
} from './appointment-document';
import {
  APPLIED_OPERATIONS_FIELD,
  type AppliedOperation,
  AppliedOperations,
} from './applied-operations-document';

function entry(id: string, revision: number): AppliedOperation {
  return { id, revision, digest: '0123456789abcdef' };
}

/** A ledger built by recording `ids` in order, revision = position + 1. */
function recorded(ids: readonly string[]): AppliedOperations {
  return ids.reduce(
    (ledger, id, index) => ledger.record(entry(id, index + 1)),
    AppliedOperations.empty(),
  );
}

const names = fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
  maxLength: AppliedOperations.CAP,
});

describe('the ledger rides every whole-document rewrite (preservedAppointmentFields)', () => {
  it('is not a field the appointment mapper owns', () => {
    expect(APPOINTMENT_DOCUMENT_FIELDS).not.toContain(APPLIED_OPERATIONS_FIELD);
  });

  // The ledger's whole survival story: a staff edit and a client's move both
  // `set()` the visit as `{...preservedAppointmentFields(current), ...mapper}`.
  // Whatever the owned fields hold, the ledger comes out the other side
  // exactly as it went in — so a late re-send is still recognised.
  it('is carried forward whole, whatever the owned fields hold', () => {
    fc.assert(
      fc.property(
        names,
        fc.array(fc.jsonValue(), {
          minLength: APPOINTMENT_DOCUMENT_FIELDS.length,
          maxLength: APPOINTMENT_DOCUMENT_FIELDS.length,
        }),
        (ids, owned) => {
          const ledger = recorded(ids);
          const current = {
            ...Object.fromEntries(
              APPOINTMENT_DOCUMENT_FIELDS.map((field, index) => [
                field,
                owned.at(index),
              ]),
            ),
            ...ledger.toFields(),
            revision: ids.length,
          };
          const preserved = preservedAppointmentFields(current);
          expect(preserved).toEqual({
            [APPLIED_OPERATIONS_FIELD]: ledger.toDocument(),
            revision: ids.length,
          });
          expect(AppliedOperations.fromDocument(preserved).toArray()).toEqual(
            ledger.toArray(),
          );
        },
      ),
    );
  });
});

describe('AppliedOperations — the intents a visit has applied', () => {
  it('finds a recorded intent, and nothing it never recorded', () => {
    const ledger = AppliedOperations.empty().record(entry('op-a', 4));
    expect(ledger.find('op-a')).toEqual(entry('op-a', 4));
    expect(ledger.find('op-b')).toBeNull();
  });

  it('is immutable: recording returns a new ledger', () => {
    const empty = AppliedOperations.empty();
    const one = empty.record(entry('op-a', 1));
    expect(empty.toArray()).toEqual([]);
    expect(one.toArray()).toHaveLength(1);
  });

  it('keeps at most CAP intents, the newest, oldest first', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
          maxLength: AppliedOperations.CAP * 3,
        }),
        (ids) => {
          const ledger = recorded(ids);
          const kept = ids.slice(-AppliedOperations.CAP);
          expect(ledger.toArray().map((known) => known.id)).toEqual(kept);
          // Everything kept is found with the revision it stamped; nothing
          // that fell off is.
          for (const [index, id] of ids.entries()) {
            const found = ledger.find(id);
            if (kept.includes(id)) expect(found?.revision).toBe(index + 1);
            else expect(found).toBeNull();
          }
        },
      ),
    );
  });

  it('never holds one name twice — a re-recorded name moves to the newest place', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('op-a', 'op-b', 'op-c', 'op-d'), {
          maxLength: 40,
        }),
        (ids) => {
          const ledger = recorded(ids);
          const kept = ledger.toArray().map((known) => known.id);
          expect(new Set(kept).size).toBe(kept.length);
          if (ids.length > 0) expect(kept.at(-1)).toBe(ids.at(-1));
        },
      ),
    );
  });

  it('round-trips through the document, and through its field', () => {
    fc.assert(
      fc.property(names, (ids) => {
        const ledger = recorded(ids);
        const again = AppliedOperations.fromDocument({
          [APPLIED_OPERATIONS_FIELD]: ledger.toDocument(),
        });
        expect(again.toArray()).toEqual(ledger.toArray());
        expect(
          AppliedOperations.fromDocument(ledger.toFields()).toArray(),
        ).toEqual(ledger.toArray());
      }),
    );
  });

  it('reads a stored ledger tolerantly — a malformed entry costs only itself', () => {
    const ledger = AppliedOperations.fromDocument({
      [APPLIED_OPERATIONS_FIELD]: [
        { id: 'op-a', revision: 4, digest: 'abc' },
        null,
        'op-b',
        { id: '', revision: 5, digest: 'abc' },
        { id: 'op-c', revision: '6', digest: 'abc' },
        { id: 'op-d', revision: 6.5, digest: 'abc' },
        { id: 'op-e', revision: 7 },
        { id: 'op-f', revision: 8, digest: 'abc' },
      ],
    });
    expect(ledger.toArray().map((known) => known.id)).toEqual(['op-a', 'op-f']);
  });

  it('reads a visit with no ledger — every one written before it existed — as empty', () => {
    expect(AppliedOperations.fromDocument({}).toArray()).toEqual([]);
    expect(
      AppliedOperations.fromDocument({
        [APPLIED_OPERATIONS_FIELD]: 'x',
      }).toArray(),
    ).toEqual([]);
  });

  it('trims an over-long stored ledger to its newest CAP', () => {
    const stored = Array.from(
      { length: AppliedOperations.CAP + 5 },
      (_, index) => ({ id: `op-${index}`, revision: index, digest: 'abc' }),
    );
    const ledger = AppliedOperations.fromDocument({
      [APPLIED_OPERATIONS_FIELD]: stored,
    });
    expect(ledger.toArray()).toHaveLength(AppliedOperations.CAP);
    expect(ledger.find('op-4')).toBeNull();
    expect(ledger.find(`op-${AppliedOperations.CAP + 4}`)).not.toBeNull();
  });
});
