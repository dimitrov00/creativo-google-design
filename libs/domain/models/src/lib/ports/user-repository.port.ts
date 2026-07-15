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
