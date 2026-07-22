import { describe, expect, it } from 'vitest';
import {
  BarberId,
  LocationId,
  MediaRefId,
  ServiceCategoryId,
  ServiceId,
} from './ids';

describe('branded IDs', () => {
  const cases = [
    { name: 'ServiceId', cls: ServiceId },
    { name: 'ServiceCategoryId', cls: ServiceCategoryId },
    { name: 'BarberId', cls: BarberId },
    { name: 'LocationId', cls: LocationId },
    { name: 'MediaRefId', cls: MediaRefId },
  ] as const;

  for (const { name, cls } of cases) {
    describe(name, () => {
      it('create() accepts a non-empty string', () => {
        const result = cls.create('abc123');
        expect(result.isSuccess()).toBe(true);
        if (result.isSuccess()) {
          expect(result.value.value).toBe('abc123');
        }
      });

      it('create() rejects an empty/whitespace-only string', () => {
        expect(cls.create('').isFailure()).toBe(true);
        expect(cls.create('   ').isFailure()).toBe(true);
      });

      it('generate() produces a non-empty, unique value each time', () => {
        const a = cls.generate();
        const b = cls.generate();
        expect(a.value.length).toBeGreaterThan(0);
        expect((a as { equals(other: unknown): boolean }).equals(b)).toBe(
          false,
        );
      });
    });
  }
});
