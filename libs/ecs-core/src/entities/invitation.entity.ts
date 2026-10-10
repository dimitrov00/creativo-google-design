import type { RedemptionCount } from '../components/redemption-count.data';
import type { UserId } from './user.entity';

export type InvitationId = string & { readonly __brand: unique symbol };
export const InvitationId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): InvitationId => raw as InvitationId,
} as const;

/**
 * `invitations/{id}` — an invitation a user issued; the id IS the shareable
 * code, so anyone with the link can try to redeem it. The stored body of
 * `invitation.adapter.ts:17-24`, `createdAt` → `createdAtMs`: no `code`
 * and no `status` (neither is stored). `redemptionCount` is server-written,
 * together with the `redemptions/{refereeUserId}` document, by the
 * `redeemInvitation` pipeline (ReferralSystem refuses self-redemption).
 */
export type InvitationEntity = {
  readonly id: InvitationId;
  readonly inviterUserId: UserId;
  /** Trimmed, never blank. */
  readonly inviterName: string;
  readonly redemptionCount: RedemptionCount;
  readonly createdAtMs: number;
};
