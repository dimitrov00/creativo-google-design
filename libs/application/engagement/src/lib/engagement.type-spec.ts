/**
 * Compile-only assertions (no runtime `it`/`expect`) proving the
 * primitive-obsession ban holds across this lib's ports/use-cases. Never
 * executed by Vitest — named `*.type-spec.ts` so the `{test,spec}` glob
 * doesn't pick it up — exists purely so `tsc` fails if one of these
 * invariants regresses.
 */
import { CouponGrantId, InvitationId } from '@creativo/domain/engagement';
import { CouponGrantRepository } from './ports/coupon-grant-repository.port';
import { InvitationPort } from './ports/invitation.port';

declare const grants: CouponGrantRepository;
declare const invitations: InvitationPort;

// (a) A plain `string` is rejected where a branded ID is expected.

// @ts-expect-error — a bare string is not a CouponGrantId.
const _couponGrantIdFromString: CouponGrantId = 'grant_1';

// @ts-expect-error — a bare string is not an InvitationId.
const _invitationIdFromString: InvitationId = 'invite_1';

// (b) This context's branded types are not interchangeable with each other.

declare const couponGrantId: CouponGrantId;
declare const invitationId: InvitationId;

// @ts-expect-error — CouponGrantId cannot substitute where an InvitationId is expected.
const _invitationIdFromCouponGrantId: InvitationId = couponGrantId;

// @ts-expect-error — InvitationId cannot substitute where a CouponGrantId is expected.
const _couponGrantIdFromInvitationId: CouponGrantId = invitationId;

// (c) Port methods reject a plain string in place of the branded id.

// @ts-expect-error — findById takes a CouponGrantId, not a bare string.
grants.findById('grant_1');

// @ts-expect-error — findById takes an InvitationId, not a bare string.
invitations.findById('invite_1');

export {};
