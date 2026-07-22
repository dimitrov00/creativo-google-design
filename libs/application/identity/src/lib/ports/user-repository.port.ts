import { Result } from '@creativo/domain/kernel';
import { User } from '@creativo/domain/models';
import { RepositoryError } from '@creativo/application/shared';
import { OtpDestination } from './otp-destination';

/**
 * Backend-only, `apps/functions`-consumed repository over the legacy
 * `domain/models` `User` — lives in `identity` (not `accounts`, despite the
 * name) so functions and web share one contract source for the one User
 * shape functions still knows about. `accounts`' own `ProfilePort` is a
 * separate, new, web-facing port over the real `domain/accounts` `User`.
 */
export interface UserRepositoryPort {
  save(user: User): Promise<Result<void, RepositoryError>>;
  findByDestination(
    destination: OtpDestination,
  ): Promise<Result<User | null, RepositoryError>>;
}
