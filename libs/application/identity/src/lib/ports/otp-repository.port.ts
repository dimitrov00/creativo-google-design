import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import { Otp, OtpId } from '@creativo/domain/models';
import { RepositoryError } from '@creativo/application/shared';
import { OtpDestination } from './otp-destination';

export interface OtpRepositoryPort {
  save(otp: Otp): Promise<Result<void, RepositoryError>>;
  findById(id: OtpId): Promise<Result<Otp | null, RepositoryError>>;
  findRecentUnconsumedByDestination(
    destination: OtpDestination,
    since: ZonedDateTime,
  ): Promise<Result<boolean, RepositoryError>>;
}
