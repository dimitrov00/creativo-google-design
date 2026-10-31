import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { filter, firstValueFrom, skip, take, timeout } from 'rxjs';
import { doc, setDoc } from 'firebase/firestore';
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
  StreakDefinitionVersionId,
  UserId,
} from '@core/primitives';
import { StreakRuleSystem } from '@core/systems';
import {
  bodyOf,
  FIXTURE_TODAY,
  localDate,
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
  unwrapOk,
  utcMs,
} from '@core/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { streakDefinitionPorts } from './streak-definitions.adapter';

const CADENCE = StreakRule.DEFAULT_DEFINITION_ID;
const HEAD = 'streakDefinitions/cadence';
const WAITS_FROM = localDate('2026-10-05');

const WIDER_GRACE: StreakRule = {
  ...StreakRule.DEFAULT,
  version: 2,
  effectiveFromLocalDate: WAITS_FROM,
  graceDays: 10,
};

const SEEDED_HEAD: StreakDefinition = streakDefinitionFixture();

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

/**
 * The reads of the rhythm's rule against the emulator and the real rules.
 * The documents are written as the publish pipeline writes them — the flat
 * head and its flat versions: the seeded rule and its first version, then
 * one publish that waits (grace from 7 days to 10, from 5.10).
 */
describe('streakDefinitionPorts (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  async function write(path: string, body: object) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(modularFirestore(ctx), path), body);
    });
  }

  async function publishTheWiderGrace() {
    await write(HEAD, bodyOf(HEAD_WITH_A_WAIT));
    await write(`${HEAD}/versions/${FIRST.id}`, bodyOf(FIRST));
    await write(`${HEAD}/versions/${SECOND.id}`, bodyOf(SECOND));
  }

  const portsFor = (context: RulesTestContext) =>
    streakDefinitionPorts(modularFirestore(context));
  const as = (uid: string, role: string) =>
    portsFor(testEnv.authenticatedContext(uid, { roles: [role] }));

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-streak-definition');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  describe('observeStreakDefinitionHead', () => {
    it('hands a barber the head as stored, the waiting version resolved by date by the system', async () => {
      await publishTheWiderGrace();

      const heard = await firstValueFrom(
        as('staff-ivan', 'barber')
          .observeStreakDefinitionHead(CADENCE)
          .pipe(timeout(10_000)),
      );

      const head = unwrapOk(heard);
      if (head === null) throw new Error('expected a head');
      expect(head).toEqual(HEAD_WITH_A_WAIT);
      expect(StreakRuleSystem.inForceOn(head, FIXTURE_TODAY).graceDays).toBe(7);
      expect(StreakRuleSystem.inForceOn(head, WAITS_FROM).graceDays).toBe(10);
      expect(StreakRuleSystem.upcomingOn(head, FIXTURE_TODAY)?.version).toBe(2);
    });

    it('answers null for a shop that has published no rule', async () => {
      const heard = await firstValueFrom(
        as('staff-ivan', 'barber')
          .observeStreakDefinitionHead(CADENCE)
          .pipe(timeout(10_000)),
      );

      expect(heard).toEqual({ ok: true, value: null });
    });

    it('hears a publish as it lands', async () => {
      await write(HEAD, bodyOf(SEEDED_HEAD));
      const second = firstValueFrom(
        as('staff-dimitar', 'admin')
          .observeStreakDefinitionHead(CADENCE)
          .pipe(
            filter((result) => result.ok),
            skip(1),
            take(1),
            timeout(10_000),
          ),
      );
      // The listener is attached before the write: the first snapshot is a round trip away.
      await new Promise((resolve) => setTimeout(resolve, 300));

      await publishTheWiderGrace();

      expect(unwrapOk(await second)?.rules).toHaveLength(2);
    });

    it('is a failed Result for an anonymous visitor', async () => {
      await publishTheWiderGrace();

      const heard = await firstValueFrom(
        portsFor(testEnv.unauthenticatedContext())
          .observeStreakDefinitionHead(CADENCE)
          .pipe(timeout(10_000)),
      );

      expect(heard.ok).toBe(false);
    });
  });

  describe('listStreakDefinitionVersions', () => {
    it.each(['admin', 'sysadmin'])(
      'lists the history for an %s, newest first, as stored',
      async (role) => {
        await publishTheWiderGrace();

        const history = unwrapOk(
          await as('staff-dimitar', role).listStreakDefinitionVersions(
            CADENCE,
            20,
          ),
        );

        expect(history).toEqual([SECOND, FIRST]);
      },
    );

    it('keeps to the limit, from the newest', async () => {
      await publishTheWiderGrace();

      const history = unwrapOk(
        await as('staff-dimitar', 'admin').listStreakDefinitionVersions(
          CADENCE,
          1,
        ),
      );

      expect(history.map((version) => version.version)).toEqual([2]);
    });

    it('is an empty history for a rule nobody published', async () => {
      const history = await as(
        'staff-dimitar',
        'admin',
      ).listStreakDefinitionVersions(CADENCE, 20);

      expect(history).toEqual({ ok: true, value: [] });
    });

    it.each(['barber', 'receptionist', 'client'])(
      'is a failed Result for a %s: the history is the admin pair’s',
      async (role) => {
        await publishTheWiderGrace();

        const history = await as('somebody', role).listStreakDefinitionVersions(
          CADENCE,
          20,
        );

        expect(history.ok).toBe(false);
      },
    );
  });
});
