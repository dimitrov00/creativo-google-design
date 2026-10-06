import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { filter, firstValueFrom, skip, take, timeout } from 'rxjs';
import { doc, setDoc } from 'firebase/firestore';
import {
  FIREBASE_FIRESTORE,
  FIREBASE_FUNCTIONS,
} from '@creativo/infrastructure/firebase-app';
import { StreakDefinition } from '@creativo/application/engagement';
import {
  InMemoryStreakDefinitionRepository,
  loyaltyFixtures,
} from '@creativo/application/engagement/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { FirestoreStreakDefinitionRepository } from './streak-definition-repository.adapter';

const HEAD = 'streakDefinitions/cadence';
const TODAY = loyaltyFixtures.today;

function repositoryFor(
  context: RulesTestContext,
): FirestoreStreakDefinitionRepository {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: modularFirestore(context) },
      // The writes are the callable's: no spec here sends one.
      { provide: FIREBASE_FUNCTIONS, useValue: {} },
      FirestoreStreakDefinitionRepository,
    ],
  });
  return TestBed.inject(FirestoreStreakDefinitionRepository);
}

/**
 * The reads of the rhythm's rule against the emulator and the real rules.
 * The documents are the ones the port's reference writes, which is how the
 * callable writes them: the seeded head and its first version, then one
 * publish that waits (grace from 7 days to 10, from 5.10).
 */
describe('FirestoreStreakDefinitionRepository (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  async function write(path: string, data: object) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(modularFirestore(ctx), path), data);
    });
  }

  async function publishTheWiderGrace() {
    const revised = StreakDefinition.default().revise(
      { graceDays: 10 },
      '2026-10-05',
    );
    if (revised.isFailure()) throw new Error('bad fixture rule');
    const reference = InMemoryStreakDefinitionRepository.seeded({
      today: TODAY,
    });
    const written = await reference.publish({
      requestId: 'req-wider-grace',
      baseVersion: 1,
      definition: revised.value,
      transition: 'grandfather',
      previewHash: null,
    });
    if (written.isFailure()) throw written.error;
    const documents = reference.documentsOf('cadence');
    if (documents === null) throw new Error('the reference holds no rule');
    await write(HEAD, documents.head);
    for (const [id, version] of Object.entries(documents.versions)) {
      await write(`${HEAD}/versions/${id}`, version);
    }
  }

  const as = (uid: string, role: string) =>
    repositoryFor(testEnv.authenticatedContext(uid, { roles: [role] }));

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-streak-definition');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  describe('observe', () => {
    it('hands a barber the head as a schedule, the waiting version resolved by date', async () => {
      await publishTheWiderGrace();

      const heard = await firstValueFrom(
        as('staff-ivan', 'barber').observe('cadence').pipe(timeout(10_000)),
      );

      if (heard.isFailure() || heard.value === null) {
        throw new Error('expected a schedule');
      }
      expect(heard.value.inForceOn(TODAY).graceDays).toBe(7);
      expect(heard.value.inForceOn('2026-10-05').graceDays).toBe(10);
      expect(heard.value.upcomingOn(TODAY)?.definition.version).toBe(2);
    });

    it('answers null for a shop that has published no rule', async () => {
      const heard = await firstValueFrom(
        as('staff-ivan', 'barber').observe('cadence').pipe(timeout(10_000)),
      );

      expect(heard.isSuccess() && heard.value).toBeNull();
    });

    it('hears a publish as it lands', async () => {
      await write(
        HEAD,
        loyaltyFixtures.catalog.streakDefinitions['cadence'] ?? {},
      );
      const second = firstValueFrom(
        as('staff-dimitar', 'admin')
          .observe('cadence')
          .pipe(
            filter((result) => result.isSuccess()),
            skip(1),
            take(1),
            timeout(10_000),
          ),
      );
      // The listener is attached before the write: the first snapshot is a round trip away.
      await new Promise((resolve) => setTimeout(resolve, 300));

      await publishTheWiderGrace();

      const heard = await second;
      expect(
        heard.isSuccess() && heard.value?.scheduled?.definition.graceDays,
      ).toBe(10);
    });

    it('is a failed Result for an anonymous visitor', async () => {
      await publishTheWiderGrace();
      const anonymous = repositoryFor(testEnv.unauthenticatedContext());

      const heard = await firstValueFrom(
        anonymous.observe('cadence').pipe(timeout(10_000)),
      );

      expect(heard.isFailure()).toBe(true);
    });
  });

  describe('listVersions', () => {
    it.each(['admin', 'sysadmin'])(
      'lists the history for an %s, newest first',
      async (role) => {
        await publishTheWiderGrace();

        const history = await as('staff-dimitar', role).listVersions(
          'cadence',
          20,
        );

        if (history.isFailure()) throw history.error;
        expect(history.value.map((v) => v.definition.version)).toEqual([2, 1]);
        expect(history.value[0]).toMatchObject({
          publishedBy: 'dev-staff-ivan',
          requestId: 'req-wider-grace',
          transition: 'grandfather',
          direction: 'looser',
          changed: ['graceDays'],
          withdrawnAt: null,
        });
        expect(history.value[0]?.definition.name.bg).toBe('Посещения в ритъм');
        expect(history.value[0]?.publishedAt).toBeInstanceOf(Date);
      },
    );

    it('keeps to the limit, from the newest', async () => {
      await publishTheWiderGrace();

      const history = await as('staff-dimitar', 'admin').listVersions(
        'cadence',
        1,
      );

      expect(
        history.isSuccess() && history.value.map((v) => v.definition.version),
      ).toEqual([2]);
    });

    it('is an empty history for a rule nobody published', async () => {
      const history = await as('staff-dimitar', 'admin').listVersions(
        'cadence',
        20,
      );

      expect(history.isSuccess() && history.value).toEqual([]);
    });

    it.each(['barber', 'receptionist', 'client'])(
      'is a failed Result for a %s: the history is the admin pair’s',
      async (role) => {
        await publishTheWiderGrace();

        const history = await as('somebody', role).listVersions('cadence', 20);

        expect(history.isFailure()).toBe(true);
      },
    );
  });
});
