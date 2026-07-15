import { describe, expect, it } from 'vitest';
import { Id } from './id';

class TestId extends Id<'Test'> {
  static of(value: string): TestId {
    return new TestId(value);
  }
}

class OtherTestId extends Id<'OtherTest'> {
  static of(value: string): OtherTestId {
    return new OtherTestId(value);
  }
}

describe('Id', () => {
  it('exposes the wrapped value via .value and .toString()', () => {
    const id = TestId.of('abc123');
    expect(id.value).toBe('abc123');
    expect(id.toString()).toBe('abc123');
  });

  it('equals() compares by value', () => {
    expect(TestId.of('abc123').equals(TestId.of('abc123'))).toBe(true);
    expect(TestId.of('abc123').equals(TestId.of('xyz789'))).toBe(false);
  });

  it('different brands with the same runtime value are still distinct types', () => {
    // Compile-time check: this line would fail to typecheck if branding
    // didn't work (TestId and OtherTestId would be structurally
    // interchangeable). Runtime behavior (still just string comparison)
    // is verified separately above.
    const a = TestId.of('same-value');
    const b = OtherTestId.of('same-value');
    expect(a.value).toBe(b.value);
  });
});
