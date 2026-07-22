import { describe, expect, it } from 'vitest';
import { Email } from './email';
import {
  createIdentifier,
  emailIdentifier,
  identifierChannelKey,
  identifierEquals,
  reconstituteIdentifier,
} from './identifier';

describe('createIdentifier', () => {
  it('validates a phone identifier', () => {
    const result = createIdentifier({ kind: 'phone', value: '+359885550100' });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.kind).toBe('phone');
      expect(result.value.value.toString()).toBe('+359885550100');
    }
  });

  it('validates an email identifier', () => {
    const result = createIdentifier({
      kind: 'email',
      value: 'client@example.com',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.kind).toBe('email');
    }
  });

  it('rejects an invalid phone number', () => {
    const result = createIdentifier({ kind: 'phone', value: 'not-a-phone' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.kind).toBe('phone');
    }
  });

  it('rejects an invalid email', () => {
    const result = createIdentifier({ kind: 'email', value: 'not-an-email' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.kind).toBe('email');
    }
  });
});

describe('reconstituteIdentifier', () => {
  it('rebuilds a trusted phone identifier', () => {
    const identifier = reconstituteIdentifier({
      kind: 'phone',
      value: '+359885550100',
    });
    expect(identifier.kind).toBe('phone');
  });

  it('rebuilds a trusted email identifier', () => {
    const identifier = reconstituteIdentifier({
      kind: 'email',
      value: 'client@example.com',
    });
    expect(identifier.kind).toBe('email');
  });
});

describe('identifierChannelKey', () => {
  it('formats kind:value', () => {
    const identifier = emailIdentifier(
      Email.fromPrimitive('client@example.com'),
    );
    expect(identifierChannelKey(identifier)).toBe('email:client@example.com');
  });
});

describe('identifierEquals', () => {
  it('is true for the same kind and value', () => {
    const a = emailIdentifier(Email.fromPrimitive('client@example.com'));
    const b = emailIdentifier(Email.fromPrimitive('client@example.com'));
    expect(identifierEquals(a, b)).toBe(true);
  });

  it('is false across different kinds', () => {
    const a = emailIdentifier(Email.fromPrimitive('client@example.com'));
    const phoneResult = createIdentifier({
      kind: 'phone',
      value: '+359885550100',
    });
    if (phoneResult.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(identifierEquals(a, phoneResult.value)).toBe(false);
  });

  it('is false for different values of the same kind', () => {
    const a = reconstituteIdentifier({ kind: 'phone', value: '+359885550100' });
    const b = reconstituteIdentifier({ kind: 'phone', value: '+359888123456' });
    expect(identifierEquals(a, b)).toBe(false);
  });
});
