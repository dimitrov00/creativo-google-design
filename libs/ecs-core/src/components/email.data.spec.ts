import { describe, expect, it } from 'vitest';
import { Email } from './email.data';

// The accounts, identity and models email.spec.ts cases, collapsed.
describe('Email.parse — the edge guard', () => {
  it('accepts a well-formed address', () => {
    expect(Email.parse('client@example.com')).toBe('client@example.com');
  });

  it('trims and lowercases the address', () => {
    expect(Email.parse('  Client@Example.COM  ')).toBe('client@example.com');
  });

  it('rejects a malformed address', () => {
    expect(Email.parse('not-an-email')).toBeNull();
    expect(Email.parse('missing@domain')).toBeNull();
    expect(Email.parse('@no-local-part.com')).toBeNull();
  });

  it('rejects a one-letter top-level label, whitespace inside and a second @', () => {
    expect(Email.parse('client@example.c')).toBeNull();
    expect(Email.parse('cli ent@example.com')).toBeNull();
    expect(Email.parse('a@b@example.com')).toBeNull();
    expect(Email.parse('')).toBeNull();
  });
});

describe('Email.of', () => {
  it('wraps a trusted value without re-validating', () => {
    expect(Email.of('trusted@example.com')).toBe('trusted@example.com');
  });

  it('is nominal: a raw string is not an Email', () => {
    // @ts-expect-error — only Email.of / Email.parse make one
    const raw: Email = 'client@example.com';
    expect(raw).toBe('client@example.com');
  });
});

describe('Email.equals', () => {
  it('compares by canonical value', () => {
    const a = Email.parse('client@example.com');
    const b = Email.parse(' CLIENT@example.com');
    if (a === null || b === null)
      throw new Error('unexpected failure in test fixture');
    expect(Email.equals(a, b)).toBe(true);
    expect(Email.equals(a, Email.of('other@example.com'))).toBe(false);
  });
});
