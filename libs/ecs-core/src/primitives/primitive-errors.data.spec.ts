import { describe, expect, it } from 'vitest';
import { PrimitiveError, PrimitiveErrorCode } from './primitive-errors.data';

describe('PrimitiveError — one flat shape for every refusal', () => {
  it('codes are SCREAMING and PRIMITIVE_-prefixed', () => {
    for (const code of Object.values(PrimitiveErrorCode)) {
      expect(code).toMatch(/^PRIMITIVE_[A-Z_]+$/);
    }
  });

  it('builds a serialisable, prototype-free struct; is() reads the code', () => {
    const error = PrimitiveError.of(
      PrimitiveErrorCode.IdEmpty,
      '',
      'AppointmentId',
    );
    expect(error).toEqual({
      errorCode: 'PRIMITIVE_ID_EMPTY',
      raw: '',
      brand: 'AppointmentId',
    });
    expect(Object.getPrototypeOf(error)).toBe(Object.prototype);
    expect(PrimitiveError.is(error, PrimitiveErrorCode.IdEmpty)).toBe(true);
    expect(PrimitiveError.is(error, PrimitiveErrorCode.IdHasSlash)).toBe(false);
  });
});
