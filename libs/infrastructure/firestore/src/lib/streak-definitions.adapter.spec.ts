import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { Subscription } from 'rxjs';
import {
  HeadRole,
  StreakRule,
  StreakRuleDirection,
  StreakRuleParameter,
  StreakTransition,
} from '@core/components';
import type { StreakDefinition, StreakDefinitionVersion } from '@core/entities';
import {
  PublishRequestId,
  type Result,
  StreakDefinitionId,
  StreakDefinitionVersionId,
  UserId,
} from '@core/primitives';
import { type RepositoryError, RepositoryErrorCode } from '@core/errors';
import { StreakRuleSystem } from '@core/systems';
import {
  FIXTURE_TODAY,
  localDate,
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { streakDefinitionPorts } = await import('./streak-definitions.adapter');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

const CADENCE = StreakRule.DEFAULT_DEFINITION_ID;
const HEAD = 'streakDefinitions/cadence';
const WAITS_FROM = localDate('2026-10-05');

/** The rule with grace widened to ten days from 5.10: version 2, which waits. */
const WIDER_GRACE: StreakRule = {
  ...StreakRule.DEFAULT,
  version: 2,
  effectiveFromLocalDate: WAITS_FROM,
  graceDays: 10,
};

/** The head as the dev shop opened it: the recommended rule in force, nothing waiting. */
const SEEDED_HEAD: StreakDefinition = streakDefinitionFixture();

/** The head after one publish that waits for 5.10. */
const HEAD_WITH_A_WAIT: StreakDefinition = streakDefinitionFixture({
  rules: [
    {
      ...StreakRule.DEFAULT,
      headRole: HeadRole.Current,
      streakTransition: null,
    },
    {
      ...WIDER_GRACE,
      headRole: HeadRole.Scheduled,
      streakTransition: StreakTransition.Grandfather,
    },
  ],
  updatedAtUtcMs: utcMs('2026-09-28T09:00:00.000+03:00'),
});

const FIRST: StreakDefinitionVersion = streakDefinitionVersionFixture();

/** Version 2 as the callable writes it: the flat rule at the root, and how it came to be. */
const SECOND: StreakDefinitionVersion = {
  ...FIRST,
  ...WIDER_GRACE,
  id: StreakDefinitionVersionId.forVersion(2),
  publishedAtUtcMs: utcMs('2026-09-28T09:00:00.000+03:00'),
  publishedByUserId: UserId.of('dev-staff-ivan'),
  streakTransition: StreakTransition.Grandfather,
  streakRuleDirection: StreakRuleDirection.Looser,
  changed: [StreakRuleParameter.GraceDays],
  requestId: PublishRequestId.of('req-wider-grace'),
  withdrawnAtUtcMs: null,
};

/** An entity's stored body: the entity minus its id. */
function bodyOf<E extends { readonly id: string }>(entity: E): Omit<E, 'id'> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  ) as Omit<E, 'id'>;
}

/** The rule's documents after the publish that waits: the head and both versions. */
function published(): FakeFirestore {
  return new FakeFirestore({
    [HEAD]: bodyOf(HEAD_WITH_A_WAIT),
    [`${HEAD}/versions/${FIRST.id}`]: bodyOf(FIRST),
    [`${HEAD}/versions/${SECOND.id}`]: bodyOf(SECOND),
  });
}

type Heard = Result<StreakDefinition | null, RepositoryError>;

function watch(fake: FakeFirestore, id: StreakDefinitionId = CADENCE) {
  const heard: Heard[] = [];
  const subscription: Subscription = streakDefinitionPorts(asDb(fake))
    .observeStreakDefinitionHead(id)
    .subscribe((result) => heard.push(result));
  return { heard, subscription };
}

