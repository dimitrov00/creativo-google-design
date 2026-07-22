import { describe, expect, it } from 'vitest';
import { Email } from './email';

describe('Email.create', () => {
  it('accepts a well-formed address', () => {
    const result = Email.create('client@example.com');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('client@example.com');
    }
  });

  it('trims and lowercases the address', () => {
    const result = Email.create('  Client@Example.COM  ');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('client@example.com');
    }
  });

  it('rejects a malformed address', () => {
    expect(Email.create('not-an-email').isFailure()).toBe(true);
    expect(Email.create('missing@domain').isFailure()).toBe(true);
    expect(Email.create('@no-local-part.com').isFailure()).toBe(true);
  });
});

describe('Email.fromPrimitive', () => {
  it('wraps a trusted value without validation', () => {
    const email = Email.fromPrimitive('trusted@example.com');
    expect(email.value).toBe('trusted@example.com');
    expect(email.toString()).toBe('trusted@example.com');
  });
});

describe('Email.equals', () => {
  it('compares by value', () => {
    const a = Email.create('client@example.com');
    const b = Email.create('client@example.com');
    if (a.isFailure() || b.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(a.value.equals(b.value)).toBe(true);
    expect(a.value.equals(Email.fromPrimitive('other@example.com'))).toBe(
      false,
    );
  });
});
