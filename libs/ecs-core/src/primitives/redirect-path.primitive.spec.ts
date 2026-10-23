import { describe, expect, it } from 'vitest';
import { PrimitiveErrorCode } from './primitive.error';
import { RedirectPath } from './redirect-path.primitive';

/*
 * The cases of the legacy identity `redirect-path.spec.ts` (the legacy class,
 * deleted in Phase 4b; ledger `docs/architecture/flips/phase-4b-delete.md`
 * §11.1), ported onto the primitive. Its `equals` / `toString` case is `dead:`
 * — a brand IS its string (`===`).
 */

const parsed = (raw: string) => RedirectPath.parse(raw);

describe('RedirectPath.parse', () => {
  it('accepts a relative path with query/fragment', () => {
    const result = parsed('/account/settings?tab=billing#top');
    expect(result).toEqual({
      ok: true,
      value: '/account/settings?tab=billing#top',
    });
  });

  it('trims what it accepts', () => {
    expect(parsed('  /book  ')).toEqual({ ok: true, value: '/book' });
  });

  it('rejects an absolute URL', () => {
    expect(parsed('https://phishing.example.com').ok).toBe(false);
  });

  it('rejects a protocol-relative URL', () => {
    expect(parsed('//evil.com').ok).toBe(false);
  });

  it('rejects a dangerous protocol', () => {
    expect(parsed('javascript:alert(1)').ok).toBe(false);
  });

  it('rejects a backslash variant', () => {
    expect(parsed('/\\evil.com').ok).toBe(false);
  });

  it('rejects an empty string or one not starting with /', () => {
    expect(parsed('').ok).toBe(false);
    expect(parsed('account').ok).toBe(false);
  });

  it('refuses as a flat primitive error naming the raw input', () => {
    expect(parsed('//evil.com')).toEqual({
      ok: false,
      error: {
        errorCode: PrimitiveErrorCode.RedirectPathUnsafe,
        raw: '//evil.com',
        brand: 'RedirectPath',
      },
    });
  });
});

describe('RedirectPath.parseOrRoot', () => {
  it('falls back to root() on invalid or absent input', () => {
    expect(RedirectPath.parseOrRoot('https://evil.com')).toBe('/');
    expect(RedirectPath.parseOrRoot(null)).toBe('/');
    expect(RedirectPath.parseOrRoot('')).toBe('/');
  });

  it('parses a valid path', () => {
    expect(RedirectPath.parseOrRoot('/book')).toBe('/book');
  });
});

describe('RedirectPath.authDestination', () => {
  it('collapses root to the post-auth default', () => {
    expect(RedirectPath.authDestination(RedirectPath.root())).toBe('/account');
  });

  it('honours any other path as-is', () => {
    expect(
      RedirectPath.authDestination(RedirectPath.parseOrRoot('/book')),
    ).toBe('/book');
  });
});
