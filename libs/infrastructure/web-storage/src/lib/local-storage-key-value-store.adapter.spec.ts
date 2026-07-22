import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageKeyValueStore } from './local-storage-key-value-store.adapter';

describe('LocalStorageKeyValueStore', () => {
  let store: LocalStorageKeyValueStore;

  beforeEach(() => {
    localStorage.clear();
    store = new LocalStorageKeyValueStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for a key that was never set', () => {
    const result = store.get('missing');
    expect(result.isSuccess()).toBe(true);
    expect(result.isSuccess() && result.value).toBeNull();
  });

  it('round-trips a value through set/get', () => {
    expect(store.set('theme', 'dark').isSuccess()).toBe(true);
    const result = store.get('theme');
    expect(result.isSuccess()).toBe(true);
    expect(result.isSuccess() && result.value).toBe('dark');
  });

  it('removes a value', () => {
    store.set('theme', 'dark');
    expect(store.remove('theme').isSuccess()).toBe(true);
    const result = store.get('theme');
    expect(result.isSuccess() && result.value).toBeNull();
  });

  it('wraps a thrown setItem error (e.g. quota exceeded) in a failed Result', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    const result = store.set('theme', 'dark');
    expect(result.isFailure()).toBe(true);
    expect(result.isFailure() && result.error.message).toContain('theme');
    expect(result.isFailure() && result.error.cause).toBeInstanceOf(
      DOMException,
    );
  });

  it('wraps a thrown getItem error in a failed Result', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });

    const result = store.get('theme');
    expect(result.isFailure()).toBe(true);
  });

  it('wraps a thrown removeItem error in a failed Result', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('boom');
    });

    const result = store.remove('theme');
    expect(result.isFailure()).toBe(true);
  });
});
