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

/* The one UTF-8 counter (audit-hardening Phase 3, P3-RU-27): moved here from
 * `ClientIssueSystem`, whose batch-weight cases (`client-issue.system.spec.ts`,
 * "weighs at most 4 KB of JSON, in UTF-8 bytes") still pin it through the
 * sink — the same three widths, here at the counter itself. */

describe('CanonicalJsonSystem.utf8Bytes', () => {
  it('weighs ASCII one byte a character', () => {
    expect(CanonicalJsonSystem.utf8Bytes('')).toBe(0);
    expect(CanonicalJsonSystem.utf8Bytes('{"a":1}')).toBe(7);
  });

  it('weighs Cyrillic two bytes a character, as an encoder does', () => {
    expect(CanonicalJsonSystem.utf8Bytes('щ'.repeat(160))).toBe(320);
    expect(CanonicalJsonSystem.utf8Bytes('Иван')).toBe(
      new TextEncoder().encode('Иван').length,
    );
  });

  it('weighs a three-byte character three, the em dash among them', () => {
    expect(CanonicalJsonSystem.utf8Bytes('—')).toBe(3);
    expect(CanonicalJsonSystem.utf8Bytes('€ 1')).toBe(5);
  });

  it('weighs an astral character — a surrogate pair — four bytes, not six', () => {
    expect(CanonicalJsonSystem.utf8Bytes('😀'.repeat(80))).toBe(320);
    expect(CanonicalJsonSystem.utf8Bytes('a😀b')).toBe(6);
  });

  it('weighs a lone surrogate three, as the replacement character', () => {
    expect(CanonicalJsonSystem.utf8Bytes('\ud83d')).toBe(3);
    expect(CanonicalJsonSystem.utf8Bytes('\ude00x')).toBe(4);
  });

  it('agrees with an encoder over canonical JSON of mixed text', () => {
    const text = CanonicalJsonSystem.of({ b: 'Мария 😀', a: ['—', 'x'] });
    expect(CanonicalJsonSystem.utf8Bytes(text)).toBe(
      new TextEncoder().encode(text).length,
    );
  });

  it('is pure: same input → same output', () => {
    const text = 'Иван — 😀';
    expect(CanonicalJsonSystem.utf8Bytes(text)).toBe(
      CanonicalJsonSystem.utf8Bytes(text),
    );
  });
});
