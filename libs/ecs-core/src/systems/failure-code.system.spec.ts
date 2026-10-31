import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RepositoryError } from '@core/errors';
import { deepFreeze } from '@core/testing';
import { FailureCodeSystem } from './failure-code.system';

/*
 * The canonical-code cases, moved from trigger-attempt.system.spec.ts when
 * the reader got its own home (law-fix wave B, B1): every adapter and the
 * retry verdict read an SDK failure's code here.
 */

const { codeOf, UNKNOWN_CODE } = FailureCodeSystem;

describe('FailureCodeSystem.codeOf — an SDK failure’s canonical code', () => {
  it('reads numeric gRPC codes as the Admin SDK reports them', () => {
    expect(codeOf({ code: 10 })).toBe('aborted');
    expect(codeOf({ code: 6 })).toBe('already-exists');
    expect(codeOf({ code: 14 })).toBe('unavailable');
    expect(codeOf({ code: 99 })).toBe('unknown');
  });

  it('reads string codes in any common spelling', () => {
    expect(codeOf({ code: 'DEADLINE_EXCEEDED' })).toBe('deadline-exceeded');
    expect(codeOf({ code: 'firestore/resource-exhausted' })).toBe(
      'resource-exhausted',
    );
    expect(codeOf(new Error('boom'))).toBe('unknown');
    expect(codeOf(null)).toBe('unknown');
  });

  it('never reads a port’s refusal by a `code` it does not carry — codeOf alone still says unknown', () => {
    expect(codeOf(RepositoryError.readFailed('a/1', 'unavailable'))).toBe(
      'unknown',
    );
  });

  it('names the unknown code `unknown`', () => {
    expect(UNKNOWN_CODE).toBe('unknown');
  });
});

describe('properties', () => {
  it('reads every gRPC status by its own name', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 40 }), (status) => {
        const code = codeOf({ code: status });
        if (status < 1 || status > 16) expect(code).toBe('unknown');
        else expect(code).not.toBe('');
      }),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const errors = deepFreeze([
      { code: 13 },
      { code: 'ABORTED' },
      { code: 'auth/user-not-found' },
      null,
    ]);
    for (const error of errors) {
      expect(codeOf(error)).toBe(codeOf(error));
    }
    expect(codeOf(errors[0])).toBe('internal');
    expect(codeOf(errors[1])).toBe('aborted');
    expect(codeOf(errors[2])).toBe('user-not-found');
    expect(codeOf(errors[3])).toBe('unknown');
    expect(errors[1]).toEqual({ code: 'ABORTED' });
  });
});
