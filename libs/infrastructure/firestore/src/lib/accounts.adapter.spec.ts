import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { E164, Email } from '@core/components';
import { RepositoryErrorCode, Result, UserId } from '@core/primitives';
import type { User } from '@core/entities';
import { SearchFieldsSystem } from '@core/systems';
import {
  FIXTURE_PHONE,
  blockedUserFixture,
  provisionedUserFixture,
  registeredUserFixture,
} from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { profilePorts, userSearchPorts } = await import('./accounts.adapter');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

/** Everything a stream said, in order. */
function recorded<T>(stream: {
  subscribe: (next: (value: T) => void) => { unsubscribe(): void };
}) {
  const seen: T[] = [];
  const subscription = stream.subscribe((value) => seen.push(value));
  return { seen, stop: () => subscription.unsubscribe() };
}

/** A user's document body: the entity minus its id (Law 5). */
function bodyOf(user: User): object {
  const { id, ...body } = user;
  expect(typeof id).toBe('string');
  return body;
}

/** The fake holding `users` as stored, each at `users/{id}`. */
function storeOf(...users: readonly User[]): FakeFirestore {
  return new FakeFirestore(
    new Map(users.map((user) => [`users/${user.id}`, bodyOf(user)])),
  );
}

/**
 * Maria Petrova, registered, with an e-mail whose local part is too short to
 * index — so every `maria` prefix left on her is her first name's — and the
 * search keys registration computes from her names and BOTH contact channels.
 */
const MARIA_EMAIL = Email.of('mp@abv.bg');
const MARIA = registeredUserFixture({
  email: MARIA_EMAIL,
  ...SearchFieldsSystem.searchFields(
    'Maria',
    'Petrova',
    FIXTURE_PHONE,
    MARIA_EMAIL,
  ),
});
const MARIA_PATH = `users/${MARIA.id}`;

describe('profilePorts.observeProfile — users/{uid}, live, as stored', () => {
  it('answers null while there is no document, then the body the server writes', () => {
    const fake = new FakeFirestore();
    const profile = recorded(profilePorts(asDb(fake)).observeProfile(MARIA.id));

    fake.set(MARIA_PATH, bodyOf(MARIA));

    expect(profile.seen).toEqual([Result.ok(null), Result.ok(MARIA)]);
    expect(fake.reads).toEqual([
      { kind: 'listen', path: MARIA_PATH, constraints: [] },
    ]);
    profile.stop();
  });

  it('a stub is answered as stored — the PROVISIONED body, never null; the consumer judges', () => {
    const stub = provisionedUserFixture();
    const fake = storeOf(stub);

    const profile = recorded(profilePorts(asDb(fake)).observeProfile(stub.id));

    expect(profile.seen).toEqual([Result.ok(stub)]);
    profile.stop();
  });

  it('a server-written accountStatus change arrives live, the block’s keys at the root', () => {
    const fake = storeOf(MARIA);
    const profile = recorded(profilePorts(asDb(fake)).observeProfile(MARIA.id));

    const blocked = blockedUserFixture({ email: MARIA.email });
    fake.set(MARIA_PATH, bodyOf(blocked));

    expect(profile.seen).toEqual([Result.ok(MARIA), Result.ok(blocked)]);
    const latest = profile.seen.at(-1);
    expect(latest?.ok && latest.value).toMatchObject({
      accountStatus: 'BLOCKED',
      blockReason: 'MANUAL',
      firstName: 'Maria',
      email: 'mp@abv.bg',
    });
    profile.stop();
  });

  it('answers a refused read as the port’s RepositoryError', () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const profile = recorded(profilePorts(asDb(fake)).observeProfile(MARIA.id));

    expect(profile.seen).toEqual([
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: MARIA_PATH,
        reason: 'permission-denied',
      }),
    ]);
  });

  it('detaches the snapshot listener on unsubscribe', () => {
    const fake = storeOf(MARIA);
    const profile = recorded(profilePorts(asDb(fake)).observeProfile(MARIA.id));
    expect(fake.listening).toBe(1);

    profile.stop();

    expect(fake.listening).toBe(0);
  });
});

