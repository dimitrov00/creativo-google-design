import { describe, expect, it } from 'vitest';
import { deepFreeze, fixtureKeyedHash } from '@core/testing';
import { LogDigestSystem } from './log-digest.system';

/* The log digest's basis (audit-hardening WS-4.2, RU-23): an ALLOWLIST —
 * contact values, labels, codes and free-text reasons never reach it (R36 /
 * T5). The keyed hash is a parameter; here a transparent stand-in that
 * shows exactly what it was handed. */

const PHONE = '+359888777666';
const EMAIL = 'sentinel.contact@example.test';
const LABEL = 'SENTINEL-LABEL-Мария';
const OTP_CODE = '918273';
const VOUCHER = 'SENTINEL-VOUCHER-CODE';
const REASON = 'SENTINEL free text reason';
const GUEST_KEY = 'guest-sentinel-key';

/** A booking command as a decoder hands it on, every forbidden field filled. */
const command = () => ({
  attemptId: 'attempt-0123456789abcdef',
  operationId: 'attempt-0123456789abcdef',
  locationId: 'loc-sofia',
  localDate: '2026-11-03',
  contact: { phone: PHONE, email: EMAIL, name: LABEL },
  label: LABEL,
  guestKey: GUEST_KEY,
  reason: REASON,
  code: OTP_CODE,
  codes: [VOUCHER],
  rawDestination: EMAIL,
  rawIdentifier: PHONE,
  fields: { displayName: LABEL },
  edits: [{ text: REASON }],
  text: REASON,
  issues: [{ message: REASON }],
  seats: [
    {
      lineId: 'line-1',
      serviceId: 'svc-cut',
      variantId: null,
      barberId: 'barber-ivan',
      barberPreference: 'SPECIFIC',
      startMinutes: 600,
      label: LABEL,
      guestKey: GUEST_KEY,
      contact: { phone: PHONE },
    },
  ],
  editCommand: {
    commands: [{ seatId: 'seat-1', priceCents: 2500, code: VOUCHER }],
  },
});

const SENTINELS = [
  PHONE,
  EMAIL,
  LABEL,
  OTP_CODE,
  VOUCHER,
  REASON,
  GUEST_KEY,
  'contact',
  'label',
  'guestKey',
  'reason',
  '"code"',
  '"codes"',
  'rawDestination',
  'rawIdentifier',
  '"fields"',
  '"edits"',
  '"text"',
  '"issues"',
];

describe('LogDigestSystem.basisOf — the allowlisted projection', () => {
  it('never holds a contact value, a label, a code or a reason', () => {
    const basis = LogDigestSystem.basisOf(command());
    for (const sentinel of SENTINELS) expect(basis).not.toContain(sentinel);
  });

  it('keeps the allowlisted ids, minutes, tags and cents, at every depth', () => {
    expect(JSON.parse(LogDigestSystem.basisOf(command()))).toEqual({
      attemptId: 'attempt-0123456789abcdef',
      operationId: 'attempt-0123456789abcdef',
      locationId: 'loc-sofia',
      localDate: '2026-11-03',
      seats: [
        {
          lineId: 'line-1',
          serviceId: 'svc-cut',
          variantId: null,
          barberId: 'barber-ivan',
          barberPreference: 'SPECIFIC',
          startMinutes: 600,
        },
      ],
      editCommand: { commands: [{ seatId: 'seat-1', priceCents: 2500 }] },
    });
  });

  it('is an allowlist: an unknown key — a field a command grows tomorrow — is dropped', () => {
    expect(
      LogDigestSystem.basisOf({ appointmentId: 'apt-1', note: REASON }),
    ).toBe('{"appointmentId":"apt-1"}');
    expect(LogDigestSystem.BASIS_KEYS).not.toContain('contact');
    expect(LogDigestSystem.BASIS_KEYS).not.toContain('reason');
    expect(LogDigestSystem.BASIS_KEYS).not.toContain('code');
  });

  it('keeps leaves only under an allowlisted key; arrays keep their positions', () => {
    // A top-level leaf, or a top-level array of leaves, is under no key.
    expect(LogDigestSystem.basisOf(PHONE)).toBe('null');
    expect(LogDigestSystem.basisOf([PHONE, 1])).toBe('[null,null]');
    expect(LogDigestSystem.basisOf(undefined)).toBe('null');
    expect(LogDigestSystem.basisOf({})).toBe('{}');
    // An allowlisted array of leaves (a roster's days) keeps them in order.
    expect(LogDigestSystem.basisOf({ days: ['TUE', 'MON'] })).toBe(
      '{"days":["TUE","MON"]}',
    );
    // Non-JSON leaves never reach the basis.
    expect(
      LogDigestSystem.basisOf({
        startMinutes: Number.NaN,
        endMinutes: undefined,
        windows: [() => 1],
      }),
    ).toBe('{"windows":[null]}');
  });

  it('is independent of key order', () => {
    const a = {
      locationId: 'loc',
      appointmentId: 'apt',
      seats: [{ seatId: 's', tipCents: 300 }],
    };
    const b = {
      seats: [{ tipCents: 300, seatId: 's' }],
      appointmentId: 'apt',
      locationId: 'loc',
    };
    expect(LogDigestSystem.basisOf(a)).toBe(LogDigestSystem.basisOf(b));
  });
});

describe('LogDigestSystem.digestOf — the keyed digest, cut to 16 characters', () => {
  /** The test-support keyed hash (deterministic, never production). */
  const fakeHash = fixtureKeyedHash('log-digest-test-key');

  it('same basis → same digest; a different allowlisted value → a different digest', () => {
    const one = LogDigestSystem.digestOf({ appointmentId: 'apt-1' }, fakeHash);
    const again = LogDigestSystem.digestOf(
      { appointmentId: 'apt-1', reason: REASON, contact: { phone: PHONE } },
      fakeHash,
    );
    const other = LogDigestSystem.digestOf(
      { appointmentId: 'apt-2' },
      fakeHash,
    );
    expect(one).toBe(again);
    expect(other).not.toBe(one);
    expect(one).toMatch(/^[0-9a-f]{16}$/);
    // Another key, another digest of the same basis.
    expect(
      LogDigestSystem.digestOf(
        { appointmentId: 'apt-1' },
        fixtureKeyedHash('another-key'),
      ),
    ).not.toBe(one);
  });

  it('hands the keyed hash the basis, never the raw command', () => {
    const seen: string[] = [];
    LogDigestSystem.digestOf(command(), (input) => {
      seen.push(input);
      return 'ab'.repeat(32);
    });
    expect(seen).toEqual([LogDigestSystem.basisOf(command())]);
    for (const sentinel of SENTINELS) expect(seen[0]).not.toContain(sentinel);
  });

  it('cuts the hash to its first 16 characters', () => {
    const digest = LogDigestSystem.digestOf(command(), () =>
      '0123456789abcdef'.repeat(4),
    );
    expect(digest).toBe('0123456789abcdef');
    expect(digest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('answers null when no key is bound (the hash answers "")', () => {
    expect(LogDigestSystem.digestOf(command(), () => '')).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(command());
    const once = LogDigestSystem.digestOf(frozen, fakeHash);
    const twice = LogDigestSystem.digestOf(frozen, fakeHash);
    expect(twice).toBe(once);
    expect(LogDigestSystem.basisOf(frozen)).toBe(
      LogDigestSystem.basisOf(frozen),
    );
    expect(frozen).toEqual(command());
  });
});
