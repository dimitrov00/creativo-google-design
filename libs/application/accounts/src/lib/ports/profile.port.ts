import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import { User, UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';

export interface ProfilePort {
  getProfile(userId: UserId): Promise<Result<User | null, RepositoryError>>;
  saveProfile(user: User): Promise<Result<void, RepositoryError>>;
}

export const PROFILE_PORT = new InjectionToken<ProfilePort>('ProfilePort');
