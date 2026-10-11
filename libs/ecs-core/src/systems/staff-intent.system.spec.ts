import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AppliedOperation } from '../components/applied-operation.data';
import { AppointmentId, OperationId } from '../primitives/ids.primitive';
import { deepFreeze } from '../testing';
import {
  type LandedRevision,
  StaffIntentSystem,
  type UnsettledName,
} from './staff-intent.system';

/*
 * COPIED and re-targeted: the claim-chain cases of «every staff intent goes
 * out named (2026-09-25)» in libs/features/staff/dashboard/src/lib/
 * staff-dashboard/staff-dashboard.spec.ts (11 of its 13): the store's
 * `staffEdit` funnel is replayed by `device()` below — the claim, the
 * intent key, the name and the two lists, every decision taken by
 * `StaffIntentSystem`, the gateway's answers scripted per case. The queue
 * itself (a drop held while a save is in flight) is the store's, so the
 * queued cases are replayed in the order the queue sends them; the two
 * cases that only exercise the component (the queue's own naming of an
 * in-flight drop, the sheet's «Запази» wiring) stay in the component spec.
 * Plus the list rules, a property of the claim and purity. Flatten pass:
 * the visit and the name are `AppointmentId` / `OperationId` brands (Law 7);
 * the batch stays the opaque wire command the store sends.
 */

const S = StaffIntentSystem;

const MOVE = {
  kind: 'move',
  startIso: '2026-08-05T11:00:00.000+03:00',
} as const;

type Intent = {
  readonly appointmentId: string;
  readonly command: unknown;
  readonly acknowledgedOverlap?: boolean;
  readonly operationId?: string;
  readonly expectedVersion?: number | null;
};

type Sent = {
  readonly operationId: OperationId;
  readonly expectedVersion: number | null;
};

type Answer =
  | { readonly kind: 'ok'; readonly revision: number }
  | { readonly kind: 'lost' };

/** One device's funnel over the system, with the gateway's answers scripted. */
function device(answer: (sent: Sent, index: number) => Answer) {
  const sent: Sent[] = [];
  let chain: readonly LandedRevision[] = [];
  let names: readonly UnsettledName[] = [];
  let minted = 0;
  return {
    sent,
    send(intent: Intent): boolean {
      const claim = S.claimFor(chain, intent.expectedVersion ?? null);
      const key = S.intentBasis(
        AppointmentId.of(intent.appointmentId),
        intent.command,
        intent.acknowledgedOverlap === true,
        claim,
      );
      const operationId =
        (intent.operationId === undefined
          ? null
          : OperationId.of(intent.operationId)) ??
        S.operationIdFor(names, key) ??
        OperationId.of(`operation-${String(++minted).padStart(16, '0')}`);
      const request = { operationId, expectedVersion: claim };
      const reply = answer(request, sent.length);
      sent.push(request);
      if (reply.kind === 'lost') {
        names = S.rememberUnsettled(names, key, operationId);
        return false;
      }
      names = S.settle(names, key);
      chain = S.recordLanded(chain, claim, reply.revision);
      return true;
    },
  };
}

/** Answers in order; past the script, every send lands. */
const scripted =
  (answers: readonly ('ok' | 'lost')[]) =>
  (_: Sent, index: number): Answer =>
    (answers.at(index) ?? 'ok') === 'ok'
      ? { kind: 'ok', revision: index + 1 }
      : { kind: 'lost' };

/** A gateway that stamps the next revision after the one claimed. */
const stamps =
  (refuse: (sent: Sent) => boolean = () => false) =>
  (request: Sent): Answer =>
    refuse(request)
      ? { kind: 'lost' }
      : { kind: 'ok', revision: (request.expectedVersion ?? 0) + 1 };

