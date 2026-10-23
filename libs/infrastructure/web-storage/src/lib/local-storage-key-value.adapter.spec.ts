import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryErrorCode } from '@core/errors';
import { unwrapErr, unwrapOk } from '@core/testing';
import { localStorageKeyValuePorts } from './local-storage-key-value.adapter';

describe('localStorageKeyValuePorts', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for a key that was never set', () => {
    expect(unwrapOk(localStorageKeyValuePorts().kvGet('missing'))).toBeNull();
  });

  it('round-trips a value through set/get — in localStorage, across sessions', () => {
    const ports = localStorageKeyValuePorts();

    expect(ports.kvSet('theme', 'dark').ok).toBe(true);

    expect(unwrapOk(ports.kvGet('theme'))).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(sessionStorage.getItem('theme')).toBeNull();
  });

  it('removes a value', () => {
    const ports = localStorageKeyValuePorts();
    ports.kvSet('theme', 'dark');

    expect(ports.kvRemove('theme').ok).toBe(true);

    expect(unwrapOk(ports.kvGet('theme'))).toBeNull();
  });

  it('wraps a thrown setItem error (e.g. quota exceeded) in a failed Result naming the key', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    const failure = unwrapErr(
      localStorageKeyValuePorts().kvSet('theme', 'dark'),
    );

    expect(failure).toEqual({
      errorCode: RepositoryErrorCode.WriteFailed,
      path: 'theme',
      reason: 'QuotaExceededError',
    });
  });

  it('wraps a thrown getItem error in a failed Result', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });

    expect(unwrapErr(localStorageKeyValuePorts().kvGet('theme'))).toEqual({
      errorCode: RepositoryErrorCode.ReadFailed,
      path: 'theme',
      reason: 'boom',
    });
  });

  it('wraps a thrown removeItem error in a failed Result', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('boom');
    });

    expect(
      unwrapErr(localStorageKeyValuePorts().kvRemove('theme')).errorCode,
    ).toBe(RepositoryErrorCode.WriteFailed);
  });
});