describe('streakDefinitionPorts — the head, watched', () => {
  it('hands over the head as stored: the rule in force, and nothing waiting', () => {
    const fake = new FakeFirestore({ [HEAD]: bodyOf(SEEDED_HEAD) });

    const { heard } = watch(fake);

    expect(fake.reads).toEqual([
      { kind: 'listen', path: HEAD, constraints: [] },
    ]);
    expect(heard).toEqual([{ ok: true, value: SEEDED_HEAD }]);
    const head = unwrapOk(heard[0] as Heard);
    expect(head?.rules).toHaveLength(1);
    expect(
      head === null ? null : StreakRuleSystem.inForceOn(head, FIXTURE_TODAY),
    ).toMatchObject({ version: 1, graceDays: 7 });
  });

  it('hands over the version that waits inside the same head — the system resolves it by date, with no second read', () => {
    const fake = published();

    const { heard } = watch(fake);

    const head = unwrapOk(heard[0] as Heard);
    if (head === null) throw new Error('expected a head');
    expect(head).toEqual(HEAD_WITH_A_WAIT);
    expect(fake.reads).toHaveLength(1);
    expect(StreakRuleSystem.upcomingOn(head, FIXTURE_TODAY)?.version).toBe(2);
    expect(
      StreakRuleSystem.inForceOn(head, localDate('2026-10-04')).graceDays,
    ).toBe(7);
    expect(StreakRuleSystem.inForceOn(head, WAITS_FROM).graceDays).toBe(10);
  });

  it('answers null, not a failure, for a shop that has published no rule', () => {
    const { heard } = watch(new FakeFirestore());

    expect(heard).toEqual([{ ok: true, value: null }]);
  });

  it('hears a publish made elsewhere as it lands', () => {
    const fake = new FakeFirestore({ [HEAD]: bodyOf(SEEDED_HEAD) });
    const { heard } = watch(fake);

    fake.set(HEAD, bodyOf(HEAD_WITH_A_WAIT));

    expect(heard).toHaveLength(2);
    expect(heard[1]).toEqual({ ok: true, value: HEAD_WITH_A_WAIT });
  });

  it('a stored head is answered as stored — a rule that is no rule, or a body of another shape (F3-1 b)', () => {
    const broken = {
      ...bodyOf(SEEDED_HEAD),
      rules: [{ ...SEEDED_HEAD.rules[0], graceDays: 10_000 }],
    };
    const fake = new FakeFirestore({ [HEAD]: broken });
    const { heard } = watch(fake);

    expect(heard).toEqual([{ ok: true, value: { id: 'cadence', ...broken } }]);
    expect(fake.listening).toBe(1);

    const unflattened = { name: SEEDED_HEAD.name, version: 1, graceDays: 7 };
    fake.set(HEAD, unflattened);

    expect(heard[1]).toEqual({
      ok: true,
      value: { id: 'cadence', ...unflattened },
    });
  });

  it('turns a refused listen into a failed Result naming the head, never a thrown stream', () => {
    const fake = new FakeFirestore().failWith(
      Object.assign(new Error('no'), { code: 'permission-denied' }),
    );

    const { heard } = watch(fake);

    expect(heard).toEqual([
      {
        ok: false,
        error: {
          errorCode: RepositoryErrorCode.ReadFailed,
          path: HEAD,
          reason: 'permission-denied',
        },
      },
    ]);
  });

  it('lets go of its listener when nobody watches any more', () => {
    const fake = new FakeFirestore();
    const { subscription } = watch(fake);
    expect(fake.listening).toBe(1);

    subscription.unsubscribe();

    expect(fake.listening).toBe(0);
  });
});