describe('every staff intent goes out named (2026-09-25)', () => {
  it('re-sends a failed intent under its own name, and names the next one afresh', () => {
    const d = device(scripted(['lost', 'ok', 'ok']));
    // The answer is lost; the barber taps «Запази» again on the same draft.
    expect(d.send({ appointmentId: 'appointment-1', command: MOVE })).toBe(
      false,
    );
    expect(d.send({ appointmentId: 'appointment-1', command: MOVE })).toBe(
      true,
    );
    // Landed — so the same batch again is the barber doing it AGAIN.
    d.send({ appointmentId: 'appointment-1', command: MOVE });

    const names = d.sent.map((request) => request.operationId);
    expect(names[0]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(names[1]).toBe(names[0]);
    expect(names[2]).not.toBe(names[0]);
  });

  it('names a changed draft afresh even after a failure', () => {
    const d = device(scripted(['lost', 'ok']));
    d.send({ appointmentId: 'appointment-1', command: MOVE });
    d.send({
      appointmentId: 'appointment-1',
      command: { ...MOVE, startIso: '2026-08-05T12:00:00.000+03:00' },
    });
    expect(d.sent[1]?.operationId).not.toBe(d.sent[0]?.operationId);
  });

  it('treats an acknowledged overlap as a new decision, not a re-send', () => {
    const d = device(scripted(['lost', 'ok']));
    d.send({ appointmentId: 'appointment-1', command: MOVE });
    d.send({
      appointmentId: 'appointment-1',
      command: MOVE,
      acknowledgedOverlap: true,
    });
    expect(d.sent[1]?.operationId).not.toBe(d.sent[0]?.operationId);
  });

  it('keeps a name the caller chose', () => {
    const d = device(scripted(['ok']));
    d.send({
      appointmentId: 'appointment-1',
      command: MOVE,
      operationId: 'operation-chosen-by-caller',
    });
    expect(d.sent[0]?.operationId).toBe('operation-chosen-by-caller');
  });

  // Round 3 (2026-09-25): the name was kept per VISIT and cleared by any
  // success, so a lost-but-committed intent superseded by a queued drop
  // that landed went out afresh the next time — and applied twice.
  it('keeps a failed intent’s name across a queued drop that landed — the same intent sent again is still one change', () => {
    const d = device(scripted(['lost', 'ok', 'ok']));
    // The first answer is lost; the queued drop goes, and lands.
    expect(d.send({ appointmentId: 'appointment-1', command: MOVE })).toBe(
      false,
    );
    d.send({
      appointmentId: 'appointment-1',
      command: { ...MOVE, startIso: '2026-08-05T12:00:00.000+03:00' },
    });
    // The first intent, sent again: under its own name, whatever landed.
    d.send({ appointmentId: 'appointment-1', command: MOVE });
    expect(d.sent).toHaveLength(3);
    expect(d.sent[1]?.operationId).not.toBe(d.sent[0]?.operationId);
    expect(d.sent[2]?.operationId).toBe(d.sent[0]?.operationId);
  });

  it('sends the revision the intent was made on, and a claim of nothing as nothing', () => {
    const d = device(stamps());
    d.send({
      appointmentId: 'appointment-1',
      command: MOVE,
      expectedVersion: 3,
    });
    d.send({
      appointmentId: 'appointment-2',
      command: MOVE,
      expectedVersion: null,
    });
    expect(d.sent.map((request) => request.expectedVersion)).toEqual([3, null]);
  });

  it('carries the claim across its OWN landed intents — a save’s undo is never stale against the save', () => {
    const d = device(stamps());
    // The save, drawn at 3, lands at 4; its undo was drawn at 3 too.
    d.send({
      appointmentId: 'appointment-1',
      command: MOVE,
      expectedVersion: 3,
    });
    d.send({
      appointmentId: 'appointment-1',
      command: { ...MOVE, startIso: '2026-08-05T10:00:00.000+03:00' },
      expectedVersion: 3,
    });
    // …and a third save from the same sheet, still drawn at 3.
    d.send({
      appointmentId: 'appointment-1',
      command: { ...MOVE, startIso: '2026-08-05T12:00:00.000+03:00' },
      expectedVersion: 3,
    });
    expect(d.sent.map((request) => request.expectedVersion)).toEqual([3, 4, 5]);
  });

  it('sends a drop queued behind its own in-flight save on the revision that save stamped', () => {
    const d = device(stamps());
    d.send({
      appointmentId: 'appointment-1',
      command: MOVE,
      expectedVersion: 3,
    });
    // The queued drop goes once the save has landed.
    d.send({
      appointmentId: 'appointment-1',
      command: { ...MOVE, startIso: '2026-08-05T12:00:00.000+03:00' },
      expectedVersion: 3,
    });
    expect(d.sent.map((request) => request.expectedVersion)).toEqual([3, 4]);
  });

  it('never carries a claim across somebody else’s save — the stale refusal stands, and is the row’s', () => {
    const d = device(stamps((request) => request.expectedVersion === 3));
    expect(
      d.send({
        appointmentId: 'appointment-1',
        command: MOVE,
        expectedVersion: 3,
      }),
    ).toBe(false);
    // A refused intent stamped nothing: the next one drawn at 3 claims 3.
    d.send({
      appointmentId: 'appointment-1',
      command: { ...MOVE, startIso: '2026-08-05T12:00:00.000+03:00' },
      expectedVersion: 3,
    });
    expect(d.sent[1]?.expectedVersion).toBe(3);
  });

  it('re-sends a lost intent under its name AND its claim, so the server answers it from the ledger', () => {
    const d = device(scripted(['lost', 'ok']));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      d.send({
        appointmentId: 'appointment-1',
        command: MOVE,
        expectedVersion: 3,
      });
    }
    expect(d.sent[1]?.operationId).toBe(d.sent[0]?.operationId);
    expect(d.sent[1]?.expectedVersion).toBe(3);
  });

  it('holds at most CAP failed names per visit, dropping the oldest', () => {
    const cap = AppliedOperation.CAP;
    const d = device(scripted(Array.from({ length: cap + 2 }, () => 'lost')));
    const at = (minute: number) => ({
      ...MOVE,
      startIso: `2026-08-05T11:${String(minute).padStart(2, '0')}:00.000+03:00`,
    });
    // CAP + 1 different intents fail: the oldest name falls off.
    for (let minute = 0; minute <= cap; minute += 1) {
      d.send({ appointmentId: 'appointment-1', command: at(minute) });
    }
    d.send({ appointmentId: 'appointment-1', command: at(0) });
    expect(d.sent[cap + 1]?.operationId).not.toBe(d.sent[0]?.operationId);
    // The newest is still remembered.
    d.send({ appointmentId: 'appointment-1', command: at(cap) });
    expect(d.sent.at(cap + 2)?.operationId).toBe(d.sent.at(cap)?.operationId);
  });
});

