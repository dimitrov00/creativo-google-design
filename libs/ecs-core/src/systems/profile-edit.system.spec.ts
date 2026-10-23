import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  BirthDate,
  BlockReason,
  E164,
  Email,
  ParsedIdentifier,
  RegistrationState,
  Role,
  type ProfileEdits,
} from '@core/components';
import { UserId } from '@core/primitives';
import type { User } from '@core/entities';
import {
  deepFreeze,
  localDate,
  unwrapErr,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { AuditSystem } from './audit.system';
import { NameRule, ProfileEditSystem } from './profile-edit.system';
import {
  type RegistrationSettlement,
  RegistrationSystem,
} from './registration.system';
import { SearchFieldsSystem } from './search-fields.system';

/*
 * COPIED, not moved, while the legacy specs still ran (deleted in Phase 4b;
 * ledger `docs/architecture/flips/phase-4b-delete.md` §11.1):
 * - the legacy accounts `first-name.spec.ts` and `last-name.spec.ts` — the
 *   name rule (`nameRefusals`);
 * - the legacy accounts `user.spec.ts` — `User.create`'s phone, names,
 *   e-mail, roles and create-mode birth-date checks
 *   (`registrationProfile`), on its fixture day 2026-07-22;
 * - libs/infrastructure/firestore/src/lib/profile.adapter.spec.ts — the
 *   owner edit's search keys (the STORED contact wins, a name-only edit
 *   recomputes every prefix) and the stub refusal (`decide`).
 */

/** The legacy aggregate's "today" — the UTC civil date the boundary derives (F2-7). */
const AGE_DAY = localDate('2026-07-22');

/** A registered owner: Ivan Petrov, a stored phone and e-mail. */
function owner(overrides: Partial<User> = {}): User {
  const base: User = {
    id: UserId.of('uid_1'),
    registrationState: RegistrationState.Registered,
    phone: E164.of('+359888123456'),
    firstName: 'Ivan',
    lastName: 'Petrov',
    roles: [Role.Client],
    ...AccountLifecycle.active(),
    email: Email.of('ip@abv.bg'),
    birthDate: BirthDate.of('1990-05-17'),
    profileEditedAtUtcMs: null,
    ...SearchFieldsSystem.searchFields(
      'Ivan',
      'Petrov',
      E164.of('+359888123456'),
      'ip@abv.bg',
    ),
  };
  return { ...base, ...overrides } as User;
}

/** An edit with only the given fields — every other one `null` (keep). */
function edits(given: Partial<ProfileEdits> = {}): ProfileEdits {
  return { firstName: null, lastName: null, birthDate: null, ...given };
}

/** `User.spec`'s valid props, as a settlement. */
function settlement(
  overrides: Partial<RegistrationSettlement> = {},
): RegistrationSettlement {
  return {
    firstName: 'Ivo',
    lastName: 'Petrov',
    phone: '+359885550100',
    email: 'client@example.com',
    birthDate: BirthDate.of('2000-01-01'),
    roles: [Role.Client],
    ...overrides,
  };
}

describe('ProfileEditSystem.nameRefusals (first-name.spec.ts, last-name.spec.ts)', () => {
  it('accepts a name at the minimum length', () => {
    expect(NameRule.MinLength).toBe(2);
    expect(ProfileEditSystem.nameRefusals('Al', 'Bo')).toEqual([]);
  });

  it('trims surrounding whitespace', () => {
    expect(ProfileEditSystem.nameRefusals('  Ivo  ', '  Ko ')).toEqual([]);
    const fields = unwrapOk(
      ProfileEditSystem.decide(
        owner(),
        edits({ firstName: '  Ivo  ', lastName: ' Ko ' }),
        AGE_DAY,
      ),
    );
    expect(fields).toMatchObject({ firstName: 'Ivo', lastName: 'Ko' });
  });

  it('rejects a name shorter than the minimum', () => {
    for (const short of ['A', '', '  ']) {
      expect(ProfileEditSystem.nameRefusals(short, 'Petrov')).toEqual([
        {
          errorCode: 'ACCOUNTS_FIRST_NAME_TOO_SHORT',
          attempted: short,
          minLength: 2,
        },
      ]);
      expect(ProfileEditSystem.nameRefusals('Ivo', short)).toEqual([
        {
          errorCode: 'ACCOUNTS_LAST_NAME_TOO_SHORT',
          attempted: short,
          minLength: 2,
        },
      ]);
    }
    expect(
      ProfileEditSystem.nameRefusals('A', 'B').map((e) => e.errorCode),
    ).toEqual([
      'ACCOUNTS_FIRST_NAME_TOO_SHORT',
      'ACCOUNTS_LAST_NAME_TOO_SHORT',
    ]);
  });
});

describe('ProfileEditSystem.decide — the owner edit (F2-6)', () => {
  it('rebuilds the search keys from the edited name and the STORED contact channels', () => {
    const fields = unwrapOk(
      ProfileEditSystem.decide(
        owner(),
        edits({ firstName: 'Georgi' }),
        AGE_DAY,
      ),
    );
    expect(fields).not.toBeNull();
    const prefixes = fields?.searchPrefixes ?? [];
    expect(prefixes).toEqual(
      expect.arrayContaining([
        'g',
        'georgi',
        'petrov',
        // The stored number in both forms, from the 3rd digit…
        '359888123456',
        '0888123456',
        // …and the stored e-mail.
        'ip@',
        'ip@abv.bg',
      ]),
    );
    // The old first name is gone from the index.
    expect(prefixes).not.toContain('ivan');
    expect(fields?.searchName).toBe('georgi petrov');
  });

  it('answers exactly the five owner keys — the rules’ allowlist, nothing else', () => {
    const fields = unwrapOk(
      ProfileEditSystem.decide(
        owner(),
        edits({ lastName: 'Ivanov', birthDate: '1991-02-03' }),
        AGE_DAY,
      ),
    );
    expect(Object.keys(fields ?? {}).sort()).toEqual([
      'birthDate',
      'firstName',
      'lastName',
      'searchName',
      'searchPrefixes',
    ]);
    expect(fields).toMatchObject({
      firstName: 'Ivan',
      lastName: 'Ivanov',
      birthDate: '1991-02-03',
    });
  });

  it('answers null when nothing changes — the same edit twice writes nothing (value-idempotent)', () => {
    expect(ProfileEditSystem.decide(owner(), edits(), AGE_DAY)).toEqual({
      ok: true,
      value: null,
    });
    expect(
      ProfileEditSystem.decide(
        owner(),
        edits({
          firstName: ' Ivan ',
          lastName: 'Petrov',
          birthDate: '1990-05-17',
        }),
        AGE_DAY,
      ),
    ).toEqual({ ok: true, value: null });
    // Applied once, the second identical edit is empty.
    const first = unwrapOk(
      ProfileEditSystem.decide(
        owner(),
        edits({ firstName: 'Georgi' }),
        AGE_DAY,
      ),
    );
    const after = owner({ ...first });
    expect(
      ProfileEditSystem.decide(after, edits({ firstName: 'Georgi' }), AGE_DAY),
    ).toEqual({ ok: true, value: null });
  });

  it('keeps the stored birth date when the edit leaves it out — there is no clearing', () => {
    const fields = unwrapOk(
      ProfileEditSystem.decide(
        owner(),
        edits({ firstName: 'Georgi' }),
        AGE_DAY,
      ),
    );
    expect(fields?.birthDate).toBe('1990-05-17');
    const none = unwrapOk(
      ProfileEditSystem.decide(
        owner({ birthDate: null }),
        edits({ firstName: 'Georgi' }),
        AGE_DAY,
      ),
    );
    expect(none?.birthDate).toBeNull();
  });

  it('refuses as a validation failure: a short name, an unreal date, a date outside the 16–120 window', () => {
    const refusals: readonly ProfileEdits[] = [
      edits({ firstName: 'G' }),
      edits({ lastName: ' ' }),
      edits({ birthDate: '1990-02-30' }),
      edits({ birthDate: '17/05/1990' }),
      edits({ birthDate: '2020-01-01' }),
      edits({ birthDate: '1900-01-01' }),
      edits({ birthDate: '2027-01-01' }),
      edits({ birthDate: '' }),
    ];
    for (const refused of refusals) {
      expect(ProfileEditSystem.decide(owner(), refused, AGE_DAY)).toEqual({
        ok: false,
        error: { errorCode: 'ACCOUNTS_UPDATE_PROFILE_VALIDATION_FAILED' },
      });
    }
  });

  it('judges the age on the day it is handed — 16 today is old enough', () => {
    expect(
      unwrapOk(
        ProfileEditSystem.decide(
          owner(),
          edits({ birthDate: '2010-07-22' }),
          AGE_DAY,
        ),
      )?.birthDate,
    ).toBe('2010-07-22');
    expect(
      ProfileEditSystem.decide(
        owner(),
        edits({ birthDate: '2010-07-23' }),
        AGE_DAY,
      ).ok,
    ).toBe(false);
  });

  it('refuses to create: an absent document is not found', () => {
    expect(
      unwrapErr(
        ProfileEditSystem.decide(null, edits({ firstName: 'Ana' }), AGE_DAY),
      ),
    ).toEqual({ errorCode: 'ACCOUNTS_UPDATE_PROFILE_NOT_FOUND' });
  });

  it('refuses to register: a contact-only PROVISIONED stub is not found', () => {
    const stub = RegistrationSystem.provision(
      UserId.of('uid_1'),
      ParsedIdentifier.phone(E164.of('+359888123456')),
    );
    expect(
      unwrapErr(
        ProfileEditSystem.decide(
          stub,
          edits({ firstName: 'Ana', lastName: 'Ivanova' }),
          AGE_DAY,
        ),
      ),
    ).toEqual({ errorCode: 'ACCOUNTS_UPDATE_PROFILE_NOT_FOUND' });
  });

  it('a blocked owner may still edit — the lifecycle is not the profile rule', () => {
    const blocked = owner(
      AccountLifecycle.block(BlockReason.Manual, utcMs('2026-12-01T00:00:00Z')),
    );
    expect(
      unwrapOk(
        ProfileEditSystem.decide(
          blocked,
          edits({ firstName: 'Georgi' }),
          AGE_DAY,
        ),
      )?.firstName,
    ).toBe('Georgi');
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const stored = deepFreeze(owner());
    const given = deepFreeze(
      edits({ firstName: 'Georgi', birthDate: '1991-02-03' }),
    );
    const once = ProfileEditSystem.decide(stored, given, AGE_DAY);
    expect(ProfileEditSystem.decide(stored, given, AGE_DAY)).toEqual(once);
    expect(stored).toEqual(owner());
    expect(given).toEqual(
      edits({ firstName: 'Georgi', birthDate: '1991-02-03' }),
    );
  });
});

describe('ProfileEditSystem.registrationProfile — the registered aggregate (user.spec.ts)', () => {
  it('accepts fully valid props', () => {
    expect(
      ProfileEditSystem.registrationProfile(settlement(), AGE_DAY),
    ).toEqual({
      ok: true,
      value: {
        firstName: 'Ivo',
        lastName: 'Petrov',
        phone: '+359885550100',
        email: 'client@example.com',
        birthDate: '2000-01-01',
        roles: ['client'],
      },
    });
  });

  it('allows omitting the optional email and birth date', () => {
    const profile = unwrapOk(
      ProfileEditSystem.registrationProfile(
        settlement({ email: null, birthDate: null, roles: [Role.Barber] }),
        AGE_DAY,
      ),
    );
    expect(profile.email).toBeNull();
    expect(profile.birthDate).toBeNull();
    expect(profile.roles).toEqual(['barber']);
    // A blank e-mail is no e-mail, as `props.email ? … : null` read it.
    expect(
      unwrapOk(
        ProfileEditSystem.registrationProfile(
          settlement({ email: '' }),
          AGE_DAY,
        ),
      ).email,
    ).toBeNull();
  });

  it('rejects an invalid phone number', () => {
    const errors = unwrapErr(
      ProfileEditSystem.registrationProfile(
        settlement({ phone: 'not-a-phone' }),
        AGE_DAY,
      ),
    );
    expect(errors.map((e) => e.errorCode)).toEqual(['PHONE_INVALID']);
    // No default country: a national-format number is not an E.164 one.
    expect(
      ProfileEditSystem.registrationProfile(
        settlement({ phone: '0885550100' }),
        AGE_DAY,
      ).ok,
    ).toBe(false);
  });

  it('rejects a first name below the minimum length', () => {
    expect(
      unwrapErr(
        ProfileEditSystem.registrationProfile(
          settlement({ firstName: 'I' }),
          AGE_DAY,
        ),
      ),
    ).toEqual([
      {
        errorCode: 'ACCOUNTS_FIRST_NAME_TOO_SHORT',
        attempted: 'I',
        minLength: 2,
      },
    ]);
  });

  it('rejects a last name below the minimum length', () => {
    expect(
      unwrapErr(
        ProfileEditSystem.registrationProfile(
          settlement({ lastName: 'P' }),
          AGE_DAY,
        ),
      ),
    ).toEqual([
      {
        errorCode: 'ACCOUNTS_LAST_NAME_TOO_SHORT',
        attempted: 'P',
        minLength: 2,
      },
    ]);
  });

  it('rejects a malformed email when provided', () => {
    expect(
      unwrapErr(
        ProfileEditSystem.registrationProfile(
          settlement({ email: 'not-an-email' }),
          AGE_DAY,
        ),
      ),
    ).toEqual([
      { errorCode: 'ACCOUNTS_EMAIL_INVALID', attempted: 'not-an-email' },
    ]);
  });

  it('rejects an unknown role', () => {
    const errors = unwrapErr(
      ProfileEditSystem.registrationProfile(
        settlement({ roles: ['not-a-role' as Role] }),
        AGE_DAY,
      ),
    );
    expect(errors).toEqual([
      { errorCode: 'ACCOUNTS_USER_ROLE_INVALID', attempted: 'not-a-role' },
    ]);
  });

  it('rejects an empty roles list', () => {
    expect(
      unwrapErr(
        ProfileEditSystem.registrationProfile(
          settlement({ roles: [] }),
          AGE_DAY,
        ),
      ),
    ).toEqual([{ errorCode: 'ACCOUNTS_USER_ROLES_EMPTY' }]);
  });

  it('rejects a birth date implying an age below 16', () => {
    expect(
      unwrapErr(
        ProfileEditSystem.registrationProfile(
          settlement({ birthDate: BirthDate.of('2020-01-01') }),
          AGE_DAY,
        ),
      ),
    ).toEqual([
      { errorCode: 'IDENTITY_BIRTH_DATE_TOO_YOUNG', age: 6, minAge: 16 },
    ]);
    // A stored date past 120 years refuses as too old.
    expect(
      unwrapErr(
        ProfileEditSystem.registrationProfile(
          settlement({ birthDate: BirthDate.of('1900-01-01') }),
          AGE_DAY,
        ),
      ).map((e) => e.errorCode),
    ).toEqual(['IDENTITY_BIRTH_DATE_TOO_OLD']);
  });

  it('collects multiple field errors at once, in today’s order: phone, first name, last name, e-mail, roles, birth date', () => {
    const errors = unwrapErr(
      ProfileEditSystem.registrationProfile(
        {
          firstName: 'I',
          lastName: 'P',
          phone: 'not-a-phone',
          email: 'nope',
          birthDate: BirthDate.of('2020-01-01'),
          roles: [],
        },
        AGE_DAY,
      ),
    );
    expect(errors.map((e) => e.errorCode)).toEqual([
      'PHONE_INVALID',
      'ACCOUNTS_FIRST_NAME_TOO_SHORT',
      'ACCOUNTS_LAST_NAME_TOO_SHORT',
      'ACCOUNTS_EMAIL_INVALID',
      'ACCOUNTS_USER_ROLES_EMPTY',
      'IDENTITY_BIRTH_DATE_TOO_YOUNG',
    ]);
  });

  it('normalises: a spaced phone becomes its E.164, a mixed-case e-mail its lower case, names trimmed', () => {
    const profile = unwrapOk(
      ProfileEditSystem.registrationProfile(
        settlement({
          firstName: ' Ivo ',
          lastName: ' Petrov',
          phone: '+359 888 123 456',
          email: '  Client@Example.COM ',
        }),
        AGE_DAY,
      ),
    );
    expect(profile).toMatchObject({
      firstName: 'Ivo',
      lastName: 'Petrov',
      phone: '+359888123456',
      email: 'client@example.com',
    });
  });

  it('stub → registered changes exactly the names (+ birth date and e-mail when given), never the phone', () => {
    const uid = UserId.of('uid_1');
    const stub = RegistrationSystem.provision(
      uid,
      ParsedIdentifier.phone(E164.of('+359888123456')),
    );
    // The login phone as typed — spaced — settles to the stub's own E.164.
    const namesOnly = unwrapOk(
      ProfileEditSystem.registrationProfile(
        settlement({
          phone: '+359 888 123 456',
          email: null,
          birthDate: null,
        }),
        AGE_DAY,
      ),
    );
    expect(
      AuditSystem.changedProfileFields(
        stub,
        RegistrationSystem.register(stub, namesOnly),
      ),
    ).toEqual(['firstName', 'lastName']);
    const everything = unwrapOk(
      ProfileEditSystem.registrationProfile(
        settlement({ phone: '+359 888 123 456' }),
        AGE_DAY,
      ),
    );
    expect(
      AuditSystem.changedProfileFields(
        stub,
        RegistrationSystem.register(stub, everything),
      ),
    ).toEqual(['firstName', 'lastName', 'email', 'birthDate']);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const given = deepFreeze(settlement({ phone: '+359 888 123 456' }));
    const once = ProfileEditSystem.registrationProfile(given, AGE_DAY);
    expect(ProfileEditSystem.registrationProfile(given, AGE_DAY)).toEqual(once);
    expect(given).toEqual(settlement({ phone: '+359 888 123 456' }));
  });
});
