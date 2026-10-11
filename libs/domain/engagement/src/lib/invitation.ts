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
  UtcEpochMs,
  defect,
  UserId as UserRefId,
} from '@core/primitives';
import { RedemptionCount } from '@core/components';
import { type Invitation as InvitationEntity } from '@core/entities';
import { ReferralSystem } from '@core/systems';
import { InvitationId } from './ids';
import { EmptyIdError } from './ids.errors';
import {
  InvitationEmptyInviterNameError,
  InvitationInvalidRedemptionCountError,
} from './invitation.errors';

export type InvitationError =
  | EmptyIdError
  | AccountsEmptyIdError
  | InvitationEmptyInviterNameError
  | InvitationInvalidRedemptionCountError;

export interface CreateInvitationProps {
  id: string;
  inviterUserId: string;
  inviterName: string;
  createdAt: ZonedDateTime;
}

export interface ReconstituteInvitationProps extends CreateInvitationProps {
  redemptionCount: number;
}

/**
 * **Aggregate root.** An invitation issued by a user (ports v2's
 * `Invitation.ts`). A thin shim since the ECS migration's Phase 2: the
 * counter bump and the self-invitation guard are `ReferralSystem`
 * (`@core/systems`). The code (== invitation id) is shareable — anyone
 * with the link can attempt to redeem it. `redemptionCount` is
 * denormalized (maintained by whichever use-case processes a redemption)
 * — negative/non-integer counts are unrepresentable.
 */
export class Invitation {
  private constructor(
    readonly id: InvitationId,
    readonly inviterUserId: UserId,
    readonly inviterName: string,
    readonly redemptionCount: number,
    readonly createdAt: ZonedDateTime,
  ) {}

  /** Construct a fresh invitation — always starts with zero redemptions. */
  static create(
    props: CreateInvitationProps,
  ): Result<Invitation, InvitationError[]> {
    return Invitation.build({ ...props, redemptionCount: 0 });
  }

  static reconstitute(
    props: ReconstituteInvitationProps,
  ): Result<Invitation, InvitationError[]> {
    return Invitation.build(props);
  }

  private static build(
    props: ReconstituteInvitationProps,
  ): Result<Invitation, InvitationError[]> {
    const idResult = InvitationId.create(props.id);
    const inviterUserIdResult = UserId.create(props.inviterUserId);
    const inviterNameResult = Invitation.validateInviterName(props.inviterName);
    const redemptionCountResult = Invitation.validateRedemptionCount(
      props.redemptionCount,
    );

    const combined = combineAll([
      idResult,
      inviterUserIdResult,
      inviterNameResult,
      redemptionCountResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, inviterUserId, inviterName, redemptionCount] = combined.value;

    return ok(
      new Invitation(
        id,
        inviterUserId,
        inviterName,
        redemptionCount,
        props.createdAt,
      ),
    );
  }

  /** Domain transition for the per-redemption counter bump — never a raw `+1` on persistence. */
  recordRedemption(): Invitation {
    return new Invitation(
      this.id,
      this.inviterUserId,
      this.inviterName,
      ReferralSystem.recordRedemption(entityOf(this)).redemptionCount,
      this.createdAt,
    );
  }

  /** Whether the given user is the original inviter — guards self-invitation. */
  isSelfInvitation(candidateUserId: UserId): boolean {
    return ReferralSystem.isSelfInvitation(
      entityOf(this),
      UserRefId.of(candidateUserId.value),
    );
  }

  private static validateInviterName(
    raw: string,
  ): Result<string, InvitationEmptyInviterNameError> {
    const trimmed = raw.trim();
    return trimmed.length > 0
      ? ok(trimmed)
      : fail(new InvitationEmptyInviterNameError());
  }

  private static validateRedemptionCount(
    raw: number,
  ): Result<number, InvitationInvalidRedemptionCountError> {
    if (!Number.isInteger(raw) || raw < 0) {
      return fail(new InvitationInvalidRedemptionCountError(raw));
    }
    return ok(raw);
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
    createdAtUtcMs: utcOf(invitation.createdAt),
  };
}

/** A class instant's epoch ms as the brand — every `ZonedDateTime` is inside its window. */
function utcOf(instant: ZonedDateTime): UtcEpochMs {
  const epochMs = instant.toMillis();
  const utc = UtcEpochMs.of(epochMs);
  return utc.ok ? utc.value : defect(`${epochMs} is not an instant`);
}
