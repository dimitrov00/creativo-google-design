import { describe, expect, it } from 'vitest';
import { OperationId } from '@core/primitives';
import { deepFreeze } from '@core/testing';
import { WriteProvenance } from './write-provenance.data';

/* Which call last wrote the document (audit-hardening WS-4.3, RU-29): the
 * slice, its NONE, and the read-time check — absent and null are valid. */

const OP = OperationId.of('op-0123456789abcdef');

describe('WriteProvenance — the slice', () => {
  it('NONE carries no operation id — what seeds and fixtures spread', () => {
    expect(WriteProvenance.NONE).toEqual({ writeOperationId: null });
    expect({ id: 'x', ...WriteProvenance.NONE }).toEqual({
      id: 'x',
      writeOperationId: null,
    });
  });

  it('of stamps the call’s id, or none when it carried none', () => {
    expect(WriteProvenance.of(OP)).toEqual({ writeOperationId: OP });
    expect(WriteProvenance.of(null)).toEqual(WriteProvenance.NONE);
  });
});

describe('WriteProvenance.fieldFault — the read-time check', () => {
  it('admits an absent field: a document written before WS-4.3', () => {
    expect(WriteProvenance.fieldFault({})).toBeNull();
    expect(
      WriteProvenance.fieldFault({ bookingStatus: 'CONFIRMED' }),
    ).toBeNull();
  });

  it('admits null and an OperationId', () => {
    expect(WriteProvenance.fieldFault({ writeOperationId: null })).toBeNull();
    expect(WriteProvenance.fieldFault({ writeOperationId: OP })).toBeNull();
  });

  it('names the field when a present value is not an OperationId', () => {
    for (const bad of [
      '',
      '   ',
      'a/b',
      '..',
      '__x__',
      42,
      true,
      {},
      [],
      undefined,
    ]) {
      expect(WriteProvenance.fieldFault({ writeOperationId: bad })).toBe(
        'writeOperationId',
      );
    }
  });

  it('reads the document’s OWN field, never an inherited one', () => {
    const inherited = Object.create({ writeOperationId: 42 }) as Record<
      string,
      unknown
    >;
    expect(WriteProvenance.fieldFault(inherited)).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const doc = deepFreeze({ writeOperationId: OP, other: [1] });
    const once = WriteProvenance.fieldFault(doc);
    expect(WriteProvenance.fieldFault(doc)).toBe(once);
    expect(doc).toEqual({ writeOperationId: OP, other: [1] });
  });
});
