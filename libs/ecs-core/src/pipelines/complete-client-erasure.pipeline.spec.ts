import { describe, expect, it } from 'vitest';
import { type ClientPrivacyCall, ErasureCensus } from '@core/components';
import {
  PipelineError,
  PipelineErrorCode,
  PrivacyErrorCode,
} from '@core/errors';
import { ClientOperationId, CustomerId, Result } from '@core/primitives';
import type { ClientPrivacyGatewayPorts } from '@core/ports';
import { deepFreeze, unwrapOk } from '@core/testing';
import {
  completeClientErasure,
  MAX_ERASURE_CALLS,
} from './complete-client-erasure.pipeline';

/* The browser's erasure loop (audit-hardening Phase 3 WS-D): the SAME act
 * sent to the resumable `eraseClient` until it answers done, bounded, a
 * refusal ending it at once. */

/** The act the card captured at the preview — one record, one minted id. */
const CALL: ClientPrivacyCall = deepFreeze({
  customerId: CustomerId.of('cus_0123456789abcdef0123'),
  operationId: unwrapOk(ClientOperationId.parse('op_erasure_000001')),
});

/** A call that left work: the record ERASING, a residue of notes. */
function unfinished(notes: number): ClientPrivacyCall.Erasure {
  return {
    erasureStatus: 'ERASING',
    erasureDone: false,
    ...ErasureCensus.EMPTY,
    erasureNoteCount: notes,
    erasureVisitCount: 3,
  };
}

/** The call that completed: ERASED, every personal count 0. */
const DONE: ClientPrivacyCall.Erasure = {
  erasureStatus: 'ERASED',
  erasureDone: true,
  ...ErasureCensus.EMPTY,
  erasureVisitCount: 3,
};

type Answer = Result<ClientPrivacyCall.Erasure, PipelineError>;

/**
 * The privacy gateway with `eraseClient` scripted — each answer in turn,
 * the last one repeating — every call recorded; the export and the preview
 * must never be dialled by the loop (each records a call of its own).
 */
function scripted(...answers: readonly Answer[]): {
  readonly ports: ClientPrivacyGatewayPorts;
  readonly erased: ClientPrivacyCall[];
  readonly others: string[];
} {
  const erased: ClientPrivacyCall[] = [];
  const others: string[] = [];
  const unknown = Result.err(PipelineError.bare(PipelineErrorCode.Unknown));
  return {
    erased,
    others,
    ports: {
      exportClientData: async () => {
        others.push('exportClientData');
        return unknown;
      },
      previewClientErasure: async () => {
        others.push('previewClientErasure');
        return unknown;
      },
      eraseClient: async (call) => {
        erased.push(call);
        const answer = answers[Math.min(erased.length, answers.length) - 1];
        if (answer === undefined) throw new Error('no scripted answer');
        return answer;
      },
    },
  };
}

/** A refusal as the callable client hands it on (`PRIVACY_*` from the wire). */
function refused(serverErrorCode: string): Answer {
  return Result.err(
    PipelineError.of(PipelineErrorCode.Unknown, serverErrorCode, null, null),
  );
}

describe('completeClientErasure', () => {
  it('one call when the first answer is done — that answer, as it came', async () => {
    const rig = scripted(Result.ok(DONE));
    expect(await completeClientErasure(rig.ports)(CALL)).toEqual(
      Result.ok(DONE),
    );
    expect(rig.erased).toEqual([CALL]);
    expect(rig.others).toEqual([]);
  });

  it('loops until the erasure is done, sending the SAME act every time — one record, one operation id', async () => {
    const rig = scripted(
      Result.ok(unfinished(9)),
      Result.ok(unfinished(4)),
      Result.ok(DONE),
    );
    const answer = await completeClientErasure(rig.ports)(CALL);
    expect(answer).toEqual(Result.ok(DONE));
    expect(rig.erased).toHaveLength(3);
    for (const call of rig.erased) expect(call).toBe(CALL);
    expect(new Set(rig.erased.map((call) => call.operationId)).size).toBe(1);
    expect(rig.others).toEqual([]);
  });

  it(`stops at MAX_ERASURE_CALLS (${MAX_ERASURE_CALLS}) and hands back the last answer, not done`, async () => {
    const rig = scripted(Result.ok(unfinished(1)));
    const answer = await completeClientErasure(rig.ports)(CALL);
    expect(rig.erased).toHaveLength(MAX_ERASURE_CALLS);
    expect(answer).toEqual(Result.ok(unfinished(1)));
    expect(unwrapOk(answer).erasureDone).toBe(false);
  });

  it('a refusal ends the loop at once and is answered as it came', async () => {
    const refusal = refused(PrivacyErrorCode.ErasureStaffAccount);
    const rig = scripted(refusal);
    expect(await completeClientErasure(rig.ports)(CALL)).toBe(refusal);
    expect(rig.erased).toHaveLength(1);
  });

  it('a failure after progress ends the loop too — no further call', async () => {
    const failure = Result.err(
      PipelineError.bare(PipelineErrorCode.Unavailable),
    );
    const rig = scripted(Result.ok(unfinished(5)), failure, Result.ok(DONE));
    expect(await completeClientErasure(rig.ports)(CALL)).toBe(failure);
    expect(rig.erased).toHaveLength(2);
  });

  it('an ERASED record whose re-sweep left residue keeps going until done', async () => {
    const resweptResidue: ClientPrivacyCall.Erasure = {
      ...unfinished(1),
      erasureStatus: 'ERASED',
    };
    const rig = scripted(Result.ok(resweptResidue), Result.ok(DONE));
    expect(await completeClientErasure(rig.ports)(CALL)).toEqual(
      Result.ok(DONE),
    );
    expect(rig.erased).toHaveLength(2);
  });

  it('leaves the act untouched (frozen) — the loop mints and changes nothing', async () => {
    const rig = scripted(Result.ok(unfinished(2)), Result.ok(DONE));
    await completeClientErasure(rig.ports)(CALL);
    expect(CALL).toEqual({
      customerId: 'cus_0123456789abcdef0123',
      operationId: 'op_erasure_000001',
    });
  });
});
