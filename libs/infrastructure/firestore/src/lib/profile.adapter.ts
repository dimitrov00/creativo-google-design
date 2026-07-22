import { Injectable, inject } from '@angular/core';
import type { DocumentData } from 'firebase/firestore';
import { getDoc, setDoc } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { ProfilePort } from '@creativo/application/accounts';
import { RepositoryError } from '@creativo/application/shared';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  AccountStatus,
  BlockReason,
  User,
  UserId,
  parseBlockReason,
} from '@creativo/domain/accounts';
import { userDocRef } from './firestore-paths';

/** `User.create`/`.reconstitute` require a `today: ZonedDateTime` — there is
 * no `CLOCK` port wired into `libs/infrastructure` in this phase, so it's
 * computed inline here. Only used for zone-consistent birth-date parsing;
 * age re-validation is skipped on reconstitute regardless (see
 * `BirthDate.reconstitute`). Revisit once a `CLOCK` adapter exists. */
function todayInAppZone(): ZonedDateTime {
  const result = ZonedDateTime.now('Europe/Sofia');
  if (result.isFailure()) {
    // 'Europe/Sofia' is a hard-coded, always-valid IANA zone — unreachable.
    throw new Error('Unreachable: Europe/Sofia is always a valid zone');
  }
  return result.value;
}

function prefixesOf(token: string): string[] {
  const out: string[] = [];
  for (let i = 1; i <= token.length; i += 1) {
    out.push(token.slice(0, i));
  }
  return out;
}

/** Standard Firestore "poor man's search" trick (mirrors v2's real
 * `users (searchPrefixes ARRAY_CONTAINS, searchName ASC)` index): every
 * prefix of every whitespace-split token in the full name, lowercased. */
function computeSearchFields(fullName: string): {
  searchName: string;
  searchPrefixes: string[];
} {
  const searchName = fullName.trim().toLowerCase();
  const tokens = searchName.split(/\s+/).filter((t) => t.length > 0);
  const prefixSet = new Set<string>();
  for (const token of tokens) {
    for (const prefix of prefixesOf(token)) {
      prefixSet.add(prefix);
    }
  }
  return { searchName, searchPrefixes: [...prefixSet] };
}

interface PersistedAccountStatus {
  kind: 'active' | 'blocked';
  reason?: string;
  untilIso?: string | null;
}

function statusToPersistence(status: AccountStatus): PersistedAccountStatus {
  if (status.kind === 'active') {
    return { kind: 'active' };
  }
  return {
    kind: 'blocked',
    reason: status.reason,
    untilIso: status.until ? status.until.toISO() : null,
  };
}

function statusFromPersistence(
  data: PersistedAccountStatus,
): Result<AccountStatus, RepositoryError> {
  if (data.kind === 'active') {
    return ok(AccountStatus.active());
  }
  const reasonResult = parseBlockReason(data.reason ?? '');
  if (reasonResult.isFailure()) {
    return fail(
      new RepositoryError(
        'Malformed user document: bad block reason',
        reasonResult.error,
      ),
    );
  }
  let until: ZonedDateTime | undefined;
  if (data.untilIso) {
    const untilResult = ZonedDateTime.fromISO(data.untilIso, 'Europe/Sofia');
    if (untilResult.isFailure()) {
      return fail(
        new RepositoryError(
          'Malformed user document: bad block until',
          untilResult.error,
        ),
      );
    }
    until = untilResult.value;
  }
  const reason: BlockReason = reasonResult.value;
  return ok(
    AccountStatus.blocked({ reason, ...(until !== undefined && { until }) }),
  );
}

function toPersistence(user: User): DocumentData {
  const { searchName, searchPrefixes } = computeSearchFields(user.fullName());
  return {
    phone: user.phone.value,
    firstName: user.firstName.value,
    lastName: user.lastName.value,
    roles: [...user.roles],
    status: statusToPersistence(user.status),
    email: user.email ? user.email.value : null,
    birthDate: user.birthDate ? user.birthDate.toISODate() : null,
    searchName,
    searchPrefixes,
  };
}

function toDomain(
  id: string,
  data: DocumentData,
): Result<User, RepositoryError> {
  const statusResult = statusFromPersistence(
    data['status'] as PersistedAccountStatus,
  );
  if (statusResult.isFailure()) {
    return statusResult;
  }
  const reconstituted = User.reconstitute(
    {
      id,
      phone: data['phone'],
      firstName: data['firstName'],
      lastName: data['lastName'],
      roles: Array.isArray(data['roles']) ? data['roles'] : [],
      status: statusResult.value,
      email: data['email'] ?? undefined,
      birthDate: data['birthDate'] ?? undefined,
    },
    todayInAppZone(),
  );
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError('Malformed user document', reconstituted.error),
    );
  }
  return ok(reconstituted.value);
}

/** Direct Firestore adapter (not callable-backed) for `ProfilePort` —
 * `users/{uid}` rules allow the owner to read/create/update their own
 * profile fields (never `roles`/`status`), so profile reads/writes don't
 * need server round-tripping. */
@Injectable()
export class FirestoreProfileAdapter implements ProfilePort {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async getProfile(
    userId: UserId,
  ): Promise<Result<User | null, RepositoryError>> {
    try {
      const snapshot = await getDoc(userDocRef(this.db, userId));
      if (!snapshot.exists()) {
        return ok(null);
      }
      return toDomain(snapshot.id, snapshot.data());
    } catch (error) {
      return fail(new RepositoryError('Failed to load user profile', error));
    }
  }

  async saveProfile(user: User): Promise<Result<void, RepositoryError>> {
    try {
      await setDoc(userDocRef(this.db, user.id), toPersistence(user));
      return ok(undefined);
    } catch (error) {
      return fail(new RepositoryError('Failed to save user profile', error));
    }
  }
}
