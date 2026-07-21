// TODO(goal-03): superseded by @creativo/application/identity's
// OtpRepositoryPort (blueprint §0.3 moves ports to
// libs/application/*/ports). Kept here, temporarily duplicated, only so
// apps/functions keeps compiling without a circular
// domain/models <-> application/* project reference. Delete this file once
// goal-03 ports every consumer over to importing from
// @creativo/application/identity.
import { Result } from '@creativo/domain/kernel';
import { OtpId } from '../ids';
import { Otp } from '../otp';
import { RepositoryError } from './repository.errors';

export interface OtpRepositoryPort {
  save(otp: Otp): Promise<Result<void, RepositoryError>>;
  findById(id: OtpId): Promise<Result<Otp | null, RepositoryError>>;
  findRecentUnconsumedByDestination(
    destination: string,
    sinceIso: string,
  ): Promise<Result<boolean, RepositoryError>>;
}
