import type { CustomerId } from '@core/primitives';

/*
 * Split out of `client-stats.data.ts` (pass D, S-21; one name per file,
 * L-1). A type-only component: no companion, nothing to put in one.
 */

/**
 * Whose projection a stored pair is — the CLIENT RECORD (D29, flatten-spec
 * §5.4: whom the shop served), repeated in both bodies beside the document
 * id (`clientStats/{customerId}` and its `restricted/money`), written by
 * the revision guard (`ClientStatsSystem.planWrite`).
 */
export type ClientStatsKey = {
  readonly customerId: CustomerId;
};
