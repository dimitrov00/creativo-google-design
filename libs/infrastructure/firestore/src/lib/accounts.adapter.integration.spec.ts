import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { filter, firstValueFrom, shareReplay } from 'rxjs';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import {
  AccountLifecycle,
  BlockReason,
  E164,
  Email,
  Role,
} from '@core/components';
import { AccountsErrorCode, Result, UserId } from '@core/primitives';
import type { User } from '@core/entities';
import { ProfileEditSystem, SearchFieldsSystem } from '@core/systems';
import type { ProfileEdits } from '@core/systems';
import {
  FIXTURE_TODAY,
  provisionedUserFixture,
  registeredUserFixture,
  utcMs,
} from '@core/testing';
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

/** `ProfileEditSystem.decide` bound to `edits` on the fixture day — what a store hands the port. */
const decideWith = (edits: Partial<ProfileEdits>) => (stored: User | null) =>
  ProfileEditSystem.decide(
    stored,
    { firstName: null, lastName: null, birthDate: null, ...edits },
    FIXTURE_TODAY,
  );

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

  async function stored(uid: string): Promise<Record<string, unknown> | null> {
    let data: Record<string, unknown> | null = null;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      data =
        (await getDoc(doc(modularFirestore(ctx), 'users', uid))).data() ?? null;
    });
    return data;
  }

  const ownerOf = (uid: string): RulesTestContext =>
    testEnv.authenticatedContext(uid, { roles: [Role.Client] });
  const profileFor = (context: RulesTestContext) =>
    profilePorts(modularFirestore(context));

  it('round-trips an owner name edit through writeOwnProfile/loadProfile', async () => {
    const maria = registered('user-1');
    await seed(maria);
    const ports = profileFor(ownerOf('user-1'));

    const written = await ports.writeOwnProfile(
      maria.id,
      decideWith({ firstName: 'Georgi', birthDate: '1990-05-17' }),
    );
    expect(written).toEqual(Result.ok(undefined));

    const found = await ports.loadProfile(maria.id);
    expect(found.ok && found.value).toMatchObject({
      firstName: 'Georgi',
      lastName: 'Petrova',
      birthDate: '1990-05-17',
      searchName: 'georgi petrova',
    });
    expect((await stored('user-1'))?.['searchPrefixes']).toEqual(
      expect.arrayContaining(['georgi', 'petrova', '359888123456']),
    );
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

  it('leaves roles, phone and email as stored: the write carries the five owner keys only', async () => {
    const maria = registered('user-3', {
      email: Email.of('mp@abv.bg'),
      ...SearchFieldsSystem.searchFields(
        'Maria',
        'Petrova',
        E164.of('+359888123456'),
        Email.of('mp@abv.bg'),
      ),
    });
    await seed(maria);

    const written = await profileFor(ownerOf('user-3')).writeOwnProfile(
      maria.id,
      decideWith({ firstName: 'Georgi' }),
    );

    // The rules' owner allowlist admits it because nothing else is sent.
    expect(written).toEqual(Result.ok(undefined));
    expect(await stored('user-3')).toMatchObject({
      firstName: 'Georgi',
      roles: [Role.Client],
      phone: '+359888123456',
      email: 'mp@abv.bg',
      registrationState: 'REGISTERED',
    });
  });

  it("leaves a server-written block untouched by the owner's name save", async () => {
    const block = AccountLifecycle.block(
      BlockReason.Manual,
      utcMs('2026-12-01T00:00:00+00:00'),
    );
    const maria = registered('user-4', block);
    await seed(maria);

    const written = await profileFor(ownerOf('user-4')).writeOwnProfile(
      maria.id,
      decideWith({ firstName: 'Georgi' }),
    );

    expect(written).toEqual(Result.ok(undefined));
    expect(await stored('user-4')).toMatchObject({
      firstName: 'Georgi',
      ...block,
    });
  });

  it('never creates the document: writing a missing profile is refused, nothing exists', async () => {
    const written = await profileFor(ownerOf('user-5')).writeOwnProfile(
      UserId.of('user-5'),
      decideWith({ firstName: 'Georgi' }),
    );

    expect(written).toEqual(
      Result.err({ errorCode: AccountsErrorCode.UpdateProfileNotFound }),
    );
    expect(await stored('user-5')).toBeNull();
  });

  it('a PROVISIONED stub is refused by decide and stays as stored', async () => {
    const stub = provisionedUserFixture({ id: UserId.of('user-8') });
    await seed(stub);

    const written = await profileFor(ownerOf('user-8')).writeOwnProfile(
      stub.id,
      decideWith({ firstName: 'Maria', lastName: 'Petrova' }),
    );

    expect(written).toEqual(
      Result.err({ errorCode: AccountsErrorCode.UpdateProfileNotFound }),
    );
    expect(await stored('user-8')).toEqual(bodyOf(stub));
  });

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
