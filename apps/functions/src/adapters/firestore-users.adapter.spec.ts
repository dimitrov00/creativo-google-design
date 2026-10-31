import type { Firestore } from 'firebase-admin/firestore';
import { BirthDate, E164, Email, ParsedIdentifier } from '@core/components';
import { UserId } from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import { provisionedUserFixture, registeredUserFixture } from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreUserPorts } from './firestore-users.adapter';
import { bodyOf } from './store-answer';

/*
 * The account by sign-in destination (identity flip (2)): the single-field
 * query on `phone` or `email` by the parsed channel, the flat body spread as
 * stored — a stub included. Successor of the deleted
 * Firestore user repository spec's lookups.
 */

const MAIL = Email.of('client@example.com');

describe('firestoreUserPorts', () => {
  it('finds a provisioned stub back as stored — PROVISIONED, its one channel, every key present', async () => {
    const stub = provisionedUserFixture({
      id: UserId.of('uid_1'),
      phone: null,
      email: MAIL,
    });
    const fake = createProjectionFirestore({ 'users/uid_1': bodyOf(stub) });
    const result = await firestoreUserPorts(
      fake.db as unknown as Firestore,
    ).findUserByDestination(ParsedIdentifier.email(MAIL));
    expect(result).toEqual({ ok: true, value: stub });
  });

  it('reads a registered user back with its registration state and stored birthDate', async () => {
    const ada = registeredUserFixture({
      id: UserId.of('uid_1'),
      email: MAIL,
      birthDate: BirthDate.of('1990-07-03'),
    });
    const fake = createProjectionFirestore({ 'users/uid_1': bodyOf(ada) });
    const result = await firestoreUserPorts(
      fake.db as unknown as Firestore,
    ).findUserByDestination(ParsedIdentifier.email(MAIL));
    expect(result).toEqual({ ok: true, value: ada });
  });

  it('returns null when no user matches the destination', async () => {
    const fake = createProjectionFirestore({
      'users/uid_1': bodyOf(registeredUserFixture({ email: MAIL })),
    });
    const result = await firestoreUserPorts(
      fake.db as unknown as Firestore,
    ).findUserByDestination(
      ParsedIdentifier.email(Email.of('nobody@example.com')),
    );
    expect(result).toEqual({ ok: true, value: null });
  });

  it('looks up by phone when the destination is a phone — never by e-mail text', async () => {
    const phone = E164.of('+14155552671');
    const fake = createProjectionFirestore({
      'users/uid_2': bodyOf(
        provisionedUserFixture({ id: UserId.of('uid_2'), phone }),
      ),
      // An e-mail field holding the phone's text must not match.
      'users/uid_3': bodyOf(
        provisionedUserFixture({
          id: UserId.of('uid_3'),
          phone: null,
          email: Email.of(phone),
        }),
      ),
    });
    const result = await firestoreUserPorts(
      fake.db as unknown as Firestore,
    ).findUserByDestination(ParsedIdentifier.phone(phone));
    expect(result.ok && result.value?.id).toBe('uid_2');
  });

  it('answers a read that throws as a REPOSITORY_READ_FAILED value', async () => {
    const db = {
      collection: () => {
        throw new Error('down');
      },
    } as unknown as Firestore;
    const result = await firestoreUserPorts(db).findUserByDestination(
      ParsedIdentifier.email(MAIL),
    );
    expect(!result.ok && result.error.errorCode).toBe(
      RepositoryErrorCode.ReadFailed,
    );
  });
});
