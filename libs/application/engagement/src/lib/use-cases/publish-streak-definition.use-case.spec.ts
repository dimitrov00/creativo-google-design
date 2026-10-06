import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import {
  StreakDefinition,
  type StreakDefinitionProps,
  StreakGraceNotShorterThanIntervalError,
  StreakIntervalOutOfRangeError,
  type StreakNoticePolicy,
} from '@creativo/domain/engagement';
import type { Result } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';
import {
  InMemoryStreakDefinitionRepository,
  loyaltyFixtures,
} from '../../testing';
import type { PublishStreakDefinition } from '../ports/streak-definition.port';
import {
  ObserveStreakDefinitionUseCase,
  type ObservedStreakDefinition,
} from './observe-streak-definition.use-case';
import {
  type PublishStreakDefinitionInput,
  PublishStreakDefinitionUseCase,
} from './publish-streak-definition.use-case';

const TODAY = loyaltyFixtures.today; // 2026-09-28
const TOMORROW = '2026-09-29';
const NEXT_MONTH = '2026-10-28';
const CADENCE = 'cadence';

/** Nobody sees the rhythm yet: a stricter rule may start tomorrow. */
const QUIET: StreakNoticePolicy = { clientsSeeRhythm: false, noticeDays: 30 };
/** Clients see it: a stricter rule is owed 30 days. */
const SEEN: StreakNoticePolicy = { clientsSeeRhythm: true, noticeDays: 30 };

function must<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw result.error;
  return result.value;
}

async function observedOf(
  repository: InMemoryStreakDefinitionRepository,
): Promise<ObservedStreakDefinition> {
  return must(
    await firstValueFrom(
      new ObserveStreakDefinitionUseCase(repository).execute(CADENCE),
    ),
  );
}

let intents = 0;

/** A «Запази» on the rule the repository holds: `patch` over the rule in force. */
async function inputOf(
  repository: InMemoryStreakDefinitionRepository,
  patch: Partial<StreakDefinitionProps>,
  effectiveFrom: string,
  more: Partial<PublishStreakDefinitionInput> = {},
): Promise<PublishStreakDefinitionInput> {
  const observed = await observedOf(repository);
  return {
    observed,
    draft: { ...observed.schedule.inForceOn(TODAY).toProps(), ...patch },
    effectiveFrom,
    transition: 'grandfather',
    requestId: `request-${(intents += 1)}`,
    today: TODAY,
    policy: QUIET,
    ...more,
  };
}

/** The requests that reached the port, in order. */
function sent(
  repository: InMemoryStreakDefinitionRepository,
): PublishStreakDefinition[] {
  const requests: PublishStreakDefinition[] = [];
  const publish = repository.publish.bind(repository);
  repository.publish = (request) => {
    requests.push(request);
    return publish(request);
  };
  return requests;
}

const writes = (repository: InMemoryStreakDefinitionRepository) =>
  repository.calls
    .map((call) => call.method)
    .filter((method) => method === 'publish' || method === 'withdraw');

