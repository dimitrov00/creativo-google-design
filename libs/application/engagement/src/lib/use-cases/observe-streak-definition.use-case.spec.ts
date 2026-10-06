import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { StreakDefinition } from '@creativo/domain/engagement';
import type { Result } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';
import {
  InMemoryStreakDefinitionRepository,
  loyaltyFixtures,
} from '../../testing';
import {
  ObserveStreakDefinitionUseCase,
  type ObservedStreakDefinition,
  STREAK_HISTORY_LIMIT,
} from './observe-streak-definition.use-case';

const TODAY = loyaltyFixtures.today;
const NEXT_MONTH = '2026-10-28';
const CADENCE = 'cadence';

function must<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw result.error;
  return result.value;
}

/** Ten days of grace from next month, published on the seeded rule. */
async function scheduleMoreGrace(
  repository: InMemoryStreakDefinitionRepository,
  requestId = 'request-more-grace',
): Promise<void> {
  const head = must(await firstValueFrom(repository.observe(CADENCE)));
  if (head === null) throw new Error('fixture: no rule');
  const newest = head.scheduled?.definition.version ?? head.current.version;
  must(
    await repository.publish({
      requestId,
      baseVersion: newest,
      definition: must(
        StreakDefinition.create({
          ...head.current.toProps(),
          graceDays: 10,
          version: newest + 1,
          effectiveFrom: NEXT_MONTH,
        }),
      ),
      transition: 'grandfather',
      previewHash: null,
    }),
  );
}

describe('ObserveStreakDefinitionUseCase', () => {
  it('hands the published head over as it is, and says it is published', async () => {
    const repository = InMemoryStreakDefinitionRepository.seeded();
    const useCase = new ObserveStreakDefinitionUseCase(repository);
    const observed = must(await firstValueFrom(useCase.execute(CADENCE)));
    const head = must(await firstValueFrom(repository.observe(CADENCE)));
    expect(observed.published).toBe(true);
    expect(observed.schedule.id).toBe(CADENCE);
    expect(observed.schedule.current.equals(head?.current ?? never())).toBe(
      true,
    );
    expect(observed.schedule.scheduled).toBeNull();
  });

  it('opens on the recommended rule where the shop has published none', async () => {
    const useCase = new ObserveStreakDefinitionUseCase(
      new InMemoryStreakDefinitionRepository(),
    );
    const observed = must(await firstValueFrom(useCase.execute(CADENCE)));
    expect(observed.published).toBe(false);
    expect(observed.schedule.current).toBe(StreakDefinition.default());
    expect(observed.schedule.scheduled).toBeNull();
    expect(observed.schedule.inForceOn(TODAY)).toBe(StreakDefinition.default());
  });

  it('recommends the same figures under another rule’s id', async () => {
    const useCase = new ObserveStreakDefinitionUseCase(
      InMemoryStreakDefinitionRepository.seeded(),
    );
    const observed = must(
      await firstValueFrom(useCase.execute('cadence-beard')),
    );
    expect(observed.published).toBe(false);
    expect(observed.schedule.id).toBe('cadence-beard');
    expect(observed.schedule.current.toProps()).toEqual({
      ...StreakDefinition.default().toProps(),
      id: 'cadence-beard',
    });
  });

  it('fails for an id no rule can carry, never with a rule nobody asked for', async () => {
    const useCase = new ObserveStreakDefinitionUseCase(
      new InMemoryStreakDefinitionRepository(),
    );
    const observed = await firstValueFrom(useCase.execute('  '));
    expect(observed.isFailure() && observed.error).toBeInstanceOf(
      RepositoryError,
    );
  });

  it('hears of every change of the head: a version that waits, then its withdrawal', async () => {
    const repository = InMemoryStreakDefinitionRepository.seeded();
    const useCase = new ObserveStreakDefinitionUseCase(repository);
    const seen: ObservedStreakDefinition[] = [];
    const watching = useCase
      .execute(CADENCE)
      .subscribe((observed) => seen.push(must(observed)));

    await scheduleMoreGrace(repository);
    must(await repository.withdraw(CADENCE, 2, 'request-undo'));
    watching.unsubscribe();

    expect(
      seen.map((observed) => [
        observed.published,
        observed.schedule.inForceOn(TODAY).version,
        observed.schedule.upcomingOn(TODAY)?.definition.graceDays ?? null,
      ]),
    ).toEqual([
      [true, 1, null],
      [true, 1, 10],
      [true, 1, null],
    ]);
  });

  it('turns from the recommendation to the rule the moment one is published', async () => {
    const repository = new InMemoryStreakDefinitionRepository();
    const useCase = new ObserveStreakDefinitionUseCase(repository);
    const seen: boolean[] = [];
    const watching = useCase
      .execute(CADENCE)
      .subscribe((observed) => seen.push(must(observed).published));
    must(
      await repository.publish({
        requestId: 'request-first',
        baseVersion: 0,
        definition: StreakDefinition.default(),
        transition: 'grandfather',
        previewHash: null,
      }),
    );
    watching.unsubscribe();
    expect(seen).toEqual([false, true]);
  });

  it('passes a failed read on, and the next good one after it', async () => {
    const repository = InMemoryStreakDefinitionRepository.seeded();
    const useCase = new ObserveStreakDefinitionUseCase(repository);
    const offline = new RepositoryError('offline');
    const seen: (boolean | RepositoryError)[] = [];
    const watching = useCase
      .execute(CADENCE)
      .subscribe((observed) =>
        seen.push(
          observed.isSuccess() ? observed.value.published : observed.error,
        ),
      );
    repository.failWith(offline);
    repository.recover();
    watching.unsubscribe();
    expect(seen).toEqual([true, offline, true]);
  });

  describe('history', () => {
    it('lists the rule’s versions, newest first', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      await scheduleMoreGrace(repository);
      const useCase = new ObserveStreakDefinitionUseCase(repository);
      const versions = must(await useCase.history(CADENCE));
      expect(
        versions.map((v) => [v.definition.version, v.publishedBy]),
      ).toEqual([
        [2, 'dev-staff-ivan'],
        [1, 'system'],
      ]);
    });

    it('asks for twenty unless told, and never for less than one', async () => {
      const asked: number[] = [];
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const listVersions = repository.listVersions.bind(repository);
      repository.listVersions = (streakId, limit) => {
        asked.push(limit);
        return listVersions(streakId, limit);
      };
      const useCase = new ObserveStreakDefinitionUseCase(repository);
      await useCase.history(CADENCE);
      await useCase.history(CADENCE, 5);
      await useCase.history(CADENCE, 0);
      await useCase.history(CADENCE, 2.9);
      expect(STREAK_HISTORY_LIMIT).toBe(20);
      expect(asked).toEqual([20, 5, 1, 2]);
    });

    it('lists nothing for a rule nobody published, and fails as the port does', async () => {
      const empty = new ObserveStreakDefinitionUseCase(
        new InMemoryStreakDefinitionRepository(),
      );
      expect(must(await empty.history(CADENCE))).toEqual([]);
      const offline = new RepositoryError('offline');
      const failing = new ObserveStreakDefinitionUseCase(
        InMemoryStreakDefinitionRepository.seeded().failWith(offline),
      );
      const failed = await failing.history(CADENCE);
      expect(failed.isFailure() && failed.error).toBe(offline);
    });
  });
});

function never(): never {
  throw new Error('fixture: no head');
}
