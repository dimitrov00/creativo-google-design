import { Id, Result, fail, ok } from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';

/**
 * This context's only identifier today. `UserAccount`/`User` both key off
 * it; other contexts (identity, engagement, ...) mint their own `UserId`
 * class in their own lib — same brand *name*, deliberately not the same
 * *type*, so an accounts `UserId` and an identity `UserId` never become
 * structurally interchangeable just because they wrap the same string.
 */
export class UserId extends Id<'User'> {
  private constructor(value: string) {
    super(value);
  }

  static create(raw: string): Result<UserId, EmptyIdError> {
    if (raw.trim().length === 0) {
      return fail(new EmptyIdError('UserId'));
    }
    return ok(new UserId(raw));
  }

  static generate(): UserId {
    return new UserId(crypto.randomUUID());
  }
}
