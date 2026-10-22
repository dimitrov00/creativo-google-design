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
import { fixtureHash, unwrapErr, unwrapOk } from '@core/testing';
import * as Ids from './ids.primitive';
import {
  AppointmentId,
  AuditResourceId,
  BookingPolicySettingsId,
  CartLineId,
  ClientMoneyStatsId,
  ClientOperationId,
  GuestKey,
  CustomerId,
  JournalEntryId,
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
 * The guards of `libs/application/booking/.../booking-gateway.port.spec.ts`
 * (`isClientOperationId`, `isGuestKey`; deleted in 4b), ported onto the two
 * primitives (Phase 4a 4A-12).
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
