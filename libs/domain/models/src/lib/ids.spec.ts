import { describe, expect, it } from 'vitest';
import {
  AppointmentId,
  OtpId,
  ServiceId,
  StaffId,
  TenantId,
  UserId,
} from './ids';

describe('branded IDs', () => {
  const cases = [
    { name: 'TenantId', cls: TenantId },
    { name: 'UserId', cls: UserId },
    { name: 'StaffId', cls: StaffId },
    { name: 'ServiceId', cls: ServiceId },
    { name: 'AppointmentId', cls: AppointmentId },
    { name: 'OtpId', cls: OtpId },
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
        // `cls` is a union across all six branded ID classes in this loop,
        // so `a`/`b` don't narrow to the same branded type here even
        // though they're always the same class at runtime — cast through
        // the shared `equals(other: unknown)` shape to sidestep the
        // brand-intersection false negative.
        expect((a as { equals(other: unknown): boolean }).equals(b)).toBe(
          false,
        );
      });
    });
  }
});
