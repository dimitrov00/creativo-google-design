import { describe, expect, expectTypeOf, it } from 'vitest';
import { Result } from './result.data';

/* The cases of the legacy kernel's `result.spec.ts` (deleted in Phase 4b; ledger
 * `docs/architecture/flips/phase-4b-delete.md` §11.1) over the plain union. */

describe('Result.ok / Result.err', () => {
  it('ok() is a plain { ok: true, value } struct, narrowed by r.ok', () => {
    const result: Result<number, string> = Result.ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    if (result.ok) expect(result.value).toBe(42);
  });

  it('err() is a plain { ok: false, error } struct, narrowed by !r.ok', () => {
    const result: Result<number, string> = Result.err('bad input');
    expect(result).toEqual({ ok: false, error: 'bad input' });
    if (!result.ok) expect(result.error).toBe('bad input');
  });

  it('a ternary on r.ok is the whole of the old match()', () => {
    const word = (r: Result<number, string>) =>
      r.ok ? `got ${r.value}` : `error: ${r.error}`;
    expect(word(Result.ok(5))).toBe('got 5');
    expect(word(Result.err('bad'))).toBe('error: bad');
  });
});

describe('Result.all', () => {
  it('returns every value, in order, when every result succeeds', () => {
    const results: Result<number, string>[] = [
      Result.ok(1),
      Result.ok(2),
      Result.ok(3),
    ];
    expect(Result.all(results)).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it('collects every failure, not just the first', () => {
    const results: Result<number, string>[] = [
      Result.ok(1),
      Result.err('bad field a'),
      Result.err('bad field b'),
    ];
    expect(Result.all(results)).toEqual({
      ok: false,
      error: ['bad field a', 'bad field b'],
    });
  });

  it('returns ok with an empty array for an empty input', () => {
    expect(Result.all([])).toEqual({ ok: true, value: [] });
  });

  it('combines heterogeneous results into a typed tuple on success', () => {
    const all = Result.all([
      Result.ok(1) as Result<number, 'a'>,
      Result.ok('two') as Result<string, 'b'>,
      Result.ok(true) as Result<boolean, 'c'>,
    ]);
    expectTypeOf(all).toEqualTypeOf<
      Result<[number, string, boolean], readonly ('a' | 'b' | 'c')[]>
    >();
    if (!all.ok) throw new Error('expected ok');
    const [a, b, c] = all.value;
    expect(a).toBe(1);
    expect(b).toBe('two');
    expect(c).toBe(true);
  });

  it('collects every failure across heterogeneous results', () => {
    const all = Result.all([
      Result.ok(1) as Result<number, string>,
      Result.err('bad string field') as Result<string, string>,
      Result.err('bad bool field') as Result<boolean, string>,
    ]);
    expect(all).toEqual({
      ok: false,
      error: ['bad string field', 'bad bool field'],
    });
  });
});

describe('Result.map / Result.mapError', () => {
  it('map transforms a value and passes a failure through untouched', () => {
    expect(
      Result.map(Result.ok(2) as Result<number, string>, (n) => n * 10),
    ).toEqual(Result.ok(20));
    const failed = Result.err('no') as Result<number, string>;
    expect(Result.map(failed, (n) => n * 10)).toBe(failed);
  });

  it('mapError transforms an error and passes a success through untouched', () => {
    expect(
      Result.mapError(Result.err('no') as Result<number, string>, (e) => ({
        code: e,
      })),
    ).toEqual(Result.err({ code: 'no' }));
    const passed = Result.ok(1) as Result<number, string>;
    expect(Result.mapError(passed, (e) => ({ code: e }))).toBe(passed);
  });
});