describe('StaffIntentSystem — the two lists', () => {
  it('records only a stamp that climbs, and hands the chain back otherwise', () => {
    const chain: readonly LandedRevision[] = [{ from: 3, to: 4 }];
    expect(S.recordLanded(chain, null, 9)).toBe(chain);
    expect(S.recordLanded(chain, 4, 4)).toBe(chain);
    expect(S.recordLanded(chain, 4, 0)).toBe(chain);
    expect(S.recordLanded(chain, 4, 5)).toEqual([
      { from: 3, to: 4 },
      { from: 4, to: 5 },
    ]);
  });

  it('replaces a link from the same revision in place, and keeps the newest sixteen', () => {
    const chain = S.recordLanded(
      [
        { from: 1, to: 2 },
        { from: 2, to: 3 },
      ],
      1,
      7,
    );
    expect(chain).toEqual([
      { from: 1, to: 7 },
      { from: 2, to: 3 },
    ]);
    let long: readonly LandedRevision[] = [];
    for (let from = 0; from < 20; from++) {
      long = S.recordLanded(long, from, from + 1);
    }
    expect(long).toHaveLength(S.LANDED_PER_VISIT);
    expect(long[0]).toEqual({ from: 4, to: 5 });
  });

  it('keys an intent by its visit, batch, acknowledgement and claim', () => {
    const a1 = AppointmentId.of('a-1');
    const base = S.intentBasis(a1, MOVE, false, 3);
    expect(S.intentBasis(a1, MOVE, false, 3)).toBe(base);
    expect(S.intentBasis(AppointmentId.of('a-2'), MOVE, false, 3)).not.toBe(
      base,
    );
    expect(S.intentBasis(a1, MOVE, true, 3)).not.toBe(base);
    expect(S.intentBasis(a1, MOVE, false, null)).not.toBe(base);
    expect(base).toBe(JSON.stringify(['a-1', MOVE, false, 3]));
  });

  it('moves a name kept again to the end, and settles only that intent', () => {
    let names = S.rememberUnsettled([], 'x', OperationId.of('op-x'));
    names = S.rememberUnsettled(names, 'y', OperationId.of('op-y'));
    names = S.rememberUnsettled(names, 'x', OperationId.of('op-x2'));
    expect(names).toEqual([
      { intent: 'y', operationId: 'op-y' },
      { intent: 'x', operationId: 'op-x2' },
    ]);
    expect(S.settle(names, 'z')).toBe(names);
    expect(S.settle(names, 'y')).toEqual([
      { intent: 'x', operationId: 'op-x2' },
    ]);
    expect(S.operationIdFor(names, 'x')).toBe('op-x2');
    expect(S.operationIdFor(names, 'z')).toBeNull();
  });

  it('carries a claim to the end of a climbing chain, and never past a gap (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 30 }), { maxLength: 12 }),
        fc.integer({ min: 0, max: 30 }),
        (froms, drawn) => {
          let chain: readonly LandedRevision[] = [];
          for (const from of froms)
            chain = S.recordLanded(chain, from, from + 1);
          const claim = S.claimFor(chain, drawn) as number;
          expect(claim).toBeGreaterThanOrEqual(drawn);
          // Every revision walked through was one of this device's own.
          for (let r = drawn; r < claim; r++) {
            expect(chain.some((link) => link.from === r)).toBe(true);
          }
          expect(chain.some((link) => link.from === claim)).toBe(false);
          expect(S.claimFor(chain, null)).toBeNull();
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const chain = deepFreeze([
      { from: 3, to: 4 },
      { from: 4, to: 5 },
    ]);
    const names = deepFreeze([
      { intent: 'x', operationId: OperationId.of('op-x') },
    ]);
    expect(S.claimFor(chain, 3)).toBe(5);
    expect(S.claimFor(chain, 3)).toBe(S.claimFor(chain, 3));
    expect(S.recordLanded(chain, 5, 6)).toEqual(S.recordLanded(chain, 5, 6));
    const opY = OperationId.of('op-y');
    expect(S.rememberUnsettled(names, 'y', opY)).toEqual(
      S.rememberUnsettled(names, 'y', opY),
    );
    expect(chain).toHaveLength(2);
    expect(names).toHaveLength(1);
  });
});
