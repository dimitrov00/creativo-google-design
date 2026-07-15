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
