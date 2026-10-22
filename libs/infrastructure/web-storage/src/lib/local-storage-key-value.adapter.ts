import { RepositoryError, Result } from '@core/primitives';
import type { KeyValuePorts } from '@core/ports';
import { storageReason } from './storage-reason';

/**
 * Per-device preferences in `localStorage` — `KEY_VALUE_PORTS` (Phase 4a
 * §3.10; the closure successor of the retired key-value class): the theme and
 * locale preference and any other cross-session slot. Keys and values are
 * opaque strings; this adapter's only job is to fold `localStorage`'s thrown
 * exceptions (Safari private-mode quota errors, disabled storage) into a failed
 * `Result` naming the key, never an uncaught throw.
 */
export const localStorageKeyValuePorts = (): KeyValuePorts => ({
  kvGet: (key) => {
    try {
      return Result.ok(localStorage.getItem(key));
    } catch (cause) {
      return Result.err(RepositoryError.readFailed(key, storageReason(cause)));
    }
  },

  kvSet: (key, value) => {
    try {
      localStorage.setItem(key, value);
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(RepositoryError.writeFailed(key, storageReason(cause)));
    }
  },

  kvRemove: (key) => {
    try {
      localStorage.removeItem(key);
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(RepositoryError.writeFailed(key, storageReason(cause)));
    }
  },
});
