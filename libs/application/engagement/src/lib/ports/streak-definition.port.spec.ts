import { type Subscription, firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import {
  StreakDefinition,
  type StreakDefinitionProps,
  type StreakDefinitionSchedule,
} from '@creativo/domain/engagement';
import type { Result } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';
import {
  InMemoryStreakDefinitionRepository,
  type StreakDefinitionFixture,
  loyaltyFixtures,
} from '../../testing';
import type { StreakDefinitionHeadDocument } from './loyalty-document';
import {
  type PublishStreakDefinition,
  STREAK_DEFINITION_REPOSITORY,
  STREAK_PUBLISH_REFUSALS,
  StreakPublishFailedError,
  StreakPublishRefusedError,
} from './streak-definition.port';

const TODAY = loyaltyFixtures.today; // 2026-09-28
const TOMORROW = '2026-09-29';
const NEXT_MONTH = '2026-10-28';
const CADENCE = 'cadence';

function must<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw result.error;
  return result.value;
}

/** The head as the repository hands it now. */
async function headOf(
  repository: InMemoryStreakDefinitionRepository,
  streakId = CADENCE,
): Promise<StreakDefinitionSchedule | null> {
  return must(await firstValueFrom(repository.observe(streakId)));
}

let intents = 0;

/**
 * The next version of the rule in force: `patch` over it, from
 * `effectiveFrom`. Every call is an intent of its own unless it is named.
 */
async function revised(
  repository: InMemoryStreakDefinitionRepository,
  patch: Partial<StreakDefinitionProps>,
  effectiveFrom: string,
  requestId = `request-${(intents += 1)}`,
): Promise<PublishStreakDefinition> {
  const head = await headOf(repository);
  if (head === null) throw new Error('fixture: no rule');
  const newest = head.scheduled?.definition.version ?? head.current.version;
  return {
    requestId,
    baseVersion: newest,
    definition: must(
      StreakDefinition.create({
        ...head.inForceOn(TODAY).toProps(),
        ...patch,
        version: newest + 1,
        effectiveFrom,
      }),
    ),
    transition: 'grandfather',
    previewHash: null,
  };
}

const refusalOf = (result: Result<unknown, unknown>) =>
  result.isFailure() && result.error instanceof StreakPublishRefusedError
    ? { refusal: result.error.refusal, fields: result.error.fields }
    : null;

/**
 * The port's reference (`@creativo/application/engagement/testing`), held
 * to the port's promises, the ones the Firestore adapter and the callable
 * behind it keep together: the head read as a model and watched, the
 * history newest first, a publish that is in force at once or waits for
 * its day, and a refusal in the server's own words.
 */
