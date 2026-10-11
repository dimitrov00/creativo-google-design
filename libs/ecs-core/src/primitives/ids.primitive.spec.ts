import { describe, expect, it } from 'vitest';
import { BackfillJobName } from '../entities/backfill-job.entity';
import { RecomputeJobName } from '../entities/policy-recompute-job.entity';
import {
  BOOKING_POLICY_DOC,
  CLIENT_MONEY_DOC,
  Collections,
  POLICY_RECOMPUTE_DOC,
} from '../ports/collections';
import { fixtureHash, unwrapErr, unwrapOk } from '../testing';
import * as Ids from './ids.primitive';
import {
  AppointmentId,
  AuditResourceId,
  BookingPolicySettingsId,
  CartLineId,
  ClientMoneyStatsId,
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
    expect(JournalEntryId.forEntry(UserId.of('u_42'), 3)).toBe('u_42_000003');
    expect(CartLineId.forSequence(4)).toBe('line-4');
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
