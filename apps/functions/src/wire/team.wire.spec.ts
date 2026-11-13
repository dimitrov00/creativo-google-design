import type { CallableRequest } from 'firebase-functions/v2/https';
import { TeamErrorCode } from '@core/errors';
import {
  decodeActivateBarber,
  decodeAddBarber,
  decodeDeleteDraftBarber,
  decodeEditBarber,
} from './team.wire';

/*
 * The team callables' wire (team onboarding D5, D9, D10): the token gate
 * before the payload, every field re-read through its smart constructor or
 * guard, the first unreadable one named, the act's name required.
 */

function callable(
  data: unknown,
  roles: readonly unknown[] | null = ['admin'],
): CallableRequest<unknown> {
  return {
    data,
    ...(roles === null ? {} : { auth: { uid: 'u-owner', token: { roles } } }),
  } as unknown as CallableRequest<unknown>;
}

const OP = 'operation-0123456789ab';
const CALLER = { callerUserId: 'u-owner', callerRoles: ['admin'] };

/** The refusal of a decode: its code, and the field it names (or `null`). */
function refusalOf(decoded: {
  readonly ok: boolean;
  readonly error?: { readonly errorCode: string; readonly field?: string };
}): readonly [string, string | null] | null {
  return decoded.ok || decoded.error === undefined
    ? null
    : [decoded.error.errorCode, decoded.error.field ?? null];
}
const INVALID = (field: string) => [TeamErrorCode.InvalidInput, field];

describe('decodeAddBarber', () => {
  const sent = {
    name: { bg: 'Иван', en: null },
    locationIds: ['loc-center'],
    barberStartsLocalDate: '2026-12-01',
    barberLastWorkingLocalDate: null,
    barberDraftTargetStatus: 'PUBLIC',
    barberJoinsAnyPool: true,
    operationId: OP,
  };

  it('reads the record, the verified caller and the act’s name', () => {
    expect(decodeAddBarber(callable(sent))).toEqual({
      ok: true,
      value: { ...CALLER, ...sent },
    });
  });

  it('reads an absent last day as none, a staff-only target and "every shop"', () => {
    expect(
      decodeAddBarber(
        callable({
          ...sent,
          // JSON drops an `undefined` field: the last day is absent.
          barberLastWorkingLocalDate: undefined,
          locationIds: [],
          barberDraftTargetStatus: 'STAFF_ONLY',
        }),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        barberLastWorkingLocalDate: null,
        locationIds: [],
        barberDraftTargetStatus: 'STAFF_ONLY',
      },
    });
  });

  it('takes the caller off the token, never the payload', () => {
    const decoded = decodeAddBarber(
      callable({
        ...sent,
        callerUserId: 'u-forged',
        callerRoles: ['sysadmin'],
      }),
    );
    expect(decoded).toMatchObject({ ok: true, value: CALLER });
  });

  it('refuses no session, and every token without the admin role — before the payload is read', () => {
    expect(refusalOf(decodeAddBarber(callable(sent, null)))).toEqual([
      TeamErrorCode.Unauthenticated,
      null,
    ]);
    for (const roles of [
      ['content_manager'],
      ['receptionist'],
      ['barber'],
      ['sysadmin'],
      ['client'],
      [],
      // A list inside the list is no role.
      [['admin']],
    ]) {
      // An unreadable payload is still FORBIDDEN first.
      expect(refusalOf(decodeAddBarber(callable({}, roles)))).toEqual([
        TeamErrorCode.Forbidden,
        null,
      ]);
    }
  });

  it.each([
    ['name', { name: 'Иван' }],
    ['name', { name: { en: 'Ivan' } }],
    ['locationIds', { locationIds: 'loc-center' }],
    ['locationIds', { locationIds: [''] }],
    ['locationIds', { locationIds: Array.from({ length: 51 }, () => 'loc') }],
    ['barberStartsLocalDate', { barberStartsLocalDate: '2026-02-30' }],
    ['barberLastWorkingLocalDate', { barberLastWorkingLocalDate: 'soon' }],
    ['barberDraftTargetStatus', { barberDraftTargetStatus: 'DRAFT' }],
    ['barberDraftTargetStatus', { barberDraftTargetStatus: 'DEPARTED' }],
    ['barberJoinsAnyPool', { barberJoinsAnyPool: 'yes' }],
    ['operationId', { operationId: 'short' }],
    ['operationId', { operationId: null }],
  ])('names %s as the unreadable field', (field, change) => {
    expect(
      refusalOf(decodeAddBarber(callable({ ...sent, ...change }))),
    ).toEqual(INVALID(field));
  });

  it('refuses a payload with no shops list at all — "every shop" is said, never assumed', () => {
    expect(
      refusalOf(decodeAddBarber(callable({ ...sent, locationIds: undefined }))),
    ).toEqual(INVALID('locationIds'));
  });
});

