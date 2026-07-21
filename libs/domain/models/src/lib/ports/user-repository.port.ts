// TODO(goal-03): superseded by @creativo/application/accounts's
// UserRepositoryPort (blueprint §0.3 moves ports to
// libs/application/*/ports). Kept here, temporarily duplicated, only so
// apps/functions keeps compiling without a circular
// domain/models <-> application/* project reference. Delete this file once
// goal-03 ports every consumer over to importing from
// @creativo/application/accounts.
import { Result } from '@creativo/domain/kernel';
import { OtpDestinationType } from '../otp';
import { User } from '../user';
import { RepositoryError } from './repository.errors';

export interface UserRepositoryPort {
  save(user: User): Promise<Result<void, RepositoryError>>;
  findByDestination(
    destination: string,
    destinationType: OtpDestinationType,
  ): Promise<Result<User | null, RepositoryError>>;
}
