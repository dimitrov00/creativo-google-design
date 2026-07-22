import { Id, Result, fail, ok } from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';

function createId<T>(
  idType: string,
  raw: string,
  factory: (value: string) => T,
): Result<T, EmptyIdError> {
  if (raw.trim().length === 0) {
    return fail(new EmptyIdError(idType));
  }
  return ok(factory(raw));
}

/**
 * This context mints its own `*Id` classes even where a sibling context
 * (accounts, catalog) already has a same-named brand — same brand *name*
 * conceptually, deliberately not the same *type*, so ids never become
 * structurally interchangeable just because they wrap a string (see
 * `accounts/ids.ts`'s own `UserId` doc comment for the same precedent).
 */
export class CouponId extends Id<'Coupon'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<CouponId, EmptyIdError> {
    return createId('CouponId', raw, (v) => new CouponId(v));
  }
  static generate(): CouponId {
    return new CouponId(crypto.randomUUID());
  }
}

export class CouponGrantId extends Id<'CouponGrant'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<CouponGrantId, EmptyIdError> {
    return createId('CouponGrantId', raw, (v) => new CouponGrantId(v));
  }
  static generate(): CouponGrantId {
    return new CouponGrantId(crypto.randomUUID());
  }
}

export class RewardProgramId extends Id<'RewardProgram'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<RewardProgramId, EmptyIdError> {
    return createId('RewardProgramId', raw, (v) => new RewardProgramId(v));
  }
  static generate(): RewardProgramId {
    return new RewardProgramId(crypto.randomUUID());
  }
}

export class MilestoneId extends Id<'Milestone'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<MilestoneId, EmptyIdError> {
    return createId('MilestoneId', raw, (v) => new MilestoneId(v));
  }
  static generate(): MilestoneId {
    return new MilestoneId(crypto.randomUUID());
  }
}

export class InvitationId extends Id<'Invitation'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<InvitationId, EmptyIdError> {
    return createId('InvitationId', raw, (v) => new InvitationId(v));
  }
  static generate(): InvitationId {
    return new InvitationId(crypto.randomUUID());
  }
}

export class AchievementId extends Id<'Achievement'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<AchievementId, EmptyIdError> {
    return createId('AchievementId', raw, (v) => new AchievementId(v));
  }
  static generate(): AchievementId {
    return new AchievementId(crypto.randomUUID());
  }
}
