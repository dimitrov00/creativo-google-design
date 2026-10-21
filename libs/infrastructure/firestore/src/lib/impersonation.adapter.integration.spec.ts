import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { firstValueFrom } from 'rxjs';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { EndReasonFields, ImpersonationStatus, Role } from '@core/components';
import {
  ImpersonationSessionId,
  RepositoryErrorCode,
  Result,
  UserId,
} from '@core/primitives';
import type { ImpersonationSession } from '@core/entities';
import { impersonationSessionFixture, utcMs } from '@core/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { impersonationReadPorts } from './impersonation.adapter';

const ADMIN = UserId.of('u-admin');

/** A session's document body: the entity minus its id (Law 5). */
function bodyOf(session: ImpersonationSession): object {
  const { id, ...body } = session;
  expect(typeof id).toBe('string');
  return body;
}

describe('impersonationReadPorts (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-impersonation');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  /** Seeds the flat bodies as Phase 4's callables will write them (rules off). */
  async function seed(...sessions: readonly ImpersonationSession[]) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      for (const session of sessions) {
        await setDoc(
          doc(modularFirestore(ctx), 'impersonationSessions', session.id),
          bodyOf(session),
        );
      }
    });
  }

  const readsFor = (context: RulesTestContext) =>
    impersonationReadPorts(modularFirestore(context));

  it('finds the one ACTIVE session for an admin — the flat body as stored — and writes no audit row', async () => {
    const active = impersonationSessionFixture();
    const ended: ImpersonationSession = {
      ...impersonationSessionFixture({
        id: ImpersonationSessionId.of('imp-ended'),
      }),
      impersonationStatus: ImpersonationStatus.Ended,
      endedAtUtcMs: utcMs('2026-09-28T06:01:00+00:00'),
      ...EndReasonFields.adminEnded(ADMIN),
    };
    await seed(active, ended);
    const admin = testEnv.authenticatedContext(ADMIN, { roles: [Role.Admin] });

    const answer = await firstValueFrom(
      readsFor(admin).observeActiveImpersonation(ADMIN),
    );

    expect(answer).toEqual(Result.ok(active));
    // FIX 1: no client creates audit rows — the browser binds no write here.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const audit = await getDocs(
        collection(modularFirestore(ctx), 'auditLog'),
      );
      expect(audit.empty).toBe(true);
    });
  });

  it('answers null for an admin with no ACTIVE session', async () => {
    await seed(
      impersonationSessionFixture({ adminUserId: UserId.of('u-other-admin') }),
    );
    const admin = testEnv.authenticatedContext(ADMIN, { roles: [Role.Admin] });

    const answer = await firstValueFrom(
      readsFor(admin).observeActiveImpersonation(ADMIN),
    );

    expect(answer).toEqual(Result.ok(null));
  });

  it('denies a non-admin the read', async () => {
    await seed(impersonationSessionFixture());
    const client = testEnv.authenticatedContext('some-client', {
      roles: [Role.Client],
    });

    const answer = await firstValueFrom(
      readsFor(client).observeActiveImpersonation(ADMIN),
    );

    expect(answer).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'impersonationSessions',
        reason: 'permission-denied',
      }),
    );
  });
});
