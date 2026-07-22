import { describe, expect, it } from 'vitest';
import { RedirectPath } from './redirect-path';

describe('RedirectPath.create', () => {
  it('accepts a relative path with query/fragment', () => {
    const result = RedirectPath.create('/account/settings?tab=billing#top');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('/account/settings?tab=billing#top');
    }
  });

  it('rejects an absolute URL', () => {
    expect(
      RedirectPath.create('https://phishing.example.com').isFailure(),
    ).toBe(true);
  });

  it('rejects a protocol-relative URL', () => {
    expect(RedirectPath.create('//evil.com').isFailure()).toBe(true);
  });

  it('rejects a dangerous protocol', () => {
    expect(RedirectPath.create('javascript:alert(1)').isFailure()).toBe(true);
  });

  it('rejects a backslash variant', () => {
    expect(RedirectPath.create('/\\evil.com').isFailure()).toBe(true);
  });

  it('rejects an empty string or one not starting with /', () => {
    expect(RedirectPath.create('').isFailure()).toBe(true);
    expect(RedirectPath.create('account').isFailure()).toBe(true);
  });
});

describe('RedirectPath.parseOrRoot', () => {
  it('falls back to root() on invalid input', () => {
    expect(RedirectPath.parseOrRoot('https://evil.com').value).toBe('/');
    expect(RedirectPath.parseOrRoot(undefined).value).toBe('/');
    expect(RedirectPath.parseOrRoot(null).value).toBe('/');
  });

  it('parses a valid path', () => {
    expect(RedirectPath.parseOrRoot('/book').value).toBe('/book');
  });
});

describe('RedirectPath.authDestination', () => {
  it('collapses root to the post-auth default', () => {
    expect(RedirectPath.root().authDestination().value).toBe('/account');
  });

  it('honours any other path as-is', () => {
    expect(RedirectPath.fromPrimitive('/book').authDestination().value).toBe(
      '/book',
    );
  });
});

describe('RedirectPath.equals', () => {
  it('compares by value', () => {
    const a = RedirectPath.fromPrimitive('/book');
    const b = RedirectPath.fromPrimitive('/book');
    expect(a.equals(b)).toBe(true);
    expect(a.toString()).toBe('/book');
  });
});
