import { describe, expect, expectTypeOf, it } from 'vitest';
import { deepFreeze } from '@core/testing';
import { StoredFields } from './stored-fields.data';

describe('StoredFields — a body as read, nothing checked yet', () => {
  it('field reads an own field by name', () => {
    expect(StoredFields.field({ startMinutes: 600 }, 'startMinutes')).toBe(600);
    expect(StoredFields.field({ note: null }, 'note')).toBeNull();
  });

  it('field never reads an inherited property', () => {
    expect(StoredFields.field({}, 'toString')).toBeUndefined();
    expect(StoredFields.field([], 'map')).toBeUndefined();
    expect(
      StoredFields.field(Object.create({ inherited: 1 }), 'inherited'),
    ).toBeUndefined();
  });

  it('field answers undefined for an absent field and for a non-object', () => {
    expect(StoredFields.field({ a: 1 }, 'b')).toBeUndefined();
    for (const raw of [null, undefined, 'seat', 0, true]) {
      expect(StoredFields.field(raw, 'length')).toBeUndefined();
    }
  });

  it('field is pure: same input → same output, input untouched', () => {
    const raw = deepFreeze({ errorCode: 'X', path: 'a/1' });
    expect(StoredFields.field(raw, 'path')).toBe(
      StoredFields.field(raw, 'path'),
    );
    expect(raw).toEqual({ errorCode: 'X', path: 'a/1' });
  });

  it('isRecord accepts a plain object, an empty one and one without a prototype', () => {
    expect(StoredFields.isRecord({ startMinutes: 600 })).toBe(true);
    expect(StoredFields.isRecord({})).toBe(true);
    expect(StoredFields.isRecord(Object.create(null))).toBe(true);
  });

  it('isRecord refuses null, arrays and every primitive', () => {
    for (const raw of [null, undefined, [], [{}], 'seat', 0, 600, true]) {
      expect(StoredFields.isRecord(raw)).toBe(false);
    }
  });

  it('isRecord narrows unknown to the readable body', () => {
    const raw: unknown = { blockKind: 'BUSY' };
    if (StoredFields.isRecord(raw)) {
      expectTypeOf(raw).toEqualTypeOf<StoredFields>();
      expect(raw['blockKind']).toBe('BUSY');
    } else {
      expect.unreachable('a plain object is a record');
    }
  });

  it('isArrayOf accepts an array whose every element passes, the empty one included, and narrows the stored array itself', () => {
    const isText = (raw: unknown): raw is string => typeof raw === 'string';
    const stored: unknown = ['a', 'b'];
    expect(StoredFields.isArrayOf(stored, isText)).toBe(true);
    expect(StoredFields.isArrayOf([], isText)).toBe(true);
    if (StoredFields.isArrayOf(stored, isText)) {
      expectTypeOf(stored).toEqualTypeOf<readonly string[]>();
    }
    for (const raw of [['a', 1], [null], 'ab', null, undefined, { 0: 'a' }]) {
      expect(StoredFields.isArrayOf(raw, isText)).toBe(false);
    }
  });

  it('isRecordArray accepts arrays of records only — a line of the bill, the ledger, a remembered pair', () => {
    expect(StoredFields.isRecordArray([])).toBe(true);
    expect(StoredFields.isRecordArray([{}, { pair: 1 }])).toBe(true);
    for (const raw of [[null], [{}, []], [{}, 'x'], {}, null, 'x']) {
      expect(StoredFields.isRecordArray(raw)).toBe(false);
    }
  });

  it('isTextOrNull accepts a string — the empty one too — or null, and nothing else', () => {
    for (const raw of ['', 'Георги', null]) {
      expect(StoredFields.isTextOrNull(raw)).toBe(true);
    }
    for (const raw of [undefined, 0, false, {}, ['x']]) {
      expect(StoredFields.isTextOrNull(raw)).toBe(false);
    }
  });

  it('isCount accepts a non-negative safe integer and refuses the rest', () => {
    for (const raw of [0, 1, 42, Number.MAX_SAFE_INTEGER]) {
      expect(StoredFields.isCount(raw)).toBe(true);
    }
    for (const raw of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      '1',
      null,
    ]) {
      expect(StoredFields.isCount(raw)).toBe(false);
    }
  });

  it('is pure: same input → same answer, the input untouched', () => {
    const body = deepFreeze({ seats: [{ seatId: 's1' }] });
    expect(StoredFields.isRecord(body)).toBe(StoredFields.isRecord(body));
    expect(StoredFields.isRecordArray(body.seats)).toBe(
      StoredFields.isRecordArray(body.seats),
    );
    expect(body).toEqual({ seats: [{ seatId: 's1' }] });
  });
});
