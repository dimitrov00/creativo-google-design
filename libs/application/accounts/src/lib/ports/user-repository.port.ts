import { Result } from '@creativo/domain/kernel';
import { OtpDestinationType, User } from '@creativo/domain/models';
import { RepositoryError } from '@creativo/application/shared';

export interface UserRepositoryPort {
  save(user: User): Promise<Result<void, RepositoryError>>;
  findByDestination(
    destination: string,
    destinationType: OtpDestinationType,
  ): Promise<Result<User | null, RepositoryError>>;
}
