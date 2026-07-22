import { describe, expect, it } from 'vitest';
import { Observable, firstValueFrom, of } from 'rxjs';
import { Result, ok } from '@creativo/domain/kernel';
import { Appointment } from '@creativo/domain/scheduling';
import { UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';
import { AppointmentRepository } from '../ports/appointment-repository.port';
import { ObserveUpcomingUseCase } from './observe-upcoming.use-case';

function fakeRepository(
  stream: Observable<Result<readonly Appointment[], RepositoryError>>,
): AppointmentRepository {
  return {
    async findById() {
      throw new Error('not used in this spec');
    },
    async save() {
      throw new Error('not used in this spec');
    },
    observeUpcomingFor: () => stream,
  };
}

describe('ObserveUpcomingUseCase', () => {
  it('delegates straight to the repository stream for the given user', async () => {
    const repo = fakeRepository(of(ok([])));
    const useCase = new ObserveUpcomingUseCase(repo);
    const userId = UserId.create('user_1');
    if (userId.isFailure())
      throw new Error('unexpected failure in test fixture');

    const result = await firstValueFrom(useCase.execute(userId.value));
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toEqual([]);
    }
  });
});
