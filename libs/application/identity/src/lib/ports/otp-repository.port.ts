import { Result } from '@creativo/domain/kernel';
import { Otp, OtpId } from '@creativo/domain/models';
import { RepositoryError } from '@creativo/application/shared';

export interface OtpRepositoryPort {
  save(otp: Otp): Promise<Result<void, RepositoryError>>;
  findById(id: OtpId): Promise<Result<Otp | null, RepositoryError>>;
  findRecentUnconsumedByDestination(
    destination: string,
    sinceIso: string,
  ): Promise<Result<boolean, RepositoryError>>;
}
