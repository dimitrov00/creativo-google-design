import {
  InvitationId,
  PrimitiveErrorCode,
  type Result,
} from '@core/primitives';
import {
  EngagementError,
  EngagementErrorCode,
  RepositoryError,
} from '@core/errors';
import { type EdgeError, toHttpsError } from '../edge';
import {
  decodeRedeemInvitation,
  encodeRedeemInvitationAnswer,
  redeemInvitationRefusal,
} from './invitation.wire';
import type { WireRequest } from './wire-read';

/*
 * The `redeemInvitation` callable's wire (Phase 4a 4A-3 (5)) — new with the
 * rules tightening that took the client's direct create/update away: the
 * referee is the VERIFIED caller, read first; the request is
 * `InvitationCall`, the answer `InvitationCall.Redeemed`, a refusal its
 * struct projected.
 */

const request = (data: unknown, uid: string | null): WireRequest => ({
  data,
  ...(uid === null ? {} : { auth: { uid, token: { roles: ['client'] } } }),
});

function wire(result: Result<unknown, EdgeError>) {
  if (result.ok) throw new Error('expected a refusal');
  const thrown = toHttpsError(result.error);
  return { code: thrown.code, details: thrown.details };
}

describe('redeemInvitation — the wire', () => {
  it('refuses nobody before the payload is read', () => {
    for (const data of [null, { invitationId: 'inv-1' }]) {
      expect(wire(decodeRedeemInvitation(request(data, null)))).toEqual({
        code: 'unauthenticated',
        details: {
          errorCode: EngagementErrorCode.InvitationUnauthenticated,
        },
      });
    }
  });

  it('decodes the invitation and the verified referee — never a referee the payload names', () => {
    expect(
      decodeRedeemInvitation(
        request({ invitationId: 'inv-1', refereeUserId: 'u-forged' }, 'u-1'),
      ),
    ).toEqual({
      ok: true,
      value: { invitationId: 'inv-1', refereeUserId: 'u-1' },
    });
  });

  it('refuses a request that names no invitation — an id that is no text included, never coerced', () => {
    for (const data of [{}, { invitationId: '' }, { invitationId: 7 }, null]) {
      expect(wire(decodeRedeemInvitation(request(data, 'u-1')))).toEqual({
        code: 'invalid-argument',
        details: { errorCode: PrimitiveErrorCode.IdEmpty },
      });
    }
  });

  it('answers the invitation and its count, a refusal as its struct, and throws a store failure', () => {
    expect(
      encodeRedeemInvitationAnswer({
        invitationId: InvitationId.of('inv-1'),
        redemptionCount: 3,
      }),
    ).toEqual({ invitationId: 'inv-1', redemptionCount: 3 });
    const invitation = InvitationId.of('inv-1');
    expect(
      redeemInvitationRefusal(EngagementError.invitationNotFound(invitation)),
    ).toEqual(EngagementError.invitationNotFound(invitation));
    expect(() =>
      redeemInvitationRefusal(
        RepositoryError.writeFailed('invitations/inv-1', 'aborted'),
      ),
    ).toThrow('REPOSITORY_WRITE_FAILED');
  });
});
