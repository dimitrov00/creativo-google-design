import {
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import {
  UserId,
  EmptyIdError as AccountsEmptyIdError,
} from '@creativo/domain/accounts';
import {
  InvitationId as InvitationRefId,
  RedemptionCount,
  ReferralSystem,
  type InvitationEntity,
  UserId as UserRefId,
} from '@creativo/ecs-core';
import { InvitationId } from './ids';
import { EmptyIdError } from './ids.errors';
import { Invitation } from './invitation';
import { InvitationSelfRedemptionError } from './invitation.errors';

export type InvitationRedemptionError = EmptyIdError | AccountsEmptyIdError;

export interface CreateInvitationRedemptionProps {
  invitationId: string;
  refereeUserId: string;
  redeemedAt: ZonedDateTime;
}

/**
 * A record that a specific user redeemed an invitation code (ports v2's
 * `InvitationRedemption.ts`). Idempotent at the persistence layer — the
 * document id is the referee's user id, so re-redeeming is a no-op there;
 * this pure VO only carries the fact. A thin shim since the ECS
 * migration's Phase 2: the self-redemption guard is `ReferralSystem.redeem`
 * (`@creativo/ecs-core`).
 */
export class InvitationRedemption {
  private constructor(
    readonly invitationId: InvitationId,
    readonly refereeUserId: UserId,
    readonly redeemedAt: ZonedDateTime,
  ) {}

  static create(
    props: CreateInvitationRedemptionProps,
  ): Result<InvitationRedemption, InvitationRedemptionError[]> {
    return InvitationRedemption.build(props);
  }

  static reconstitute(
    props: CreateInvitationRedemptionProps,
  ): Result<InvitationRedemption, InvitationRedemptionError[]> {
    return InvitationRedemption.build(props);
  }

  /**
   * Guards self-redemption — the one door that also needs the source
   * `Invitation`, so it's a standalone factory rather than baked into
   * `create()` (which only validates this VO's own fields).
   */
  static forInvitation(
    invitation: Invitation,
    refereeUserId: UserId,
    redeemedAt: ZonedDateTime,
  ): Result<InvitationRedemption, InvitationSelfRedemptionError> {
    const redeemed = ReferralSystem.redeem(
      entityOf(invitation),
      UserRefId.of(refereeUserId.value),
      redeemedAt.toMillis(),
    );
    if (!redeemed.ok) return fail(new InvitationSelfRedemptionError());
    return ok(
      new InvitationRedemption(invitation.id, refereeUserId, redeemedAt),
    );
  }

  private static build(
    props: CreateInvitationRedemptionProps,
  ): Result<InvitationRedemption, InvitationRedemptionError[]> {
    const invitationIdResult = InvitationId.create(props.invitationId);
    const refereeUserIdResult = UserId.create(props.refereeUserId);

    const combined = combineAll([
      invitationIdResult,
      refereeUserIdResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [invitationId, refereeUserId] = combined.value;

    return ok(
      new InvitationRedemption(invitationId, refereeUserId, props.redeemedAt),
    );
  }
}

// ── The bridge: legacy class → ecs-core struct (Phase 4 deletes it) ──────

/** The invitation as `ReferralSystem` reads it. */
function entityOf(invitation: Invitation): InvitationEntity {
  return {
    id: InvitationRefId.of(invitation.id.value),
    inviterUserId: UserRefId.of(invitation.inviterUserId.value),
    inviterName: invitation.inviterName,
    redemptionCount: RedemptionCount.of(invitation.redemptionCount),
    createdAtMs: invitation.createdAt.toMillis(),
  };
}
