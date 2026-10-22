import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { filter, firstValueFrom, shareReplay } from 'rxjs';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { AccountLifecycle, BlockReason, E164, Role } from '@core/components';
import { Result, UserId } from '@core/primitives';
import type { User } from '@core/entities';
import { SearchFieldsSystem } from '@core/systems';
import { provisionedUserFixture, registeredUserFixture } from '@core/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { profilePorts, userSearchPorts } from './accounts.adapter';

/** A registered client as `completeRegistration` (Admin SDK) leaves the flat body. */
function registered(uid: string, overrides: Partial<User> = {}): User {
  return registeredUserFixture({ id: UserId.of(uid), ...overrides });
}

/** A user's document body: the entity minus its id (Law 5). */
function bodyOf(user: User): object {
  const { id, ...body } = user;
  expect(typeof id).toBe('string');
  return body;
}

describe('profilePorts and userSearchPorts (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-accounts');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  async function seed(...users: readonly User[]): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      for (const user of users) {
        await setDoc(
          doc(modularFirestore(ctx), 'users', user.id),
          bodyOf(user),
        );
      }
    });
  }

  const ownerOf = (uid: string): RulesTestContext =>
    testEnv.authenticatedContext(uid, { roles: [Role.Client] });
  const profileFor = (context: RulesTestContext) =>
    profilePorts(modularFirestore(context));

  it('answers the owner their own profile as stored through loadProfile', async () => {
    const maria = registered('user-1');
    await seed(maria);

    const found = await profileFor(ownerOf('user-1')).loadProfile(maria.id);

    expect(found).toEqual(Result.ok(maria));
  });

  it('lets staff read a client profile they do not own', async () => {
    const maria = registered('user-2');
    await seed(maria);
    const receptionist = testEnv.authenticatedContext('staff-1', {
      roles: [Role.Receptionist],
    });

    const found = await profileFor(receptionist).loadProfile(maria.id);

    expect(found).toEqual(Result.ok(maria));
  });

  /*
   * The owner's direct write (`ProfilePorts`' retired member) died with 4A-3 (2): `users/{uid}`
   * takes no client update; every owner edit is the `updateProfile`
   * callable's. Its five emulator cases are `dead:` in the §11 ledger.
   */

  it('observeProfile delivers a server-side accountStatus change live', async () => {
    const maria = registered('user-6');
    await seed(maria);
    // ONE listener for the whole test, so the change must arrive on it — a
    // second subscription's first snapshot would prove nothing about "live".
    const live = profileFor(ownerOf('user-6'))
      .observeProfile(maria.id)
      .pipe(shareReplay({ bufferSize: 1, refCount: true }));
    const keepAlive = live.subscribe();

    const first = await firstValueFrom(live);
    expect(first).toEqual(Result.ok(maria));

    const block = AccountLifecycle.block(BlockReason.Manual, null);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(modularFirestore(ctx), 'users', 'user-6'), block);
    });

    const next = await firstValueFrom(
      live.pipe(
        filter(
          (answer) => answer.ok && answer.value?.accountStatus === 'BLOCKED',
        ),
      ),
    );
    keepAlive.unsubscribe();
    expect(next).toEqual(Result.ok({ ...maria, ...block }));
  });

  it('observeProfile answers the PROVISIONED stub as stored — the consumer judges', async () => {
    const stub = provisionedUserFixture({ id: UserId.of('user-7') });
    await seed(stub);

    const answer = await firstValueFrom(
      profileFor(ownerOf('user-7')).observeProfile(stub.id),
    );

    expect(answer).toEqual(Result.ok(stub));
  });

  it('searchUsers answers the front desk index #8 in searchName order, cut at the limit', async () => {
    const client = (uid: string, first: string, last: string, phone: string) =>
      registered(uid, {
        firstName: first,
        lastName: last,
        phone: E164.of(phone),
        ...SearchFieldsSystem.searchFields(first, last, E164.of(phone), null),
      });
    const martin = client('u-martin', 'Мартин', 'Илиев', '+359887654321');
    const maria = client('u-maria', 'Мария', 'Петрова', '+359888000001');
    const ivan = client('u-ivan', 'Иван', 'Маринов', '+359888000002');
    await seed(martin, maria, ivan);
    const desk = userSearchPorts(
      modularFirestore(
        testEnv.authenticatedContext('staff-1', {
          roles: [Role.Receptionist],
        }),
      ),
    );

    const all = await desk.searchUsers('мар', 20);
    const two = await desk.searchUsers('мар', 2);

    // Иван Маринов matches on his last name; the order is the search name's.
    expect(all.ok && all.value.map((user) => user.searchName)).toEqual([
      'иван маринов',
      'мария петрова',
      'мартин илиев',
    ]);
    expect(all.ok && all.value[0]).toEqual(ivan);
    expect(two.ok && two.value.map((user) => user.id)).toEqual([
      ivan.id,
      maria.id,
    ]);
  });
});