describe('StreakDefinitionRepository — the in-memory reference', () => {
  it('names its token', () => {
    expect(STREAK_DEFINITION_REPOSITORY.toString()).toContain(
      'StreakDefinitionRepository',
    );
  });

  it('names the server’s six refusals, each worded by a code of its own', () => {
    expect([...STREAK_PUBLISH_REFUSALS]).toEqual([
      'notAdmin',
      'invalid',
      'stale',
      'tooEarly',
      'recomputeNeedsEngine',
      'previewStale',
    ]);
    const refused = new StreakPublishRefusedError('invalid', ['graceDays']);
    expect(refused.code).toBe('engagement.streak_publish.refused');
    expect(refused.params).toEqual({
      refusal: 'invalid',
      fields: ['graceDays'],
    });
    const cause = new RepositoryError('offline');
    const failed = new StreakPublishFailedError(cause);
    expect(failed.code).toBe('engagement.streak_publish.failed');
    expect(failed.cause).toBe(cause);
  });

  describe('observe', () => {
    it('reads the head as a model: the recommended rule in force, nothing waiting', async () => {
      const head = await headOf(InMemoryStreakDefinitionRepository.seeded());
      expect(head?.id).toBe(CADENCE);
      expect(head?.current.equals(StreakDefinition.default())).toBe(true);
      expect(head?.scheduled).toBeNull();
    });

    it('answers null for a rule nobody published: an answer, not an error', async () => {
      const empty = new InMemoryStreakDefinitionRepository();
      expect(await headOf(empty)).toBeNull();
      const seeded = InMemoryStreakDefinitionRepository.seeded();
      expect(await headOf(seeded, 'another-rule')).toBeNull();
    });

    it('answers again whenever the head changes', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const seen: (number | null)[] = [];
      const watching: Subscription = repository
        .observe(CADENCE)
        .subscribe((head) =>
          seen.push(
            head.isSuccess()
              ? (head.value?.scheduled?.definition.version ?? null)
              : -1,
          ),
        );
      await repository.publish(
        await revised(repository, { graceDays: 10 }, NEXT_MONTH),
      );
      await repository.withdraw(CADENCE, 2, 'request-undo');
      watching.unsubscribe();
      await repository.publish(
        await revised(repository, { graceDays: 12 }, NEXT_MONTH),
      );
      expect(seen).toEqual([null, 2, null]);
    });

    it('stays open through a failure and answers again once it is over', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const seen: string[] = [];
      const watching = repository
        .observe(CADENCE)
        .subscribe((head) =>
          seen.push(head.isSuccess() ? 'read' : head.error.message),
        );
      repository.failWith(new RepositoryError('offline'));
      repository.recover();
      watching.unsubscribe();
      expect(seen).toEqual(['read', 'offline', 'read']);
    });

    it('fails a head that is malformed, as the adapter would', async () => {
      const head = loyaltyFixtures.catalog.streakDefinitions['cadence'];
      if (head === undefined) throw new Error('fixture: no head');
      const broken: StreakDefinitionHeadDocument = {
        ...head,
        current: { ...head.current, graceDays: 60 },
      };
      const repository = new InMemoryStreakDefinitionRepository({
        [CADENCE]: { head: broken, versions: {} },
      });
      const read = await firstValueFrom(repository.observe(CADENCE));
      expect(read.isFailure() && read.error).toBeInstanceOf(RepositoryError);
      expect(read.isFailure() && read.error.message).toContain(
        'streakDefinitions/cadence',
      );
    });

    it('resolves what waits by date, with no write: from its own day it is the rule in force', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      await repository.publish(
        await revised(repository, { graceDays: 10 }, NEXT_MONTH),
      );
      const before = await headOf(repository);
      expect(before?.inForceOn(TODAY).version).toBe(1);
      expect(before?.upcomingOn(TODAY)?.definition.version).toBe(2);

      const written = repository.documentsOf(CADENCE);
      repository.advanceTo(NEXT_MONTH);
      const after = await headOf(repository);
      expect(after?.inForceOn(NEXT_MONTH).version).toBe(2);
      expect(after?.upcomingOn(NEXT_MONTH)).toBeNull();
      expect(repository.documentsOf(CADENCE)).toEqual(written);
    });
  });

  describe('listVersions', () => {
    it('lists the history newest first, the called-off version among it', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      await repository.publish(
        await revised(repository, { graceDays: 10 }, NEXT_MONTH),
      );
      await repository.publish(
        await revised(repository, { graceDays: 14 }, NEXT_MONTH),
      );
      const versions = must(await repository.listVersions(CADENCE, 20));
      expect(
        versions.map((v) => [
          v.definition.version,
          v.definition.graceDays,
          v.withdrawnAt !== null,
        ]),
      ).toEqual([
        [3, 14, false],
        [2, 10, true],
        [1, 7, false],
      ]);
      expect(versions.every((v) => v.definition.id === CADENCE)).toBe(true);
      expect(versions[0]?.definition.name.bg).toBe('Посещения в ритъм');
    });

    it('lists as many as asked, one at least', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      await repository.publish(
        await revised(repository, { graceDays: 10 }, NEXT_MONTH),
      );
      const newest = must(await repository.listVersions(CADENCE, 1));
      expect(newest.map((v) => v.definition.version)).toEqual([2]);
      const none = must(await repository.listVersions(CADENCE, 0));
      expect(none.map((v) => v.definition.version)).toEqual([2]);
    });

    it('lists nothing for a rule nobody published', async () => {
      const versions =
        await new InMemoryStreakDefinitionRepository().listVersions(
          CADENCE,
          20,
        );
      expect(versions.isSuccess() && versions.value).toEqual([]);
    });
  });

  describe('publish', () => {
    it('lets a later day WAIT: the rule in force stays, the new one is scheduled', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const request = await revised(
        repository,
        { interval: { kind: 'fixed', days: 56 } },
        TOMORROW,
        'request-eight-weeks',
      );
      const published = await repository.publish(request);
      expect(published.isSuccess() && published.value).toEqual({
        version: 2,
        effectiveFrom: TOMORROW,
        direction: 'looser',
      });

      const head = await headOf(repository);
      expect(head?.current.version).toBe(1);
      expect(head?.scheduled?.transition).toBe('grandfather');
      expect(head?.scheduled?.definition.equals(request.definition)).toBe(true);
      expect(repository.documentsOf(CADENCE)?.versions['000002']).toMatchObject(
        {
          version: 2,
          effectiveFrom: TOMORROW,
          interval: { kind: 'fixed', days: 56 },
          publishedBy: 'dev-staff-ivan',
          transition: 'grandfather',
          direction: 'looser',
          changed: ['interval'],
          requestId: 'request-eight-weeks',
          withdrawnAt: null,
        },
      );
    });

    it('puts a version effective today in force at once', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      // The staff's cue alone moves nothing for a client: it may start today.
      const published = await repository.publish(
        await revised(repository, { riskLeadDays: 3 }, TODAY),
      );
      expect(published.isSuccess() && published.value).toEqual({
        version: 2,
        effectiveFrom: TODAY,
        direction: 'neutral',
      });
      const head = await headOf(repository);
      expect(head?.current.version).toBe(2);
      expect(head?.current.riskLeadDays).toBe(3);
      expect(head?.scheduled).toBeNull();
      expect(repository.documentsOf(CADENCE)?.head.updatedAt).toBe(
        '2026-09-28T09:00:00.000Z',
      );
    });

    it('replaces what waited, and stamps it as called off', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      await repository.publish(
        await revised(repository, { graceDays: 10 }, NEXT_MONTH),
      );
      const second = await repository.publish(
        await revised(repository, { graceDays: 14 }, TOMORROW),
      );
      expect(second.isSuccess() && second.value.version).toBe(3);
      const head = await headOf(repository);
      expect(head?.current.version).toBe(1);
      expect(head?.scheduled?.definition.version).toBe(3);
      const versions: StreakDefinitionFixture['versions'] =
        repository.documentsOf(CADENCE)?.versions ?? {};
      expect(versions['000002']?.withdrawnAt).toBe('2026-09-28T09:00:00.000Z');
      expect(versions['000003']?.withdrawnAt).toBeNull();
    });

    it('keeps what came into force by date as the rule in force of the new head', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      await repository.publish(
        await revised(repository, { graceDays: 10 }, TOMORROW),
      );
      repository.advanceTo(NEXT_MONTH);
      const head = must(await firstValueFrom(repository.observe(CADENCE)));
      const inForce = head?.inForceOn(NEXT_MONTH);
      const published = await repository.publish({
        requestId: 'request-after-the-day',
        baseVersion: 2,
        definition: must(
          StreakDefinition.create({
            ...(inForce ?? StreakDefinition.default()).toProps(),
            graceDays: 14,
            version: 3,
            effectiveFrom: '2026-11-15',
          }),
        ),
        transition: 'grandfather',
        previewHash: null,
      });
      expect(published.isSuccess()).toBe(true);
      const next = await headOf(repository);
      expect(next?.current.version).toBe(2);
      expect(next?.scheduled?.definition.version).toBe(3);
      // It was never called off: its day came.
      expect(
        repository.documentsOf(CADENCE)?.versions['000002']?.withdrawnAt,
      ).toBeNull();
    });

    it('writes nothing for a retry of an intent it wrote, and answers as it did', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const request = await revised(repository, { graceDays: 10 }, TOMORROW);
      const first = await repository.publish(request);
      const written = repository.documentsOf(CADENCE);
      const again = await repository.publish(request);
      expect(again).toEqual(first);
      expect(repository.documentsOf(CADENCE)).toEqual(written);
    });

    it('publishes a shop’s first rule on nothing: base 0, version 1, in force whatever its day', async () => {
      const repository = new InMemoryStreakDefinitionRepository();
      const first = must(
        StreakDefinition.create({
          ...StreakDefinition.default().toProps(),
          effectiveFrom: NEXT_MONTH,
        }),
      );
      const published = await repository.publish({
        requestId: 'request-first',
        baseVersion: 0,
        definition: first,
        transition: 'grandfather',
        previewHash: null,
      });
      expect(published.isSuccess() && published.value).toEqual({
        version: 1,
        effectiveFrom: NEXT_MONTH,
        direction: 'neutral',
      });
      const head = await headOf(repository);
      expect(head?.current.equals(first)).toBe(true);
      expect(head?.scheduled).toBeNull();
      expect(
        must(await repository.listVersions(CADENCE, 20)).map(
          (v) => v.definition.version,
        ),
      ).toEqual([1]);
    });

    it('refuses a head that moved: stale, and nothing is overwritten', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const mine = await revised(repository, { graceDays: 10 }, TOMORROW, 'a');
      const theirs = await revised(repository, { graceDays: 5 }, TOMORROW, 'b');
      expect((await repository.publish(theirs)).isSuccess()).toBe(true);
      const written = repository.documentsOf(CADENCE);
      expect(refusalOf(await repository.publish(mine))).toEqual({
        refusal: 'stale',
        fields: [],
      });
      expect(repository.documentsOf(CADENCE)).toEqual(written);
    });

    it('numbers the version itself: the request’s number is a proposal', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const request = await revised(repository, { graceDays: 10 }, TOMORROW);
      const proposed = must(
        StreakDefinition.create({
          ...request.definition.toProps(),
          version: 5,
        }),
      );
      const published = await repository.publish({
        ...request,
        definition: proposed,
      });
      expect(published.isSuccess() && published.value.version).toBe(2);
      expect((await headOf(repository))?.scheduled?.definition.version).toBe(2);
      expect(
        Object.keys(repository.documentsOf(CADENCE)?.versions ?? {}),
      ).toEqual(['000001', '000002']);
    });

    it('refuses a day the change may not start on yet', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      // Less grace takes something away: never from today.
      expect(
        refusalOf(
          await repository.publish(
            await revised(repository, { graceDays: 3 }, TODAY),
          ),
        ),
      ).toEqual({ refusal: 'tooEarly', fields: ['effectiveFrom'] });
      expect(
        (
          await repository.publish(
            await revised(repository, { graceDays: 3 }, TOMORROW),
          )
        ).isSuccess(),
      ).toBe(true);
    });

    it('owes the clients who see the rhythm their notice of a stricter rule', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded({
        policy: { clientsSeeRhythm: true, noticeDays: 30 },
      });
      expect(
        refusalOf(
          await repository.publish(
            await revised(repository, { graceDays: 3 }, '2026-10-27'),
          ),
        ),
      ).toEqual({ refusal: 'tooEarly', fields: ['effectiveFrom'] });
      expect(
        (
          await repository.publish(
            await revised(repository, { graceDays: 3 }, NEXT_MONTH),
          )
        ).isSuccess(),
      ).toBe(true);
      // What favours the client needs no notice.
      const looser = InMemoryStreakDefinitionRepository.seeded({
        policy: { clientsSeeRhythm: true, noticeDays: 30 },
      });
      expect(
        (
          await looser.publish(
            await revised(looser, { graceDays: 10 }, TOMORROW),
          )
        ).isSuccess(),
      ).toBe(true);
    });

    it('refuses to recompute the runs before the engine exists', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const request = await revised(repository, { graceDays: 10 }, TOMORROW);
      expect(
        refusalOf(
          await repository.publish({ ...request, transition: 'recompute' }),
        ),
      ).toEqual({ refusal: 'recomputeNeedsEngine', fields: [] });
      expect((await headOf(repository))?.scheduled).toBeNull();
    });

    it('refuses in the words it is told to, until recovered', async () => {
      const repository =
        InMemoryStreakDefinitionRepository.seeded().refuseWith('notAdmin');
      const request = await revised(repository, { graceDays: 10 }, TOMORROW);
      expect(refusalOf(await repository.publish(request))).toEqual({
        refusal: 'notAdmin',
        fields: [],
      });
      expect(refusalOf(await repository.withdraw(CADENCE, 2, 'undo'))).toEqual({
        refusal: 'notAdmin',
        fields: [],
      });
      // A refusal is the server's answer to a WRITE: the head still reads.
      expect((await headOf(repository))?.current.version).toBe(1);
      repository.recover();
      expect((await repository.publish(request)).isSuccess()).toBe(true);
    });

    it('fails, never throws, when the request gets no answer', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const request = await revised(repository, { graceDays: 10 }, TOMORROW);
      const offline = new RepositoryError('offline');
      repository.failWith(offline);
      const failed = await repository.publish(request);
      expect(failed.isFailure() && failed.error).toBeInstanceOf(
        StreakPublishFailedError,
      );
      expect(failed.isFailure() && failed.error.cause).toBe(offline);
      const versions = await repository.listVersions(CADENCE, 20);
      expect(versions.isFailure() && versions.error).toBe(offline);
      repository.recover();
      expect((await repository.publish(request)).isSuccess()).toBe(true);
    });
  });

  describe('withdraw', () => {
    it('calls off the version that waits: the head holds the rule in force alone', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      await repository.publish(
        await revised(repository, { graceDays: 10 }, NEXT_MONTH),
      );
      const withdrawn = await repository.withdraw(CADENCE, 2, 'request-undo');
      expect(withdrawn.isSuccess()).toBe(true);
      const head = await headOf(repository);
      expect(head?.current.version).toBe(1);
      expect(head?.scheduled).toBeNull();
      expect(
        repository.documentsOf(CADENCE)?.versions['000002']?.withdrawnAt,
      ).toBe('2026-09-28T09:00:00.000Z');
    });

    // The head's newest is 1 again, and 000002 is taken: a version
    // document is written once, so the next publish is numbered 3.
    it('never gives a called-off version’s number away', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      await repository.publish(
        await revised(repository, { graceDays: 10 }, NEXT_MONTH),
      );
      await repository.withdraw(CADENCE, 2, 'request-undo');
      const next = await revised(repository, { graceDays: 12 }, TOMORROW);
      expect(next.baseVersion).toBe(1);
      expect(next.definition.version).toBe(2);
      const published = await repository.publish(next);
      expect(published.isSuccess() && published.value.version).toBe(3);

      const head = await headOf(repository);
      expect(head?.scheduled?.definition.version).toBe(3);
      expect(head?.scheduled?.definition.graceDays).toBe(12);
      const versions = must(await repository.listVersions(CADENCE, 20));
      expect(
        versions.map((v) => [
          v.definition.version,
          v.definition.graceDays,
          v.withdrawnAt !== null,
        ]),
      ).toEqual([
        [3, 12, false],
        [2, 10, true],
        [1, 7, false],
      ]);
      // The head's newest is what the next draft is based on.
      expect((await revised(repository, {}, TOMORROW)).baseVersion).toBe(3);
    });

    it('answers a retry of the same intent as it did', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      await repository.publish(
        await revised(repository, { graceDays: 10 }, NEXT_MONTH),
      );
      expect((await repository.withdraw(CADENCE, 2, 'undo')).isSuccess()).toBe(
        true,
      );
      const written = repository.documentsOf(CADENCE);
      expect((await repository.withdraw(CADENCE, 2, 'undo')).isSuccess()).toBe(
        true,
      );
      expect(repository.documentsOf(CADENCE)).toEqual(written);
    });

    it('refuses what no longer waits: another version, nothing, a day that came', async () => {
      const repository = InMemoryStreakDefinitionRepository.seeded();
      const stale = { refusal: 'stale', fields: [] };
      expect(refusalOf(await repository.withdraw(CADENCE, 2, 'a'))).toEqual(
        stale,
      );
      expect(refusalOf(await repository.withdraw('nobody', 1, 'b'))).toEqual(
        stale,
      );
      await repository.publish(
        await revised(repository, { graceDays: 10 }, NEXT_MONTH),
      );
      expect(refusalOf(await repository.withdraw(CADENCE, 3, 'c'))).toEqual(
        stale,
      );
      repository.advanceTo(NEXT_MONTH);
      expect(refusalOf(await repository.withdraw(CADENCE, 2, 'd'))).toEqual(
        stale,
      );
      expect((await headOf(repository))?.scheduled?.definition.version).toBe(2);
    });
  });

  it('records every call, in order', async () => {
    const repository = InMemoryStreakDefinitionRepository.seeded();
    await headOf(repository);
    await repository.listVersions(CADENCE, 5);
    await repository.publish(
      await revised(repository, { graceDays: 10 }, NEXT_MONTH),
    );
    await repository.withdraw(CADENCE, 2, 'undo');
    expect(
      repository.calls
        .filter((call) => call.method !== 'observe')
        .map((call) => call.method),
    ).toEqual(['listVersions', 'publish', 'withdraw']);
    expect(repository.calls.every((call) => call.streakId === CADENCE)).toBe(
      true,
    );
  });
});
