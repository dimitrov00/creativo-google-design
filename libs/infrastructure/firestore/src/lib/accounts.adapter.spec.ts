import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { Firestore } from 'firebase/firestore';
import { E164, Email, Role } from '@core/components';
import {
  AccountsErrorCode,
  RepositoryErrorCode,
  Result,
  UserId,
} from '@core/primitives';
import type { OwnerProfileFields, User } from '@core/entities';
import { ProfileEditSystem, SearchFieldsSystem } from '@core/systems';
import type { ProfileEdits } from '@core/systems';
import {
  FIXTURE_PHONE,
  FIXTURE_TODAY,
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

/**
 * The FIX 2 owner allowlist (`firestore.rules`, `users` update), spelled out
 * here on purpose rather than imported: the spec pins the rule's list.
 */
const OWNER_EDITABLE_KEYS = [
  'birthDate',
  'firstName',
  'lastName',
  'searchName',
  'searchPrefixes',
];

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

/** `ProfileEditSystem.decide` bound to `edits` on the fixture day — what a store hands the port. */
const decideWith = (edits: Partial<ProfileEdits>) => (stored: User | null) =>
  ProfileEditSystem.decide(
    stored,
    { firstName: null, lastName: null, birthDate: null, ...edits },
    FIXTURE_TODAY,
  );

/** The one write the fake applied, as `{ kind, path, keys }`. */
function onlyWrite(fake: FakeFirestore) {
  expect(fake.writes).toHaveLength(1);
  const [write] = fake.writes;
  return {
    kind: write?.kind,
    path: write?.path,
    data: (write?.data ?? {}) as Record<string, unknown>,
  };
}

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

describe('profilePorts.writeOwnProfile — read, decide, update the five keys, in one transaction', () => {
  it('updates only the owner-editable keys, never a whole-document set', async () => {
    const fake = storeOf(MARIA);

    const answer = await profilePorts(asDb(fake)).writeOwnProfile(
      MARIA.id,
      decideWith({ firstName: 'Georgi', birthDate: '1990-05-17' }),
    );

    expect(answer).toEqual(Result.ok(undefined));
    const write = onlyWrite(fake);
    expect(write.kind).toBe('update');
    expect(write.path).toBe(MARIA_PATH);
    expect(Object.keys(write.data).sort()).toEqual(OWNER_EDITABLE_KEYS);
    expect(write.data).toMatchObject({
      firstName: 'Georgi',
      lastName: 'Petrova',
      birthDate: '1990-05-17',
      searchName: 'georgi petrova',
    });
  });

  it('hands decide the transaction’s read: the stored body, or null when absent', async () => {
    const seen: (User | null)[] = [];
    const remember = (stored: User | null) => {
      seen.push(stored);
      return Result.ok(null);
    };

    await profilePorts(asDb(storeOf(MARIA))).writeOwnProfile(
      MARIA.id,
      remember,
    );
    await profilePorts(asDb(new FakeFirestore())).writeOwnProfile(
      MARIA.id,
      remember,
    );

    expect(seen).toEqual([MARIA, null]);
  });

  it('never sends roles, accountStatus, phone or email, whatever the answer carries', async () => {
    const fake = storeOf(MARIA);
    // An answer wider than its type: a whole other account under the cast.
    const wider = {
      ...blockedUserFixture({
        roles: [Role.Client, Role.Admin],
        phone: E164.of('+359877000111'),
        email: Email.of('someone-else@example.com'),
      }),
      firstName: 'Georgi',
      lastName: 'Petrova',
    } as unknown as OwnerProfileFields;

    const answer = await profilePorts(asDb(fake)).writeOwnProfile(
      MARIA.id,
      () => Result.ok(wider),
    );

    expect(answer).toEqual(Result.ok(undefined));
    const { data } = onlyWrite(fake);
    expect(Object.keys(data).sort()).toEqual(OWNER_EDITABLE_KEYS);
    for (const key of [
      'roles',
      'accountStatus',
      'blockReason',
      'phone',
      'email',
    ]) {
      expect(data).not.toHaveProperty(key);
    }
    expect(fake.documentAt(MARIA_PATH)).toMatchObject({
      roles: [Role.Client],
      accountStatus: 'ACTIVE',
      phone: MARIA.phone,
      email: 'mp@abv.bg',
    });
  });

  it('writes the search keys the decide derived from the STORED contact channels', async () => {
    const fake = storeOf(MARIA);

    await profilePorts(asDb(fake)).writeOwnProfile(
      MARIA.id,
      decideWith({ firstName: 'Georgi' }),
    );

    const { data } = onlyWrite(fake);
    expect(data['searchPrefixes']).toEqual(
      SearchFieldsSystem.searchFields(
        'Georgi',
        'Petrova',
        MARIA.phone,
        MARIA.email,
      ).searchPrefixes,
    );
    expect(data['searchPrefixes']).toEqual(
      expect.arrayContaining([
        'georgi',
        '359888123456',
        '0888123456',
        'mp@abv.bg',
      ]),
    );
    // The old first name is gone from the index.
    expect(data['searchPrefixes']).not.toContain('maria');
  });

  it('sends the answer’s null birth date as null — a key of the five is never dropped', async () => {
    const withBirthday = { ...MARIA, birthDate: '1990-05-17' } as User;
    const fake = storeOf(withBirthday);
    const cleared: OwnerProfileFields = {
      firstName: 'Maria',
      lastName: 'Petrova',
      birthDate: null,
      searchName: MARIA.searchName,
      searchPrefixes: MARIA.searchPrefixes,
    };

    await profilePorts(asDb(fake)).writeOwnProfile(MARIA.id, () =>
      Result.ok(cleared),
    );

    const { data } = onlyWrite(fake);
    expect(data).toHaveProperty('birthDate', null);
    expect(fake.documentAt(MARIA_PATH)).toHaveProperty('birthDate', null);
  });

  it('a null answer (nothing changed) writes nothing', async () => {
    const fake = storeOf(MARIA);

    const answer = await profilePorts(asDb(fake)).writeOwnProfile(
      MARIA.id,
      decideWith({ firstName: 'Maria' }),
    );

    expect(answer).toEqual(Result.ok(undefined));
    expect(fake.writes).toEqual([]);
  });

  it('refuses to create: decide over a missing document answers not found, nothing written', async () => {
    const fake = new FakeFirestore();

    const answer = await profilePorts(asDb(fake)).writeOwnProfile(
      MARIA.id,
      decideWith({ firstName: 'Georgi' }),
    );

    expect(answer).toEqual(
      Result.err({ errorCode: AccountsErrorCode.UpdateProfileNotFound }),
    );
    expect(fake.writes).toEqual([]);
    expect(fake.documentAt(MARIA_PATH)).toBeUndefined();
  });

  it('refuses to register: decide over a PROVISIONED stub answers not found, nothing written', async () => {
    const stub = provisionedUserFixture();
    const fake = storeOf(stub);

    const answer = await profilePorts(asDb(fake)).writeOwnProfile(
      stub.id,
      decideWith({ firstName: 'Maria', lastName: 'Petrova' }),
    );

    expect(answer).toEqual(
      Result.err({ errorCode: AccountsErrorCode.UpdateProfileNotFound }),
    );
    expect(fake.writes).toEqual([]);
    expect(fake.documentAt(`users/${stub.id}`)).toEqual(bodyOf(stub));
  });

  it('hands a refusal back as is, nothing written', async () => {
    const fake = storeOf(MARIA);
    const refusal = { errorCode: 'ANY_REFUSAL' } as const;

    const answer = await profilePorts(asDb(fake)).writeOwnProfile(
      MARIA.id,
      () => Result.err(refusal),
    );

    expect(answer).toEqual(Result.err(refusal));
    expect(fake.writes).toEqual([]);
  });

  it('turns a refused transaction (rules, offline) into REPOSITORY_WRITE_FAILED, nothing written', async () => {
    const fake = storeOf(MARIA).failWith({ code: 'permission-denied' });

    const answer = await profilePorts(asDb(fake)).writeOwnProfile(
      MARIA.id,
      decideWith({ firstName: 'Georgi' }),
    );

    expect(answer).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.WriteFailed,
        path: MARIA_PATH,
        reason: 'permission-denied',
      }),
    );
    expect(fake.writes).toEqual([]);
  });

  it('property: the payload is always exactly the allowlist', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray([Role.Client, Role.Barber, Role.Receptionist, Role.Admin], {
          minLength: 1,
        }),
        fc.boolean(),
        fc.constantFrom('+359888123456', '+359877000111', '+359899555010'),
        fc.option(fc.constantFrom('a@example.com', 'b.c@example.org'), {
          nil: null,
        }),
        fc.constantFrom('Georgi', 'Ivan', 'Петър'),
        fc.option(fc.constantFrom('1980-01-31', '2001-12-01'), { nil: null }),
        async (roles, blocked, phone, email, firstName, birthDate) => {
          const stored = (blocked ? blockedUserFixture : registeredUserFixture)(
            {
              roles,
              phone: E164.of(phone),
              email: email === null ? null : Email.of(email),
            },
          );
          const fake = storeOf(stored);
          const answer = await profilePorts(asDb(fake)).writeOwnProfile(
            stored.id,
            decideWith({ firstName, birthDate }),
          );
          expect(answer).toEqual(Result.ok(undefined));
          expect(Object.keys(onlyWrite(fake).data).sort()).toEqual(
            OWNER_EDITABLE_KEYS,
          );
        },
      ),
      { numRuns: 50 },
    );
  });
});

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
