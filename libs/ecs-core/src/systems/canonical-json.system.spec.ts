import { describe, expect, it } from 'vitest';
import { deepFreeze } from '@core/testing';
import { CanonicalJsonSystem } from './canonical-json.system';
import { ClientStatsSystem } from './client-stats.system';

/* The one canonical JSON printer (audit-hardening WS-4.2): moved out of
 * `ClientStatsSystem.canonicalJson`, which delegates — its own spec is
 * unchanged. */

describe('CanonicalJsonSystem.of', () => {
  it('prints object keys sorted, at every depth', () => {
    expect(CanonicalJsonSystem.of({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  it('is independent of key order: two equal values print the same', () => {
    const written = { z: [1, { y: 'x', b: null }], a: true, m: { q: 1, p: 2 } };
    const reordered = {
      m: { p: 2, q: 1 },
      a: true,
      z: [1, { b: null, y: 'x' }],
    };
    expect(CanonicalJsonSystem.of(written)).toBe(
      CanonicalJsonSystem.of(reordered),
    );
  });

  it('keeps array order — an array’s order is content', () => {
    expect(CanonicalJsonSystem.of([2, 1])).not.toBe(
      CanonicalJsonSystem.of([1, 2]),
    );
    expect(CanonicalJsonSystem.of([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('prints leaves as JSON does: null, numbers, strings, booleans; undefined vanishes from a record', () => {
    expect(CanonicalJsonSystem.of(null)).toBe('null');
    expect(CanonicalJsonSystem.of(0)).toBe('0');
    expect(CanonicalJsonSystem.of('a"b')).toBe('"a\\"b"');
    expect(CanonicalJsonSystem.of(false)).toBe('false');
    expect(CanonicalJsonSystem.of({ b: undefined, a: 1 })).toBe('{"a":1}');
    expect(CanonicalJsonSystem.of([undefined])).toBe('[null]');
    expect(CanonicalJsonSystem.of({})).toBe('{}');
    expect(CanonicalJsonSystem.of([])).toBe('[]');
  });

  it('is what ClientStatsSystem.canonicalJson answers (the delegation)', () => {
    const value = { b: [{ d: 1, c: 2 }], a: 'x' };
    expect(ClientStatsSystem.canonicalJson(value)).toBe(
      CanonicalJsonSystem.of(value),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const value = deepFreeze({ b: [{ d: 1, c: 2 }], a: { y: null, x: 'v' } });
    const once = CanonicalJsonSystem.of(value);
    const twice = CanonicalJsonSystem.of(value);
    expect(twice).toBe(once);
    expect(Object.keys(value)).toEqual(['b', 'a']);
    expect(Object.keys(value.a)).toEqual(['y', 'x']);
  });
});
