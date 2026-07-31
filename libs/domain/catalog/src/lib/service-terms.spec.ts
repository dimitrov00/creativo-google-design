import { describe, expect, it } from 'vitest';
import { Money } from '@creativo/domain/kernel';
import { ServiceTerms } from './service-terms';
describe('ServiceTerms — setup and cleanup', () => {
  const price = () => {
    const result = Money.fromMinorUnitsAndCode(1500, 'EUR');
    if (result.isFailure()) throw new Error('bad fixture');
    return result.value;
  };

  it('defaults both pads to zero, so an unpadded service occupies exactly its duration', () => {
    const terms = ServiceTerms.create(price(), 45);
    if (terms.isFailure()) throw new Error('unexpected');
    expect(terms.value.setupMinutes).toBe(0);
    expect(terms.value.cleanupMinutes).toBe(0);
    expect(terms.value.occupiedMinutes()).toBe(45);
  });

  it('keeps the pads OUTSIDE the sold duration', () => {
    // The client is quoted 45 minutes and charged for 45 minutes; the chair
    // is held for 60. Folding the mop-up into `durationMinutes` would inflate
    // both the confirmation and the utilisation figure.
    const terms = ServiceTerms.create(price(), 45, {
      setupMinutes: 5,
      cleanupMinutes: 10,
    });
    if (terms.isFailure()) throw new Error('unexpected');
    expect(terms.value.durationMinutes).toBe(45);
    expect(terms.value.occupiedMinutes()).toBe(60);
  });

  it('rejects a negative or fractional pad', () => {
    expect(
      ServiceTerms.create(price(), 45, { cleanupMinutes: -5 }).isFailure(),
    ).toBe(true);
    expect(
      ServiceTerms.create(price(), 45, { setupMinutes: 2.5 }).isFailure(),
    ).toBe(true);
  });

  it('distinguishes terms that differ only in their padding', () => {
    const bare = ServiceTerms.create(price(), 45);
    const padded = ServiceTerms.create(price(), 45, { cleanupMinutes: 10 });
    if (bare.isFailure() || padded.isFailure()) throw new Error('unexpected');
    expect(bare.value.equals(padded.value)).toBe(false);
  });
});
