import { InjectionToken } from '@angular/core';

/**
 * Produces a fresh opaque identifier string — the one seam every branded
 * `XId.create(raw)` factory is fed through instead of calling
 * `crypto.randomUUID()` directly, so use-cases stay deterministic and
 * replayable under test. Intentionally untyped past `string`: there is no
 * one domain concept here, just a source of fresh unique values that
 * immediately cross into a VO factory at each call site.
 */
export interface IdGenerator {
  next(): string;
}

export const ID_GENERATOR = new InjectionToken<IdGenerator>('IdGenerator');