describe('profilePorts.loadProfile — users/{uid}, once, as stored', () => {
  it('answers null when the document does not exist', async () => {
    const fake = new FakeFirestore();

    const found = await profilePorts(asDb(fake)).loadProfile(MARIA.id);

    expect(found).toEqual(Result.ok(null));
    expect(fake.reads).toEqual([
      { kind: 'document', path: MARIA_PATH, constraints: [] },
    ]);
  });

  it('answers the stored body as the flat User, unmapped — { id, ...data }', async () => {
    const blocked = blockedUserFixture({ email: MARIA_EMAIL });

    const found = await profilePorts(asDb(storeOf(blocked))).loadProfile(
      blocked.id,
    );

    expect(found).toEqual(Result.ok(blocked));
  });

  it('a stub is answered as stored — the PROVISIONED body, never null; the consumer judges', async () => {
    const stub = provisionedUserFixture();

    const found = await profilePorts(asDb(storeOf(stub))).loadProfile(stub.id);

    expect(found).toEqual(Result.ok(stub));
  });

  it('answers a refused read as the port’s RepositoryError', async () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const found = await profilePorts(asDb(fake)).loadProfile(MARIA.id);

    expect(found).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: MARIA_PATH,
        reason: 'permission-denied',
      }),
    );
  });
});

/*
 * `profilePorts`' owner-write member died with 4A-3 (2): `users/{uid}` takes no
 * client update, and every owner edit goes through the `updateProfile`
 * callable (`saveOwnProfile`). Its eleven cases are `dead:` in the §11
 * ledger — the five-key allowlist they pinned is the server pipeline's now.
 */

describe('userSearchPorts.searchUsers — index #8, the stored bodies in its order', () => {
  /** A registered client whose search keys are computed from the names, as registration writes them. */
  function client(
    id: string,
    firstName: string,
    lastName: string,
    rawPhone: string,
  ): User {
    const phone = E164.of(rawPhone);
    return registeredUserFixture({
      id: UserId.of(id),
      firstName,
      lastName,
      phone,
      ...SearchFieldsSystem.searchFields(firstName, lastName, phone, null),
    });
  }

  const MARTIN = client('u-martin', 'Мартин', 'Илиев', '+359887654321');
  const MARIA_P = client('u-maria', 'Мария', 'Петрова', '+359888000001');
  const IVAN = client('u-ivan', 'Иван', 'Маринов', '+359888000002');

  it('asks searchPrefixes array-contains, orderBy searchName, limit — and answers the stored rows', async () => {
    const fake = storeOf(MARTIN, MARIA_P, IVAN);

    const found = await userSearchPorts(asDb(fake)).searchUsers('мар', 20);

    // Иван Маринов matches on his last name; the order is the search name's.
    expect(found).toEqual(
      Result.ok([MARIA_P, MARTIN, IVAN].sort(bySearchName)),
    );
    expect(fake.reads).toEqual([
      {
        kind: 'query',
        path: 'users',
        constraints: [
          'searchPrefixes array-contains "мар"',
          'orderBy searchName asc',
          'limit 20',
        ],
      },
    ]);
  });

  it('names nobody: each row is the body as written — the display name is the caller’s', async () => {
    const found = await userSearchPorts(asDb(storeOf(MARTIN))).searchUsers(
      'март',
      20,
    );

    expect(found.ok && found.value[0]).toMatchObject({
      firstName: 'Мартин',
      lastName: 'Илиев',
      searchName: 'мартин илиев',
      phone: MARTIN.phone,
    });
  });

  it('cuts at the caller’s limit', async () => {
    const found = await userSearchPorts(
      asDb(storeOf(MARTIN, MARIA_P, IVAN)),
    ).searchUsers('мар', 2);

    expect(found.ok && found.value.map((user) => user.id)).toEqual(
      [MARIA_P, MARTIN, IVAN]
        .sort(bySearchName)
        .slice(0, 2)
        .map((u) => u.id),
    );
  });

  it('answers a refused query as the port’s RepositoryError', async () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const found = await userSearchPorts(asDb(fake)).searchUsers('ivan', 20);

    expect(found).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'users',
        reason: 'permission-denied',
      }),
    );
  });
});

function bySearchName(a: User, b: User): number {
  const left = a.searchName ?? '';
  const right = b.searchName ?? '';
  return left < right ? -1 : left > right ? 1 : 0;
}
