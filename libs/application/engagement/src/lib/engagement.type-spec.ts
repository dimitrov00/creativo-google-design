/**
 * Compile-only assertions (no runtime `it`/`expect`) proving the
 * primitive-obsession ban holds across this lib's ports/use-cases. Never
 * executed by Vitest — named `*.type-spec.ts` so the `{test,spec}` glob
 * doesn't pick it up — exists purely so `tsc` fails if one of these
 * invariants regresses. (The invitation's id is ecs-core's `InvitationId`
 * since the loyalty flip (3), held nominal by
 * `libs/ecs-core/src/primitives/ids.type-spec.ts`.)
 */
import { CouponGrantId } from '@creativo/domain/engagement';
import { CouponGrantRepository } from './ports/coupon-grant-repository.port';

declare const grants: CouponGrantRepository;

// (a) A plain `string` is rejected where a branded ID is expected.

// @ts-expect-error — a bare string is not a CouponGrantId.
const _couponGrantIdFromString: CouponGrantId = 'grant_1';

// (b) Port methods reject a plain string in place of the branded id.

// @ts-expect-error — findById takes a CouponGrantId, not a bare string.
grants.findById('grant_1');

export {};
