import { describe, expect, it } from 'vitest';
import { Tag } from '@core/primitives';
import { OtpRefusalReason } from './otp-refusal-reason.data';

describe('OtpRefusalReason', () => {
  it('holds the two recorded refusals, SCREAMING_SNAKE, each value once', () => {
    const values = [...Tag.values(OtpRefusalReason)];
    expect(values).toEqual(['WRONG_CODE', 'LOCKED_OUT']);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(value).toBe(value.toUpperCase());
    expect(OtpRefusalReason.LockedOut).toBe('LOCKED_OUT');
  });

  it('is told apart from strangers through the dictionary', () => {
    expect(Tag.has(OtpRefusalReason, 'WRONG_CODE')).toBe(true);
    expect(Tag.has(OtpRefusalReason, 'EXPIRED')).toBe(false);
    expect(Tag.has(OtpRefusalReason, 'wrong_code')).toBe(false);
  });
});
