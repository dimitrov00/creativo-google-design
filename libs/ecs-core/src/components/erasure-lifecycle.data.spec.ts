import { describe, expect, it } from 'vitest';
import { utcMs } from '@core/testing';
import { ErasureLifecycle, ErasureStatus } from './erasure-lifecycle.data';

/*
 * The erasure tag of a client record (audit-hardening Phase 3 WS-D,
 * P3-RU-20, P3-L-18): the three flat variants, their factories, the guard
 * every writer reads, and the STRICT read-time check — the key is required
 * on every stored body.
 */

const STARTED = utcMs('2026-10-27T09:00:00Z');
const ERASED_AT = utcMs('2026-10-27T09:05:00Z');

describe('ErasureStatus', () => {
  it('names the three states, SCREAMING, each once, in lifecycle order', () => {
    expect(ErasureLifecycle.STATUSES).toEqual(['NONE', 'ERASING', 'ERASED']);
    expect(new Set(ErasureLifecycle.STATUSES).size).toBe(3);
    expect(ErasureStatus.Erasing).toBe('ERASING');
  });
});

describe('ErasureLifecycle — the factories', () => {
  it('none() is ONE shared struct, the tag alone', () => {
    expect(ErasureLifecycle.none()).toEqual({ erasureStatus: 'NONE' });
    expect(ErasureLifecycle.none()).toBe(ErasureLifecycle.none());
  });

  it('begin() carries the start stamp only', () => {
    expect(ErasureLifecycle.begin(STARTED)).toEqual({
      erasureStatus: 'ERASING',
      erasureStartedAtUtcMs: STARTED,
    });
  });

  it('complete() keeps when the erasure began, beside when it ended', () => {
    const erasing = ErasureLifecycle.begin(STARTED);
    expect(ErasureLifecycle.complete(erasing, ERASED_AT)).toEqual({
      erasureStatus: 'ERASED',
      erasureStartedAtUtcMs: STARTED,
      erasedAtUtcMs: ERASED_AT,
    });
    // The input slice is read, never written.
    expect(erasing).toEqual({
      erasureStatus: 'ERASING',
      erasureStartedAtUtcMs: STARTED,
    });
  });
});

describe('ErasureLifecycle.isUnderErasure — the guard every writer reads', () => {
  it('only NONE may still be seated or re-created', () => {
    const erasing = ErasureLifecycle.begin(STARTED);
    expect(ErasureLifecycle.isUnderErasure(ErasureLifecycle.none())).toBe(
      false,
    );
    expect(ErasureLifecycle.isUnderErasure(erasing)).toBe(true);
    expect(
      ErasureLifecycle.isUnderErasure(
        ErasureLifecycle.complete(erasing, ERASED_AT),
      ),
    ).toBe(true);
  });
});

describe('ErasureLifecycle.fieldFault — the STRICT read-time check', () => {
  it('admits each well-formed variant (other fields of the body are not its business)', () => {
    const erasing = ErasureLifecycle.begin(STARTED);
    for (const slice of [
      ErasureLifecycle.none(),
      erasing,
      ErasureLifecycle.complete(erasing, ERASED_AT),
      { ...ErasureLifecycle.none(), displayName: '—', phone: null },
    ]) {
      expect(ErasureLifecycle.fieldFault(slice)).toBeNull();
    }
  });

  it('refuses a body WITHOUT the key, naming erasureStatus (absent is not NONE)', () => {
    expect(ErasureLifecycle.fieldFault({})).toBe('erasureStatus');
    expect(ErasureLifecycle.fieldFault({ displayName: 'Maria' })).toBe(
      'erasureStatus',
    );
  });

  it.each([
    ['a foreign tag', 'DELETED'],
    ['the lower-case spelling', 'erased'],
    ['null', null],
    ['a number', 0],
    ['a boolean', true],
  ])('refuses %s as erasureStatus', (_what, value) => {
    expect(ErasureLifecycle.fieldFault({ erasureStatus: value })).toBe(
      'erasureStatus',
    );
  });

  it.each([
    [
      'ERASING without its start',
      { erasureStatus: 'ERASING' },
      'erasureStartedAtUtcMs',
    ],
    [
      'ERASING with a text start',
      { erasureStatus: 'ERASING', erasureStartedAtUtcMs: '2026-10-27' },
      'erasureStartedAtUtcMs',
    ],
    [
      'ERASING with a fractional start',
      { erasureStatus: 'ERASING', erasureStartedAtUtcMs: 1.5 },
      'erasureStartedAtUtcMs',
    ],
    [
      'ERASED without its start',
      { erasureStatus: 'ERASED', erasedAtUtcMs: ERASED_AT },
      'erasureStartedAtUtcMs',
    ],
    [
      'ERASED without its end',
      { erasureStatus: 'ERASED', erasureStartedAtUtcMs: STARTED },
      'erasedAtUtcMs',
    ],
    [
      'ERASED with a null end',
      {
        erasureStatus: 'ERASED',
        erasureStartedAtUtcMs: STARTED,
        erasedAtUtcMs: null,
      },
      'erasedAtUtcMs',
    ],
  ])('refuses %s, naming the stamp', (_what, slice, reason) => {
    expect(ErasureLifecycle.fieldFault(slice)).toBe(reason);
  });
});
