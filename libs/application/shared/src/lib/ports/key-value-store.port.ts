import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import { KeyValueStoreError } from './key-value-store.errors';

/**
 * Generic synchronous string storage (theme preference, locale, session
 * drafts) — mirrors the browser `Storage` interface deliberately: keys and
 * values here are opaque persistence slots, not a domain concept, so plain
 * `string` is the right type, never a branded VO. Adapters (Goal 04) back
 * this with `localStorage`/`sessionStorage`.
 */
export interface KeyValueStore {
  get(key: string): Result<string | null, KeyValueStoreError>;
  set(key: string, value: string): Result<void, KeyValueStoreError>;
  remove(key: string): Result<void, KeyValueStoreError>;
}

export const KEY_VALUE_STORE = new InjectionToken<KeyValueStore>(
  'KeyValueStore',
);