describe('decodeEditBarber', () => {
  const named = { barberId: 'b-ivan', operationId: OP };
  const profile = {
    ...named,
    barberEdit: 'PROFILE',
    name: { bg: 'Иван', en: 'Ivan' },
    title: { bg: 'Бръснар', en: null },
    bio: null,
    instagramHandle: '@ivan.cuts',
    yearsExperience: 8,
  };

  it('reads each part whole, beside the verified caller', () => {
    expect(decodeEditBarber(callable(profile))).toEqual({
      ok: true,
      value: { ...CALLER, ...profile },
    });
    for (const part of [
      { barberEdit: 'SHOPS', locationIds: ['loc-center', 'loc-mladost'] },
      {
        barberEdit: 'PERIOD',
        barberStartsLocalDate: '2026-12-01',
        barberLastWorkingLocalDate: '2027-03-31',
      },
      { barberEdit: 'POOL', barberJoinsAnyPool: false },
      { barberEdit: 'ACCESS', barberStatus: 'STAFF_ONLY' },
    ]) {
      expect(decodeEditBarber(callable({ ...named, ...part }))).toEqual({
        ok: true,
        value: { ...CALLER, ...named, ...part },
      });
    }
  });

  it('reads only the named part’s fields — another part’s are dropped', () => {
    const decoded = decodeEditBarber(
      callable({
        ...named,
        barberEdit: 'POOL',
        barberJoinsAnyPool: true,
        barberStatus: 'PUBLIC',
        name: { bg: 'Друг', en: null },
      }),
    );
    expect(decoded.ok && Object.keys(decoded.value).sort()).toEqual([
      'barberEdit',
      'barberId',
      'barberJoinsAnyPool',
      'callerRoles',
      'callerUserId',
      'operationId',
    ]);
  });

  it('reads absent optional profile fields as none', () => {
    expect(
      decodeEditBarber(
        callable({ ...named, barberEdit: 'PROFILE', name: profile.name }),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        title: null,
        bio: null,
        instagramHandle: null,
        yearsExperience: null,
      },
    });
  });

  it('lets any staff token ask for a profile — the pipeline judges the stored account', () => {
    for (const roles of [['content_manager'], ['barber'], ['receptionist']]) {
      expect(decodeEditBarber(callable(profile, roles))).toMatchObject({
        ok: true,
        value: { callerRoles: roles },
      });
    }
    expect(refusalOf(decodeEditBarber(callable(profile, ['client'])))).toEqual([
      TeamErrorCode.Forbidden,
      null,
    ]);
    expect(refusalOf(decodeEditBarber(callable(profile, null)))).toEqual([
      TeamErrorCode.Unauthenticated,
      null,
    ]);
  });

  it('keeps every other part the admin’s', () => {
    const pool = { ...named, barberEdit: 'POOL', barberJoinsAnyPool: false };
    for (const roles of [
      ['content_manager'],
      ['barber'],
      ['receptionist'],
      ['sysadmin'],
    ]) {
      expect(refusalOf(decodeEditBarber(callable(pool, roles)))).toEqual([
        TeamErrorCode.Forbidden,
        null,
      ]);
    }
  });

  it.each([
    ['barberEdit', { barberEdit: 'EVERYTHING' }],
    ['barberEdit', { barberEdit: undefined }],
    ['barberId', { barberId: '' }],
    ['operationId', { operationId: 'short' }],
    ['name', { name: null }],
    ['title', { title: 'Бръснар' }],
    ['bio', { bio: { bg: 7 } }],
    ['instagramHandle', { instagramHandle: 7 }],
    ['yearsExperience', { yearsExperience: '8' }],
  ])('names %s as the unreadable field of a profile', (field, change) => {
    expect(
      refusalOf(decodeEditBarber(callable({ ...profile, ...change }))),
    ).toEqual(INVALID(field));
  });

  it.each([
    ['locationIds', { barberEdit: 'SHOPS' }],
    ['barberStartsLocalDate', { barberEdit: 'PERIOD' }],
    [
      'barberLastWorkingLocalDate',
      {
        barberEdit: 'PERIOD',
        barberStartsLocalDate: '2026-12-01',
        barberLastWorkingLocalDate: 7,
      },
    ],
    ['barberJoinsAnyPool', { barberEdit: 'POOL' }],
    ['barberStatus', { barberEdit: 'ACCESS', barberStatus: 'DRAFT' }],
  ])('names %s as the unreadable field of its part', (field, part) => {
    expect(
      refusalOf(decodeEditBarber(callable({ ...named, ...part }))),
    ).toEqual(INVALID(field));
  });
});

describe('decodeActivateBarber / decodeDeleteDraftBarber', () => {
  const sent = { barberId: 'b-ivan', operationId: OP };

  it('read the record and the act’s name beside the verified caller', () => {
    expect(decodeActivateBarber(callable(sent))).toEqual({
      ok: true,
      value: { ...CALLER, ...sent },
    });
    expect(decodeDeleteDraftBarber(callable(sent))).toEqual({
      ok: true,
      value: { ...CALLER, ...sent },
    });
  });

  it('the go-live step is any staff token’s; a deletion the admin’s alone', () => {
    for (const roles of [['barber'], ['receptionist'], ['content_manager']]) {
      expect(decodeActivateBarber(callable(sent, roles)).ok).toBe(true);
      expect(refusalOf(decodeDeleteDraftBarber(callable(sent, roles)))).toEqual(
        [TeamErrorCode.Forbidden, null],
      );
    }
    expect(refusalOf(decodeActivateBarber(callable(sent, ['client'])))).toEqual(
      [TeamErrorCode.Forbidden, null],
    );
    for (const decode of [decodeActivateBarber, decodeDeleteDraftBarber]) {
      expect(refusalOf(decode(callable(sent, null)))).toEqual([
        TeamErrorCode.Unauthenticated,
        null,
      ]);
    }
  });

  it.each([
    ['barberId', { barberId: 7 }],
    ['barberId', { barberId: 'a/b' }],
    ['operationId', {}],
    ['operationId', { operationId: 'has spaces in it !!' }],
  ])('name %s as the unreadable field', (field, change) => {
    const data =
      field === 'operationId' && Object.keys(change).length === 0
        ? { barberId: sent.barberId }
        : { ...sent, ...change };
    for (const decode of [decodeActivateBarber, decodeDeleteDraftBarber]) {
      expect(refusalOf(decode(callable(data)))).toEqual(INVALID(field));
    }
  });
});
