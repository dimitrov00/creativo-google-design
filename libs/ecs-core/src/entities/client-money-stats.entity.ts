import type { ClientMoneyStats, ClientStatsMeta } from '@core/components';
import type { ClientMoneyStatsId } from '@core/primitives';

/**
 * `clientStats/{uid}/restricted/money` — lifetime spend, admin-only because
 * rules cannot hide a field (R33): the flat spend slice beside the
 * bookkeeping it is stored with (`client-stats-document.ts:46`). The two
 * documents move together at ONE version, and the revision guard
 * (`ClientStatsSystem.planWrite`) rewrites a pair whose versions disagree —
 * so this document's version is load-bearing.
 *
 * Named `ClientMoneyRecord` (F-17): `ClientMoneyStats` is the slice. The
 * id is `ClientMoneyStatsId.FIXED` — `restricted/` holds nothing else.
 */
export type ClientMoneyRecord = ClientMoneyStats &
  ClientStatsMeta & {
    readonly id: ClientMoneyStatsId;
  };
