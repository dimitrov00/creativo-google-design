import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BackfillJobName, Party, SeatKey } from '@core/components';
import {
  RecomputeJobName,
  BOOKING_POLICY_DOC,
  CLIENT_MONEY_DOC,
  Collections,
  POLICY_RECOMPUTE_DOC,
} from '@core/entities';
import { VisitDraftSystem } from '@core/systems';
import {
  deepFreeze,
  fixtureHash,
  fixtureKeyedHash,
  fixtureWalkInHash,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import * as Ids from './ids.primitive';
import {
  AppointmentId,
  AuditResourceId,
  BookingPolicySettingsId,
  CartLineId,
  ClientMoneyStatsId,
  ClientOperationId,
  OperationId,
  DraftPersonKey,
  GuestKey,
  CustomerId,
  ImpersonationSessionId,
  JournalEntryId,
  LocationId,
  OtpId,
  PolicyRecomputeJobId,
  SeatKeyText,
  StreakDefinitionId,
  StreakDefinitionVersionId,
  TenantId,
  UserId,
} from './ids.primitive';

/** A companion's unchecked door, as the runtime case reads it. */
type IdOf = { readonly of: (raw: string) => string };

/** Every id companion with both doors (`of` and `parse`), by export name. */
const ID_COMPANIONS: readonly (readonly [string, IdOf])[] = Object.entries(
  Ids as Record<string, unknown>,
).flatMap(([name, companion]) =>
  typeof companion === 'object' &&
  companion !== null &&
  'of' in companion &&
  'parse' in companion
    ? [[name, companion as IdOf] as const]
    : [],
);

/*
 * The successor of `entities/entity-ids.spec.ts` and
 * `components/tenant-id.data.spec.ts` (flatten-spec §1.5): the runtime side
 * of the id family. The nominal side is `ids.type-spec.ts`.
 */
describe('the id companions (decision F-3)', () => {
  it('parse takes a non-empty id without a slash, kept exactly as given', () => {
    expect(AppointmentId.parse('apt_1')).toEqual({ ok: true, value: 'apt_1' });
    expect(TenantId.parse(' creativo ')).toEqual({
      ok: true,
      value: ' creativo ',
    });
  });

  it('parse refuses a blank id and a path separator as flat PrimitiveErrors', () => {
    expect(unwrapErr(UserId.parse(''))).toEqual({
      errorCode: 'PRIMITIVE_ID_EMPTY',
      raw: '',
      brand: 'UserId',
    });
    expect(unwrapErr(UserId.parse('   ')).errorCode).toBe('PRIMITIVE_ID_EMPTY');
    expect(unwrapErr(AppointmentId.parse('a/b'))).toEqual({
      errorCode: 'PRIMITIVE_ID_HAS_SLASH',
      raw: 'a/b',
      brand: 'AppointmentId',
    });
  });

  it('parse refuses the names Firestore reserves — `.`, `..`, `__…__` — as PRIMITIVE_ID_RESERVED (OR-44)', () => {
    for (const raw of ['.', '..', '____', '__x__', '__reserved__', '__/__x']) {
      const refused = unwrapErr(LocationId.parse(raw));
      // A slash is the slash refusal first; the reserved rule reads the rest.
      expect(refused, raw).toEqual({
        errorCode: raw.includes('/')
          ? 'PRIMITIVE_ID_HAS_SLASH'
          : 'PRIMITIVE_ID_RESERVED',
        raw,
        brand: 'LocationId',
      });
    }
  });

  it('keeps every near miss of a reserved name a plain id — length-gated, exact', () => {
    for (const raw of [
      '_',
      '__',
      '___',
      'a__b',
      '__a',
      'a__',
      '__a_',
      '_a__',
      '...',
      '. ',
      ' .',
      '.a',
      'a.',
      ' __x__',
      '__x__ ',
      'loc-center',
    ]) {
      expect(unwrapOk(LocationId.parse(raw)), JSON.stringify(raw)).toBe(raw);
      expect(LocationId.is(raw), JSON.stringify(raw)).toBe(true);
    }
  });

  it('of takes a value that is an id by construction, unchecked', () => {
    expect(AppointmentId.of('apt_1')).toBe('apt_1');
  });

  it('TenantId.equals compares the text', () => {
    expect(TenantId.equals(TenantId.of('a'), TenantId.of('a'))).toBe(true);
    expect(TenantId.equals(TenantId.of('a'), TenantId.of('b'))).toBe(false);
  });

  it.each(ID_COMPANIONS)(
    '%s.of is the identity on the raw string (the brand is type-only)',
    (_name, companion) => {
      expect(companion.of('raw-id-1')).toBe('raw-id-1');
      expect(typeof companion.of('')).toBe('string');
    },
  );

  it('covers the whole id family', () => {
    // 35 entity ids before the pass, plus the component and system ids F0
    // moved here (flatten-spec §1.5).
    expect(ID_COMPANIONS.length).toBeGreaterThanOrEqual(35);
    expect(ID_COMPANIONS.map(([name]) => name)).toEqual(
      expect.arrayContaining(['BadgeSeriesId', 'LocationId', 'UserId']),
    );
  });

  it('keeps the fixed document ids (stable path keys, OQ-9)', () => {
    expect(BookingPolicySettingsId.FIXED).toBe('bookingPolicy');
    expect(BOOKING_POLICY_DOC).toBe(BookingPolicySettingsId.FIXED);
    expect(ClientMoneyStatsId.FIXED).toBe('money');
    expect(CLIENT_MONEY_DOC).toBe(ClientMoneyStatsId.FIXED);
    expect(PolicyRecomputeJobId.FIXED).toBe('clientStatsPolicy');
    expect(POLICY_RECOMPUTE_DOC).toBe(PolicyRecomputeJobId.FIXED);
  });

  it('the policy pass lives beside the backfill jobs under its own tag', () => {
    expect(Object.values(BackfillJobName)).not.toContain(
      RecomputeJobName.ClientStatsPolicy,
    );
    expect(Object.values(BackfillJobName)).toEqual([
      'SUBJECT_MIRROR',
      'CLIENT_STATS',
    ]);
  });

  it('builds the derived ids byte-identical to today', () => {
    expect(StreakDefinitionVersionId.forVersion(7)).toBe('000007');
    expect(
      JournalEntryId.forEntry(CustomerId.of('cus_0123456789abcdef0123'), 3),
    ).toBe('cus_0123456789abcdef0123_000003');
    expect(CartLineId.forSequence(4)).toBe('line-4');
  });

  it('keys a journal entry by the client RECORD an account holder derives (D29)', () => {
    const customerId = CustomerId.forUser(UserId.of('u_42'), fixtureHash);
    expect(JournalEntryId.forEntry(customerId, 7)).toBe(`${customerId}_000007`);
    // The record's id, never the account's uid, leads the entry id.
    expect(JournalEntryId.forEntry(customerId, 7).startsWith('u_42')).toBe(
      false,
    );
  });
});

describe('CustomerId (D29) — never a UserId', () => {
  it('forUser is deterministic: cus_ + 20 hex of hash(customer/v1:uid)', () => {
    const id = CustomerId.forUser(UserId.of('u_42'), fixtureHash);
    expect(id).toBe(`cus_${fixtureHash('customer/v1:u_42').slice(0, 20)}`);
    expect(id).toMatch(/^cus_[0-9a-f]{20}$/);
    expect(CustomerId.forUser(UserId.of('u_42'), fixtureHash)).toBe(id);
    expect(CustomerId.forUser(UserId.of('u_43'), fixtureHash)).not.toBe(id);
    // The record id is never the uid it was derived from.
    expect(id).not.toBe('u_42');
  });

  it('forWalkIn is deterministic: cus_ + 20 hex of keyedHash(walkin/v1:contactKey) — one contact, one record (OR-26)', () => {
    const id = CustomerId.forWalkIn('+359888123456', fixtureWalkInHash);
    expect(id).toBe(
      `cus_${fixtureWalkInHash('walkin/v1:+359888123456').slice(0, 20)}`,
    );
    expect(id).toMatch(/^cus_[0-9a-f]{20}$/);
    // The same number twice is the same record; another number another one.
    expect(CustomerId.forWalkIn('+359888123456', fixtureWalkInHash)).toBe(id);
    expect(CustomerId.forWalkIn('+359888123457', fixtureWalkInHash)).not.toBe(
      id,
    );
    expect(
      CustomerId.forWalkIn('maria@example.com', fixtureWalkInHash),
    ).not.toBe(id);
    expect(CustomerId.is(id)).toBe(true);
  });

  it('forWalkIn is KEYED: two keys, two ids for one contact — nobody without the key recomputes it', () => {
    const contact = '+359888123456';
    const one = CustomerId.forWalkIn(contact, fixtureKeyedHash('key-one'));
    const two = CustomerId.forWalkIn(contact, fixtureKeyedHash('key-two'));
    expect(one).not.toBe(two);
    // One key keeps one id — the dedupe and the retry idempotency hold.
    expect(CustomerId.forWalkIn(contact, fixtureKeyedHash('key-one'))).toBe(
      one,
    );
    // And neither is the unkeyed digest of the contact.
    expect(one).not.toBe(CustomerId.forWalkIn(contact, fixtureHash));
  });

  it('forWalkIn and forUser never meet — each id family has its own namespace', () => {
    const key = 'u_42';
    // Even under one and the same digest, the namespace keeps them apart.
    expect(CustomerId.forWalkIn(key, fixtureHash)).not.toBe(
      CustomerId.forUser(UserId.of(key), fixtureHash),
    );
    expect(CustomerId.forWalkIn(key, fixtureWalkInHash)).not.toBe(
      CustomerId.forUser(UserId.of(key), fixtureHash),
    );
  });
});

describe('AuditResourceId — the one id that may hold a slash', () => {
  it('spells the three writers’ forms', () => {
    expect(AuditResourceId.forAppointment(AppointmentId.of('apt_1'))).toBe(
      'apt_1',
    );
    expect(AuditResourceId.forUser(UserId.of('u_42'))).toBe('users/u_42');
    expect(
      AuditResourceId.forStreakDefinition(StreakDefinitionId.of('rhythm')),
    ).toBe(`${Collections.StreakDefinitions}/rhythm`);
  });

  it('names an impersonation session by its collection path (audit-hardening WS-3)', () => {
    const resource = AuditResourceId.forImpersonationSession(
      ImpersonationSessionId.of('imp_7'),
    );
    expect(resource).toBe(`${Collections.ImpersonationSessions}/imp_7`);
    expect(unwrapOk(AuditResourceId.parse(resource))).toBe(resource);
  });

  it('names a sign-in challenge by its collection path — the restated name is the registry’s (Phase 3 WS-B)', () => {
    const resource = AuditResourceId.forOtp(OtpId.of('otp_3'));
    expect(resource).toBe(`${Collections.Otps}/otp_3`);
    expect(resource).toBe('otps/otp_3');
    expect(unwrapOk(AuditResourceId.parse(resource))).toBe(resource);
  });

  it('names a client record by its collection path — the restated name is the registry’s (Phase 3 WS-C)', () => {
    const record = CustomerId.forUser(UserId.of('u_42'), fixtureHash);
    const resource = AuditResourceId.forCustomer(record);
    expect(resource).toBe(`${Collections.Customers}/${record}`);
    expect(resource).toBe(`customers/${record}`);
    expect(unwrapOk(AuditResourceId.parse(resource))).toBe(resource);
    // A record's row never reads as the account's: two spellings, two resources.
    expect(resource).not.toBe(AuditResourceId.forUser(UserId.of('u_42')));
  });

  it('parse takes at most one slash', () => {
    expect(unwrapOk(AuditResourceId.parse('users/u_42'))).toBe('users/u_42');
    expect(unwrapOk(AuditResourceId.parse('apt_1'))).toBe('apt_1');
    for (const raw of ['', ' ', 'a/b/c']) {
      expect(unwrapErr(AuditResourceId.parse(raw))).toEqual({
        errorCode: 'PRIMITIVE_AUDIT_RESOURCE_ID_INVALID',
        raw,
        brand: 'AuditResourceId',
      });
    }
  });
});

describe('DraftPersonKey — a person’s key in a staff sheet’s draft (pass D, D-5)', () => {
  it('spells every key byte-identically to the sheet', () => {
    expect(DraftPersonKey.PLACEHOLDER).toBe('primary');
    expect(DraftPersonKey.account(UserId.of('u-martin'))).toBe('u-martin');
    expect(DraftPersonKey.guest('Мария')).toBe('guest-Мария');
    expect(DraftPersonKey.guest('Случаен клиент')).toBe('guest-Случаен клиент');
    expect(DraftPersonKey.minted('mfx1a2', 0)).toBe('guest-mfx1a2-0');
    expect(DraftPersonKey.minted('mfx1a2', 12)).toBe('guest-mfx1a2-12');
    expect(DraftPersonKey.of('u-anna')).toBe('u-anna');
  });

  it('parses exactly the three spellings the sheet mints, byte for byte', () => {
    for (const raw of [
      'primary',
      'guest-Мария',
      'guest-Случаен клиент',
      'guest-mfx1a2-0',
      'guest-А/Б',
      'u-martin',
      'dev-staff-ivan',
      'guest-',
    ]) {
      expect(unwrapOk(DraftPersonKey.parse(raw))).toBe(raw);
    }
    expect(unwrapOk(DraftPersonKey.parse('guest-Мария'))).toBe(
      DraftPersonKey.guest('Мария'),
    );
    expect(unwrapOk(DraftPersonKey.parse('guest-mfx1a2-12'))).toBe(
      DraftPersonKey.minted('mfx1a2', 12),
    );
    expect(unwrapOk(DraftPersonKey.parse('u-anna'))).toBe(
      DraftPersonKey.account(UserId.of('u-anna')),
    );
  });

  it('refuses an account key that is a reserved name, named for this brand', () => {
    expect(unwrapErr(DraftPersonKey.parse('..'))).toEqual({
      errorCode: 'PRIMITIVE_ID_RESERVED',
      raw: '..',
      brand: 'DraftPersonKey',
    });
    expect(DraftPersonKey.accountOf(DraftPersonKey.of('__x__'))).toBeNull();
  });

  it('refuses a blank key and one that would name a nested document', () => {
    expect(unwrapErr(DraftPersonKey.parse(''))).toEqual({
      errorCode: 'PRIMITIVE_ID_EMPTY',
      raw: '',
      brand: 'DraftPersonKey',
    });
    expect(unwrapErr(DraftPersonKey.parse('   ')).errorCode).toBe(
      'PRIMITIVE_ID_EMPTY',
    );
    expect(unwrapErr(DraftPersonKey.parse('users/u-1'))).toEqual({
      errorCode: 'PRIMITIVE_ID_HAS_SLASH',
      raw: 'users/u-1',
      brand: 'DraftPersonKey',
    });
  });

  it('is pinned to the spellings VisitDraftSystem keys a draft on', () => {
    // The stranger keys' prefix is `DraftPersonKey`'s own spelling now
    // (`VisitDraftSystem.GUEST_KEY_PREFIX` retired, pass D); the placeholder
    // is still the system's constant.
    expect(DraftPersonKey.PLACEHOLDER).toBe(
      VisitDraftSystem.PLACEHOLDER_CLIENT_ID,
    );
    expect(DraftPersonKey.guest('x').startsWith('guest-')).toBe(true);
    expect(DraftPersonKey.minted('m', 1).startsWith('guest-')).toBe(true);
  });

  // `accountOf` — the cases of `visit-draft.system.spec.ts`'s `accountKeyOf`
  // block, case for case.
  it('the placeholder is nobody’s account', () => {
    expect(DraftPersonKey.accountOf(DraftPersonKey.PLACEHOLDER)).toBeNull();
    expect(DraftPersonKey.accountOf(DraftPersonKey.of('primary'))).toBeNull();
  });

  it('a stranger’s guest key is nobody’s account — a walk-in or a minted one', () => {
    expect(
      DraftPersonKey.accountOf(DraftPersonKey.of('guest-Случаен клиент')),
    ).toBeNull();
    expect(
      DraftPersonKey.accountOf(DraftPersonKey.of('guest-mfx1a2-0')),
    ).toBeNull();
    expect(
      DraftPersonKey.accountOf(DraftPersonKey.guest('Случаен клиент')),
    ).toBeNull();
    expect(
      DraftPersonKey.accountOf(DraftPersonKey.minted('mfx1a2', 0)),
    ).toBeNull();
  });

  it('every other key is the account’s uid, as the brand', () => {
    expect(DraftPersonKey.accountOf(DraftPersonKey.of('u-martin'))).toBe(
      UserId.of('u-martin'),
    );
    expect(DraftPersonKey.accountOf(DraftPersonKey.of('dev-staff-ivan'))).toBe(
      'dev-staff-ivan',
    );
    expect(
      DraftPersonKey.accountOf(DraftPersonKey.account(UserId.of('u-anna'))),
    ).toBe('u-anna');
  });

  it('a key the uid’s constructor refuses is no account', () => {
    expect(DraftPersonKey.accountOf(DraftPersonKey.of(''))).toBeNull();
    expect(DraftPersonKey.accountOf(DraftPersonKey.of('   '))).toBeNull();
    expect(DraftPersonKey.accountOf(DraftPersonKey.of('users/u-1'))).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const keys = deepFreeze(['u-anna', 'guest-Мария', 'primary']);
    const once = keys.map((raw) =>
      DraftPersonKey.accountOf(DraftPersonKey.of(raw)),
    );
    const twice = keys.map((raw) =>
      DraftPersonKey.accountOf(DraftPersonKey.of(raw)),
    );
    expect(twice).toEqual(once);
    expect(keys).toEqual(['u-anna', 'guest-Мария', 'primary']);
    expect(DraftPersonKey.guest('Мария')).toBe(DraftPersonKey.guest('Мария'));
    expect(DraftPersonKey.minted('a', 1)).toBe(DraftPersonKey.minted('a', 1));
    expect(DraftPersonKey.account(UserId.of('u'))).toBe(
      DraftPersonKey.account(UserId.of('u')),
    );
  });
});

describe('SeatKeyText — the text of a cart seat key', () => {
  it('parse takes a non-empty key; of is unchecked', () => {
    expect(unwrapOk(SeatKeyText.parse('guest-1'))).toBe('guest-1');
    expect(unwrapErr(SeatKeyText.parse(''))).toEqual({
      errorCode: 'PRIMITIVE_SEAT_KEY_TEXT_EMPTY',
      raw: '',
      brand: 'SeatKeyText',
    });
    expect(SeatKeyText.of('self')).toBe('self');
  });
});

/*
 * The guards of the legacy booking application lib's
 * `booking-gateway.port.spec.ts` (`isClientOperationId`, `isGuestKey`; deleted
 * in Phase 4b, ledger `docs/architecture/flips/phase-4b-delete.md` §11.1),
 * ported onto the two primitives (Phase 4a 4A-12).
 */
describe('ClientOperationId — a client-minted idempotency key', () => {
  it('takes a UUID and any 16–64 character id-shaped string', () => {
    for (const raw of [
      '6f1c2a9e-5b3d-4e7a-9c11-0a2b3c4d5e6f',
      'a'.repeat(16),
      'A_b-1'.repeat(12) + 'abcd',
    ]) {
      expect(unwrapOk(ClientOperationId.parse(raw))).toBe(raw);
      expect(ClientOperationId.is(raw)).toBe(true);
    }
  });

  it('turns away anything shorter, longer, or outside the charset', () => {
    for (const raw of [
      '',
      'a'.repeat(15),
      'a'.repeat(65),
      'attempt 1234567890',
      'a/b'.repeat(8),
    ]) {
      expect(unwrapErr(ClientOperationId.parse(raw))).toEqual({
        errorCode: 'PRIMITIVE_CLIENT_OPERATION_ID_INVALID',
        raw,
        brand: 'ClientOperationId',
      });
      expect(ClientOperationId.is(raw)).toBe(false);
    }
    expect(ClientOperationId.is(1234567890123456)).toBe(false);
    expect(ClientOperationId.is(null)).toBe(false);
  });

  describe('inPayload — the id a payload carries under a field (WS-4.1)', () => {
    const id = '6f1c2a9e-5b3d-4e7a-9c11-0a2b3c4d5e6f';

    it('reads a well-shaped id from the named own field', () => {
      expect(
        ClientOperationId.inPayload({ operationId: id }, 'operationId'),
      ).toBe(id);
      expect(
        ClientOperationId.inPayload(
          { appointmentId: 'apt-1', attemptId: id },
          'attemptId',
        ),
      ).toBe(id);
    });

    it('is null for an absent, mistyped or misshapen id — never the raw value', () => {
      for (const payload of [
        {},
        { operationId: null },
        { operationId: 1234567890123456 },
        { operationId: '' },
        { operationId: 'a'.repeat(15) },
        { operationId: 'a'.repeat(65) },
        { operationId: 'a/b'.repeat(8) },
        { attemptId: id },
      ]) {
        expect(ClientOperationId.inPayload(payload, 'operationId')).toBeNull();
      }
    });

    it('judges the shape only — a reserved `__x__` name is `OperationId.parse`’s to refuse', () => {
      const reserved = '__operation_id__';
      expect(
        ClientOperationId.inPayload({ operationId: reserved }, 'operationId'),
      ).toBe(reserved);
      expect(OperationId.parse(reserved).ok).toBe(false);
    });

    it('is null when the payload is no record', () => {
      for (const payload of [null, undefined, id, 42, [id], true]) {
        expect(ClientOperationId.inPayload(payload, 'operationId')).toBeNull();
      }
    });

    it('reads an own property only — an inherited id is none the caller sent', () => {
      const inherited = Object.create({ operationId: id }) as object;
      expect(ClientOperationId.inPayload(inherited, 'operationId')).toBeNull();
    });

    it('is pure: same input → same output, the payload untouched', () => {
      const payload = Object.freeze({ operationId: id, extra: 'x' });
      expect(ClientOperationId.inPayload(payload, 'operationId')).toBe(
        ClientOperationId.inPayload(payload, 'operationId'),
      );
      expect(payload).toEqual({ operationId: id, extra: 'x' });
    });
  });
});

describe('GuestKey — the guest key on the wire', () => {
  it('holds every key the cart mints for a guest (property)', () => {
    // The client sends the seat key text as `guestKey`; the server keeps only
    // what `GuestKey` accepts. A key the cart can mint and the server drops
    // would switch the duplicate-guest refusal off for that party.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (guests) => {
        let party = Party.anonymous();
        for (let i = 0; i < guests; i++) {
          const added = Party.addGuest(party, `Гост ${i + 1}`);
          if (!added.ok) return false;
          party = added.value;
        }
        return Party.seatKeys(party).every((key) =>
          GuestKey.is(SeatKey.text(key)),
        );
      }),
    );
  });

  it('turns away anything that is not a bounded, id-shaped string', () => {
    expect(GuestKey.is('guest-3')).toBe(true);
    expect(unwrapOk(GuestKey.parse('guest-3'))).toBe('guest-3');
    expect(GuestKey.is('')).toBe(false);
    expect(GuestKey.is('guest 3')).toBe(false);
    expect(GuestKey.is('guest/3')).toBe(false);
    expect(GuestKey.is('g'.repeat(65))).toBe(false);
    expect(GuestKey.is(3)).toBe(false);
    expect(GuestKey.is(null)).toBe(false);
    expect(GuestKey.is({ key: 'guest-3' })).toBe(false);
    expect(unwrapErr(GuestKey.parse('guest 3'))).toEqual({
      errorCode: 'PRIMITIVE_GUEST_KEY_INVALID',
      raw: 'guest 3',
      brand: 'GuestKey',
    });
  });
});