describe('streakDefinitionPorts — the history', () => {
  it('lists every publish newest first, every version as stored — no head read beside it', async () => {
    const fake = published();

    const history = unwrapOk(
      await streakDefinitionPorts(asDb(fake)).listStreakDefinitionVersions(
        CADENCE,
        20,
      ),
    );

    expect(history).toEqual([SECOND, FIRST]);
    expect(history[0]).toMatchObject({
      version: 2,
      graceDays: 10,
      effectiveFromLocalDate: '2026-10-05',
      publishedByUserId: 'dev-staff-ivan',
      requestId: 'req-wider-grace',
      streakRuleDirection: StreakRuleDirection.Looser,
      changed: [StreakRuleParameter.GraceDays],
      withdrawnAtUtcMs: null,
    });
    expect(history[1]?.publishedByUserId).toBe('system');
    expect(fake.reads).toEqual([
      {
        kind: 'query',
        path: `${HEAD}/versions`,
        constraints: ['orderBy version desc', 'limit 20'],
      },
    ]);
  });

  it('keeps to the limit, from the newest', async () => {
    const history = unwrapOk(
      await streakDefinitionPorts(
        asDb(published()),
      ).listStreakDefinitionVersions(CADENCE, 1),
    );

    expect(history.map((version) => version.version)).toEqual([2]);
  });

  it.each([0, -3, 2.9, Number.NaN])(
    'asks for a whole count of at least one, whatever was asked (%s)',
    async (asked) => {
      const fake = published();

      const history = await streakDefinitionPorts(
        asDb(fake),
      ).listStreakDefinitionVersions(CADENCE, asked);

      expect(history.ok).toBe(true);
      expect(fake.reads[0]?.constraints[1]).toBe(
        asked === 2.9 ? 'limit 2' : 'limit 1',
      );
    },
  );

  it('shows a withdrawn version as withdrawn', async () => {
    const withdrawnAtUtcMs = utcMs('2026-09-29T11:00:00.000+03:00');
    const fake = published().set(`${HEAD}/versions/${SECOND.id}`, {
      ...bodyOf(SECOND),
      withdrawnAtUtcMs,
    });

    const history = unwrapOk(
      await streakDefinitionPorts(asDb(fake)).listStreakDefinitionVersions(
        CADENCE,
        20,
      ),
    );

    expect(history[0]?.withdrawnAtUtcMs).toBe(withdrawnAtUtcMs);
  });

  it('is an empty history for a rule nobody published', async () => {
    const history = await streakDefinitionPorts(
      asDb(new FakeFirestore()),
    ).listStreakDefinitionVersions(CADENCE, 20);

    expect(history).toEqual({ ok: true, value: [] });
  });

  it('a stored version is answered as stored — a blank publisher, or one filed under another number (F3-1 b)', async () => {
    const fake = published()
      .set(`${HEAD}/versions/${FIRST.id}`, {
        ...bodyOf(FIRST),
        publishedByUserId: '',
      })
      .set(`${HEAD}/versions/000009`, bodyOf(SECOND));

    const history = unwrapOk(
      await streakDefinitionPorts(asDb(fake)).listStreakDefinitionVersions(
        CADENCE,
        20,
      ),
    );

    // Two documents claim version 2: Firestore breaks the tie by document
    // id in the query's direction (descending), and nothing refuses either.
    expect(history.map((version) => version.id)).toEqual([
      '000009',
      SECOND.id,
      FIRST.id,
    ]);
    expect(history[2]?.publishedByUserId).toBe('');
  });

  it('turns the rules’ refusal into a failed Result: the history is the admin pair’s', async () => {
    const fake = published().failWith(
      Object.assign(new Error('Missing permissions'), {
        code: 'permission-denied',
      }),
    );

    const history = await streakDefinitionPorts(
      asDb(fake),
    ).listStreakDefinitionVersions(CADENCE, 20);

    expect(history).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.ReadFailed,
        path: `${HEAD}/versions`,
        reason: 'permission-denied',
      },
    });
  });

  it('reads the history of the rhythm it is asked for, by its own id', async () => {
    const other = StreakDefinitionId.of('weekend');
    const fake = published();

    const history = await streakDefinitionPorts(
      asDb(fake),
    ).listStreakDefinitionVersions(other, 20);

    expect(history).toEqual({ ok: true, value: [] });
    expect(fake.reads[0]?.path).toBe('streakDefinitions/weekend/versions');
  });
});