describe('PublishStreakDefinitionUseCase', () => {
  describe('assess — what a draft comes to, sending nothing', () => {
    it('makes the draft the next version of the rule, on the day asked', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      const assessed = useCase.assess(
        await inputOf(
          repository,
          { interval: { kind: 'fixed', days: 56 } },
          NEXT_MONTH,
        ),
      );
      if (assessed.kind !== 'valid') throw new Error('expected a valid draft');
      expect(assessed.baseVersion).toBe(1);
      expect(assessed.definition).toBeInstanceOf(StreakDefinition);
      expect(assessed.definition.toProps()).toEqual({
        ...StreakDefinition.default().toProps(),
        interval: { kind: 'fixed', days: 56 },
        version: 2,
        effectiveFrom: NEXT_MONTH,
      });
      expect(assessed.change).toEqual({
        direction: 'looser',
        changed: ['interval'],
      });
      expect(writes(repository)).toEqual([]);
    });

    it('sets the identity of the version itself: the draft cannot number or date it', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      const assessed = useCase.assess(
        await inputOf(
          repository,
          { id: 'another', version: 40, effectiveFrom: '2031-01-01' },
          TOMORROW,
        ),
      );
      expect(assessed.kind === 'valid' && assessed.definition).toMatchObject({
        id: CADENCE,
        version: 2,
        effectiveFrom: TOMORROW,
      });
    });

    it.each([
      [
        'what only moves the staff’s cue',
        { riskLeadDays: 3 },
        'neutral',
        TODAY,
      ],
      ['what favours the client', { graceDays: 10 }, 'looser', TOMORROW],
      ['the rule going off', { enabled: false }, 'switch', TOMORROW],
      ['what takes something away', { graceDays: 3 }, 'stricter', TOMORROW],
      [
        'what gives and takes',
        { graceDays: 10, minGapDays: 10 },
        'mixed',
        TOMORROW,
      ],
    ] as const)(
      'lets %s start as early as the domain does, while nobody sees the rhythm',
      async (_what, patch, direction, earliest) => {
        const repository = InMemoryStreakDefinitionRepository.seeded();
        const assessed = new PublishStreakDefinitionUseCase(repository).assess(
          await inputOf(repository, patch, NEXT_MONTH),
        );
        expect(assessed).toMatchObject({
          kind: 'valid',
          change: { direction },
          earliest,
        });
      },
    );

    it('owes the clients who see the rhythm their notice, of a stricter rule only', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      const stricter = useCase.assess(
        await inputOf(repository, { graceDays: 3 }, NEXT_MONTH, {
          policy: SEEN,
        }),
      );
      const looser = useCase.assess(
        await inputOf(repository, { graceDays: 10 }, NEXT_MONTH, {
          policy: SEEN,
        }),
      );
      expect(stricter).toMatchObject({ kind: 'valid', earliest: NEXT_MONTH });
      expect(looser).toMatchObject({ kind: 'valid', earliest: TOMORROW });
    });

    it('names every fault of a draft that is no rule, at once', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const assessed = new PublishStreakDefinitionUseCase(repository).assess(
        await inputOf(
          repository,
          {
            interval: { kind: 'fixed', days: 7 },
            protections: {
              enabled: true,
              maxBanked: 9,
              earnEvery: 0,
              startWith: 0,
            },
          },
          TOMORROW,
        ),
      );
      if (assessed.kind !== 'invalid') throw new Error('expected a refusal');
      expect(assessed.fields).toEqual([
        'interval.days',
        'protections.maxBanked',
        'protections.earnEvery',
      ]);
      expect(assessed.errors.map((error) => error.field)).toEqual(
        assessed.fields,
      );
      expect(assessed.errors[0]).toBeInstanceOf(StreakIntervalOutOfRangeError);
      expect(assessed.errors.map((error) => error.code)).toEqual([
        'engagement.streak_definition.interval_out_of_range',
        'engagement.streak_definition.protections_out_of_range',
        'engagement.streak_definition.protections_out_of_range',
      ]);
    });

    it('names a field once, however many faults it has', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const assessed = new PublishStreakDefinitionUseCase(repository).assess(
        await inputOf(
          repository,
          { interval: { kind: 'fixed', days: 14 }, graceDays: 14 },
          TOMORROW,
        ),
      );
      if (assessed.kind !== 'invalid') throw new Error('expected a refusal');
      expect(assessed.errors[0]).toBeInstanceOf(
        StreakGraceNotShorterThanIntervalError,
      );
      expect(assessed.fields.filter((field) => field === 'graceDays')).toEqual([
        'graceDays',
      ]);
    });

    it('refuses a day that is no day as a fault of the draft', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const assessed = new PublishStreakDefinitionUseCase(repository).assess(
        await inputOf(repository, { graceDays: 10 }, '2026-02-30'),
      );
      expect(assessed).toMatchObject({
        kind: 'invalid',
        fields: ['effectiveFrom'],
      });
    });

    it('bases the draft on what WAITS, and compares it with what is IN FORCE', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      expect(
        (
          await useCase.execute(
            await inputOf(repository, { graceDays: 14 }, NEXT_MONTH),
          )
        ).kind,
      ).toBe('published');

      // Version 2 waits with 14 days of grace; clients live under 7.
      const assessed = useCase.assess(
        await inputOf(repository, { graceDays: 10 }, TOMORROW),
      );
      expect(assessed).toMatchObject({
        kind: 'valid',
        baseVersion: 2,
        definition: { version: 3, graceDays: 10 },
        change: { direction: 'looser', changed: ['graceDays'] },
      });
    });

    it('takes what waited for the rule in force once its day has come', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      await useCase.execute(
        await inputOf(repository, { graceDays: 14 }, TOMORROW),
      );
      const observed = await observedOf(repository);
      const assessed = useCase.assess({
        observed,
        draft: { ...observed.schedule.current.toProps(), graceDays: 10 },
        effectiveFrom: '2026-11-15',
        today: NEXT_MONTH,
        policy: QUIET,
      });
      // Against 14 days, 10 takes something away.
      expect(assessed).toMatchObject({
        kind: 'valid',
        baseVersion: 2,
        change: { direction: 'stricter', changed: ['graceDays'] },
        earliest: '2026-10-29',
      });
    });

    it('numbers a shop’s first rule 1, on nothing', async () => {
      const repository = new InMemoryStreakDefinitionRepository();
      const assessed = new PublishStreakDefinitionUseCase(repository).assess(
        await inputOf(repository, { graceDays: 10 }, TOMORROW),
      );
      expect(assessed).toMatchObject({
        kind: 'valid',
        baseVersion: 0,
        definition: { id: CADENCE, version: 1, graceDays: 10 },
      });
    });
  });

  describe('execute — «Запази»', () => {
    it('publishes a rule from a later day: it waits, and can still be called off', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const requests = sent(repository);
      const useCase = new PublishStreakDefinitionUseCase(repository);
      const input = await inputOf(
        repository,
        { interval: { kind: 'fixed', days: 56 } },
        TOMORROW,
      );
      expect(await useCase.execute(input)).toEqual({
        kind: 'published',
        version: 2,
        effectiveFrom: TOMORROW,
        direction: 'looser',
        waits: true,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        requestId: input.requestId,
        baseVersion: 1,
        transition: 'grandfather',
        previewHash: null,
      });
      expect(requests[0]?.definition.toProps()).toEqual({
        ...StreakDefinition.default().toProps(),
        interval: { kind: 'fixed', days: 56 },
        version: 2,
        effectiveFrom: TOMORROW,
      });
      const { schedule } = await observedOf(repository);
      expect(schedule.inForceOn(TODAY).version).toBe(1);
      expect(schedule.upcomingOn(TODAY)?.definition.interval.toProps()).toEqual(
        { kind: 'fixed', days: 56 },
      );
    });

    it('publishes what may start today as the rule in force: nothing waits', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      expect(
        await useCase.execute(
          await inputOf(repository, { riskLeadDays: 3 }, TODAY),
        ),
      ).toEqual({
        kind: 'published',
        version: 2,
        effectiveFrom: TODAY,
        direction: 'neutral',
        waits: false,
      });
      const { schedule } = await observedOf(repository);
      expect(schedule.current.riskLeadDays).toBe(3);
      expect(schedule.scheduled).toBeNull();
    });

    it('hands the preview it was confirmed on over, when there is one', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const requests = sent(repository);
      await new PublishStreakDefinitionUseCase(repository).execute(
        await inputOf(repository, { graceDays: 10 }, TOMORROW, {
          previewHash: 'sha256:0a1b',
        }),
      );
      expect(requests[0]?.previewHash).toBe('sha256:0a1b');
    });

    it('answers the number the writer gave, which a withdrawal moves past the draft’s', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const requests = sent(repository);
      const useCase = new PublishStreakDefinitionUseCase(repository);
      await useCase.execute(
        await inputOf(repository, { graceDays: 10 }, NEXT_MONTH),
      );
      await useCase.withdraw({
        observed: await observedOf(repository),
        requestId: 'request-undo',
        today: TODAY,
      });
      const outcome = await useCase.execute(
        await inputOf(repository, { graceDays: 12 }, TOMORROW),
      );
      expect(requests[1]).toMatchObject({
        baseVersion: 1,
        definition: { version: 2 },
      });
      expect(outcome).toMatchObject({ kind: 'published', version: 3 });
    });

    it('sends nothing for a draft that is the rule in force', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      expect(
        await useCase.execute(await inputOf(repository, {}, TOMORROW)),
      ).toEqual({ kind: 'unchanged' });
      expect(writes(repository)).toEqual([]);
    });

    it('publishes the recommended rule as it stands where none is published: until then there is none', async () => {
      const repository = new InMemoryStreakDefinitionRepository();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      expect(
        await useCase.execute(await inputOf(repository, {}, TODAY)),
      ).toEqual({
        kind: 'published',
        version: 1,
        effectiveFrom: TODAY,
        direction: 'neutral',
        waits: false,
      });
      const observed = await observedOf(repository);
      expect(observed.published).toBe(true);
      expect(observed.schedule.current.toProps()).toEqual({
        ...StreakDefinition.default().toProps(),
        effectiveFrom: TODAY,
      });
    });

    it('names the fields of a draft that is no rule, before any round trip', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const outcome = await new PublishStreakDefinitionUseCase(
        repository,
      ).execute(await inputOf(repository, { graceDays: 60 }, TOMORROW));
      expect(outcome).toMatchObject({ kind: 'invalid', fields: ['graceDays'] });
      expect(outcome.kind === 'invalid' && outcome.errors).toHaveLength(1);
      expect(writes(repository)).toEqual([]);
    });

    it('names the earliest day of a change asked too early, before any round trip', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      expect(
        await useCase.execute(
          await inputOf(repository, { graceDays: 3 }, TODAY),
        ),
      ).toEqual({ kind: 'tooEarly', earliest: TOMORROW });
      expect(
        await useCase.execute(
          await inputOf(repository, { graceDays: 3 }, TOMORROW, {
            policy: SEEN,
          }),
        ),
      ).toEqual({ kind: 'tooEarly', earliest: NEXT_MONTH });
      expect(writes(repository)).toEqual([]);
    });

    it('offers a later day when the SERVER holds the change to a stricter one', async () => {
      // This side believes nobody sees the rhythm; the server knows better.
      const repository = InMemoryStreakDefinitionRepository.seeded({
        policy: SEEN,
      });
      const useCase = new PublishStreakDefinitionUseCase(repository);
      const outcome = await useCase.execute(
        await inputOf(repository, { graceDays: 3 }, TOMORROW),
      );
      expect(outcome).toEqual({ kind: 'tooEarly', earliest: NEXT_MONTH });
      // The day offered is one the server takes.
      expect(
        await useCase.execute(
          await inputOf(repository, { graceDays: 3 }, NEXT_MONTH),
        ),
      ).toMatchObject({ kind: 'published', effectiveFrom: NEXT_MONTH });
    });

    it('offers at least the day after the one refused', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded().refuseWith(
        'tooEarly',
        ['effectiveFrom'],
      );
      const outcome = await new PublishStreakDefinitionUseCase(
        repository,
      ).execute(
        await inputOf(repository, { graceDays: 10 }, '2026-12-31', {
          policy: SEEN,
        }),
      );
      expect(outcome).toEqual({ kind: 'tooEarly', earliest: '2027-01-01' });
    });

    it('words the server’s refusal of a draft by the fields it names', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded().refuseWith(
        'invalid',
        ['qualifier.serviceIds'],
      );
      expect(
        await new PublishStreakDefinitionUseCase(repository).execute(
          await inputOf(repository, { graceDays: 10 }, TOMORROW),
        ),
      ).toEqual({
        kind: 'invalid',
        fields: ['qualifier.serviceIds'],
        errors: [],
      });
    });

    it('is refused as stale when someone else published meanwhile, and overwrites nothing', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      const mine = await inputOf(repository, { graceDays: 10 }, TOMORROW);
      const theirs = await inputOf(repository, { graceDays: 5 }, TOMORROW);
      expect((await useCase.execute(theirs)).kind).toBe('published');
      expect(await useCase.execute(mine)).toEqual({
        kind: 'refused',
        refusal: 'stale',
      });
      const { schedule } = await observedOf(repository);
      expect(schedule.scheduled?.definition.graceDays).toBe(5);
    });

    it.each(['notAdmin', 'previewStale'] as const)(
      'passes the server’s «%s» on as it is',
      async (refusal) => {
        const repository =
          InMemoryStreakDefinitionRepository.seeded().refuseWith(refusal);
        expect(
          await new PublishStreakDefinitionUseCase(repository).execute(
            await inputOf(repository, { graceDays: 10 }, TOMORROW),
          ),
        ).toEqual({ kind: 'refused', refusal });
      },
    );

    it('leaves it to the server to refuse a recompute before the engine exists', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      expect(
        await new PublishStreakDefinitionUseCase(repository).execute(
          await inputOf(repository, { graceDays: 10 }, TOMORROW, {
            transition: 'recompute',
          }),
        ),
      ).toEqual({ kind: 'refused', refusal: 'recomputeNeedsEngine' });
    });

    it('says the request got no answer, and keeps the intent for the retry', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      const input = await inputOf(repository, { graceDays: 10 }, TOMORROW);
      const offline = new RepositoryError('offline');
      repository.failWith(offline);
      expect(await useCase.execute(input)).toEqual({
        kind: 'failed',
        error: offline,
      });
      repository.recover();
      // The same input again: the same intent, written once.
      expect((await useCase.execute(input)).kind).toBe('published');
      expect(await useCase.execute(input)).toMatchObject({
        kind: 'published',
        version: 2,
      });
      expect(
        Object.keys(repository.documentsOf(CADENCE)?.versions ?? {}),
      ).toEqual(['000001', '000002']);
    });
  });

  describe('withdraw — «Отмени»', () => {
    it('calls off the version that waits, by its own number', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      await useCase.execute(
        await inputOf(repository, { graceDays: 10 }, NEXT_MONTH),
      );
      expect(
        await useCase.withdraw({
          observed: await observedOf(repository),
          requestId: 'request-undo',
          today: TODAY,
        }),
      ).toEqual({ kind: 'withdrawn', version: 2 });
      const { schedule } = await observedOf(repository);
      expect(schedule.scheduled).toBeNull();
      expect(schedule.current.version).toBe(1);
    });

    it.each([
      ['nothing was scheduled', TODAY, false],
      ['its day has come', NEXT_MONTH, true],
    ] as const)('sends nothing when %s', async (_why, today, scheduled) => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      if (scheduled) {
        await useCase.execute(
          await inputOf(repository, { graceDays: 10 }, NEXT_MONTH),
        );
      }
      const before = writes(repository);
      expect(
        await useCase.withdraw({
          observed: await observedOf(repository),
          requestId: 'request-undo',
          today,
        }),
      ).toEqual({ kind: 'nothingWaits' });
      expect(writes(repository)).toEqual(before);
    });

    it('sends nothing for a rule nobody published', async () => {
      const repository = new InMemoryStreakDefinitionRepository();
      expect(
        await new PublishStreakDefinitionUseCase(repository).withdraw({
          observed: await observedOf(repository),
          requestId: 'request-undo',
          today: TODAY,
        }),
      ).toEqual({ kind: 'nothingWaits' });
      expect(writes(repository)).toEqual([]);
    });

    it('is refused as stale when what waited was replaced meanwhile', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      await useCase.execute(
        await inputOf(repository, { graceDays: 10 }, NEXT_MONTH),
      );
      const seen = await observedOf(repository);
      await useCase.execute(
        await inputOf(repository, { graceDays: 12 }, NEXT_MONTH),
      );
      expect(
        await useCase.withdraw({
          observed: seen,
          requestId: 'request-undo',
          today: TODAY,
        }),
      ).toEqual({ kind: 'refused', refusal: 'stale' });
      expect(
        (await observedOf(repository)).schedule.scheduled?.definition.version,
      ).toBe(3);
    });

    it('passes a refusal and a failure on as they are', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const useCase = new PublishStreakDefinitionUseCase(repository);
      await useCase.execute(
        await inputOf(repository, { graceDays: 10 }, NEXT_MONTH),
      );
      const undo = {
        observed: await observedOf(repository),
        requestId: 'request-undo',
        today: TODAY,
      };
      repository.refuseWith('notAdmin');
      expect(await useCase.withdraw(undo)).toEqual({
        kind: 'refused',
        refusal: 'notAdmin',
      });
      const offline = new RepositoryError('offline');
      repository.recover().failWith(offline);
      expect(await useCase.withdraw(undo)).toEqual({
        kind: 'failed',
        error: offline,
      });
      repository.recover();
      expect(await useCase.withdraw(undo)).toEqual({
        kind: 'withdrawn',
        version: 2,
      });
    });
  });
});