describe('the id doors is and isSpan — read-time, allocation-free (edge hardening D-1)', () => {
  /** A plain id companion's three doors, as the runtime case reads them. */
  type IdDoors = {
    readonly parse: (raw: string) => { readonly ok: boolean };
    readonly is: (raw: unknown) => boolean;
    readonly isSpan: (text: string, start: number, end: number) => boolean;
  };

  /** Every plain id companion (built by `idCompanion`): the ones with `isSpan`. */
  const PLAIN_IDS: readonly (readonly [string, IdDoors])[] = Object.entries(
    Ids as Record<string, unknown>,
  ).flatMap(([name, companion]) =>
    typeof companion === 'object' &&
    companion !== null &&
    'isSpan' in companion &&
    'is' in companion &&
    'parse' in companion
      ? [[name, companion as IdDoors] as const]
      : [],
  );

  it('every plain id companion has the doors — CustomerId’s spread included', () => {
    expect(PLAIN_IDS.length).toBeGreaterThanOrEqual(35);
    expect(PLAIN_IDS.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'AppointmentId',
        'BarberId',
        'CustomerId',
        'LocationId',
        'SeatId',
        'TenantId',
        'UserId',
      ]),
    );
  });

  it.each(PLAIN_IDS)(
    '%s.is ⇔ parse over strings: valid, blank, padded, slashed',
    (_name, ids) => {
      for (const raw of [
        'apt_1',
        'a',
        ' creativo ',
        '',
        ' ',
        '   ',
        '\t\n',
        'a/b',
        '/',
        'cus_3f9a',
        'Мария',
        '.',
        '..',
        '...',
        '__',
        '___',
        '____',
        '__x__',
        'a__b',
      ]) {
        expect(ids.is(raw), JSON.stringify(raw)).toBe(ids.parse(raw).ok);
      }
    },
  );

  it('is ⇔ parse for every single code unit — the trim set read exactly, without trim()', () => {
    for (let code = 0; code <= 0xffff; code++) {
      const raw = String.fromCharCode(code);
      if (UserId.is(raw) !== UserId.parse(raw).ok) {
        expect.unreachable(`U+${code.toString(16)} answers differently`);
      }
    }
  });

  it('is ⇔ parse for arbitrary strings (property)', () => {
    fc.assert(
      fc.property(
        fc.string({
          unit: fc.constantFrom('a', ' ', ' ', ' ', '/', '﻿', '.', '_'),
        }),
        (raw) => AppointmentId.is(raw) === AppointmentId.parse(raw).ok,
      ),
    );
  });

  it('is answers false for every other type — parse is never handed one', () => {
    for (const raw of [null, undefined, 1, {}, [], ['a'], true]) {
      expect(AppointmentId.is(raw)).toBe(false);
      expect(CustomerId.is(raw)).toBe(false);
    }
  });

  it('isSpan reads the part of a composite key in place, clamped to the text', () => {
    expect(UserId.isSpan('b-ivan__2026-09-28', 0, 6)).toBe(true);
    expect(UserId.isSpan('  __2026-09-28', 0, 2)).toBe(false);
    expect(UserId.isSpan('a/b__2026-09-28', 0, 3)).toBe(false);
    expect(UserId.isSpan('abc', 1, 1)).toBe(false);
    expect(UserId.isSpan('abc', -5, 99)).toBe(true);
    // The reserved rule reads the span alone, never the text around it.
    expect(UserId.isSpan('..__2026-09-28', 0, 2)).toBe(false);
    expect(UserId.isSpan('x..__2026-09-28', 0, 3)).toBe(true);
    expect(UserId.isSpan('__a____2026-09-28', 0, 5)).toBe(false);
    expect(UserId.isSpan('__a____2026-09-28', 0, 4)).toBe(true);
    expect(UserId.isSpan('a.b', 1, 2)).toBe(false);
  });

  it('is pure: same input → same answer', () => {
    expect(UserId.is('u-1')).toBe(UserId.is('u-1'));
    expect(UserId.isSpan('u-1', 0, 3)).toBe(UserId.isSpan('u-1', 0, 3));
  });
});
