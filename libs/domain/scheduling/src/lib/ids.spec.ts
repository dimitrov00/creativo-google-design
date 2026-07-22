import { describe, expect, it } from 'vitest';
import { AppointmentId, GuestId, SeatId } from './ids';

describe.each([
  ['AppointmentId', AppointmentId],
  ['SeatId', SeatId],
  ['GuestId', GuestId],
] as const)('%s', (_name, IdClass) => {
  it('creates from a non-empty string', () => {
    const result = IdClass.create('abc-123');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('abc-123');
    }
  });

  it('rejects an empty string', () => {
    expect(IdClass.create('').isFailure()).toBe(true);
  });

  it('rejects a whitespace-only string', () => {
    expect(IdClass.create('   ').isFailure()).toBe(true);
  });

  it('two ids created from the same raw value carry the same underlying value', () => {
    const a = IdClass.create('same');
    const b = IdClass.create('same');
    if (a.isFailure() || b.isFailure()) throw new Error('bad fixture');
    // See engagement's ids.spec.ts for why this compares strings rather
    // than calling `.equals()` in a generic table-test across distinct
    // branded id classes.
    expect(a.value.toString()).toBe(b.value.toString());
  });
});

describe('AppointmentId.generate / SeatId.generate', () => {
  it('produce fresh non-empty ids', () => {
    expect(AppointmentId.generate().value.length).toBeGreaterThan(0);
    expect(SeatId.generate().value.length).toBeGreaterThan(0);
  });
});

describe('GuestId.fromSequence', () => {
  it('mints a deterministic id from a sequence number', () => {
    expect(GuestId.fromSequence(0).value).toBe('guest-0');
    expect(GuestId.fromSequence(5).value).toBe('guest-5');
  });

  it('has no generate() — sequence is the only sanctioned minting path (blueprint §7.7)', () => {
    expect('generate' in GuestId).toBe(false);
  });
});
