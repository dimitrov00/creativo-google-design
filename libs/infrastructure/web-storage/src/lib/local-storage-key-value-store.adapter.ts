import { Injectable } from '@angular/core';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  KeyValueStore,
  KeyValueStoreError,
} from '@creativo/application/shared';

/**
 * `KeyValueStore` backed by `localStorage` — theme/locale preference and
 * any other cross-session slot. Keys/values are opaque strings (see the
 * port doc comment); this adapter's only job is to fold `localStorage`'s
 * thrown exceptions (Safari private-mode quota errors, disabled storage)
 * into `Result.fail` instead of letting them propagate as uncaught throws.
 */
@Injectable()
export class LocalStorageKeyValueStore implements KeyValueStore {
  get(key: string): Result<string | null, KeyValueStoreError> {
    try {
      return ok(localStorage.getItem(key));
    } catch (error) {
      return fail(new KeyValueStoreError(`Failed to read "${key}"`, error));
    }
  }

  set(key: string, value: string): Result<void, KeyValueStoreError> {
    try {
      localStorage.setItem(key, value);
      return ok(undefined);
    } catch (error) {
      return fail(new KeyValueStoreError(`Failed to write "${key}"`, error));
    }
  }

  remove(key: string): Result<void, KeyValueStoreError> {
    try {
      localStorage.removeItem(key);
      return ok(undefined);
    } catch (error) {
      return fail(new KeyValueStoreError(`Failed to remove "${key}"`, error));
    }
  }
}
