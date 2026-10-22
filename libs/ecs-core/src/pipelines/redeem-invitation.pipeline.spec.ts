import { describe, expect, it } from 'vitest';
import { RedemptionCount, WriteOp } from '@core/components';
import {
  EngagementErrorCode,
  InvitationId,
  RepositoryError,
  Result,
  UserId,
} from '@core/primitives';
import { Collections, type Invitation, Subcollections } from '@core/entities';
import {
  FIXTURE_NOW_UTC_MS,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
} from '@core/testing';
import { redeemInvitation } from './redeem-invitation.pipeline';

/*
 * `redeemInvitation` (flip-3 plan F3-2, Phase 4a 4A-3 (5)) — the callable
 * that replaced the client's direct create/update: the verified caller is
 * the referee; ONE transaction reads the invitation and the caller's
 * redemption; the plan is the redemption's `Create` and the count's
 * `Update`, together. A living home for the cases flip 3's dead invitation
 * surface left (F3-12): not found, redeemed once only (existence alone),
 * never by the inviter.
 */

const INVITER = UserId.of('u-inviter');
const REFEREE = UserId.of('u-referee');
const CODE = InvitationId.of('inv-abc');
const INVITATION_PATH = [Collections.Invitations, CODE];
const REDEMPTION_PATH = [
  ...INVITATION_PATH,
  Subcollections.Redemptions,
  REFEREE,
];

function invitation(redemptionCount = 0): Invitation {
  return {
    id: CODE,
    inviterUserId: INVITER,
    inviterName: 'Ivan',
    redemptionCount: RedemptionCount.of(redemptionCount),
    createdAtUtcMs: FIXTURE_NOW_UTC_MS,
  };
}

function rig(
  documents: readonly {
    readonly path: readonly string[];
    readonly body: Record<string, unknown>;
  }[],
) {
  const store = memoryStore(documents);
  const tx = memoryTxPorts(store);
  return {
    store,
    tx,
    run: redeemInvitation({ ...tx, ...recordingTelemetry() }),
  };
}

function stored(entry: Invitation) {
  const body = Object.fromEntries(
    Object.entries(entry).filter(([key]) => key !== 'id'),
  );
  return { path: INVITATION_PATH, body };
}

describe('redeemInvitation', () => {
  it('redeems in ONE plan — the redemption Create and the count Update — reading both in the transaction', async () => {
    const { tx, run } = rig([stored(invitation(2))]);
    expect(await run({ invitationId: CODE, refereeUserId: REFEREE })).toEqual(
      Result.ok({ invitationId: CODE, redemptionCount: 3 }),
    );
    expect(tx.transactions[0]?.reads).toEqual([
      INVITATION_PATH,
      REDEMPTION_PATH,
    ]);
    expect(tx.plans).toEqual([
      [
        WriteOp.create(REDEMPTION_PATH, {
          redeemedAtUtcMs: FIXTURE_NOW_UTC_MS,
        }),
        WriteOp.update(INVITATION_PATH, { redemptionCount: 3 }),
      ],
    ]);
  });

  it('refuses an invitation that is not there, writing nothing', async () => {
    const { tx, run } = rig([]);
    expect(await run({ invitationId: CODE, refereeUserId: REFEREE })).toEqual(
      Result.err({
        errorCode: EngagementErrorCode.InvitationNotFound,
        invitationId: CODE,
      }),
    );
    expect(tx.plans).toEqual([]);
  });

  it('refuses a second redemption by the same referee — the redemption’s existence alone', async () => {
    const { run } = rig([stored(invitation())]);
    expect((await run({ invitationId: CODE, refereeUserId: REFEREE })).ok).toBe(
      true,
    );
    expect(await run({ invitationId: CODE, refereeUserId: REFEREE })).toEqual(
      Result.err({
        errorCode: EngagementErrorCode.InvitationAlreadyRedeemed,
        invitationId: CODE,
      }),
    );
  });

  it('refuses the inviter redeeming their own invitation', async () => {
    const { tx, run } = rig([stored(invitation())]);
    expect(await run({ invitationId: CODE, refereeUserId: INVITER })).toEqual(
      Result.err({
        errorCode: EngagementErrorCode.InvitationSelfRedemption,
      }),
    );
    expect(tx.plans).toEqual([]);
  });

  it('refuses no caller before anything is read', async () => {
    const { tx, run } = rig([stored(invitation())]);
    expect(await run({ invitationId: CODE, refereeUserId: null })).toEqual(
      Result.err({
        errorCode: EngagementErrorCode.InvitationUnauthenticated,
      }),
    );
    expect(tx.transactions).toEqual([]);
  });

  it('answers a lost create race as already redeemed; any other store failure as itself', async () => {
    const raced = redeemInvitation({
      ...memoryTxPorts(memoryStore([])),
      ...recordingTelemetry(),
      commit: async () =>
        Result.err(RepositoryError.alreadyExists(REDEMPTION_PATH.join('/'))),
    });
    expect(await raced({ invitationId: CODE, refereeUserId: REFEREE })).toEqual(
      Result.err({
        errorCode: EngagementErrorCode.InvitationAlreadyRedeemed,
        invitationId: CODE,
      }),
    );
    const down = RepositoryError.writeFailed(null, 'deadline exceeded');
    const failed = redeemInvitation({
      ...memoryTxPorts(memoryStore([])),
      ...recordingTelemetry(),
      commit: async () => Result.err(down),
    });
    expect(
      await failed({ invitationId: CODE, refereeUserId: REFEREE }),
    ).toEqual(Result.err(down));
  });
});
