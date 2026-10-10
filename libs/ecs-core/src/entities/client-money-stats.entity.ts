import type {
  ClientMoneyStats,
  ClientStatsMeta,
} from '../components/client-stats.data';

/**
 * The document id under `clientStats/{uid}/restricted/` — a brand like every
 * entity id, so a uid or another document's id cannot stand in for it.
 */
export type ClientMoneyStatsId = string & { readonly __brand: unique symbol };
export const ClientMoneyStatsId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): ClientMoneyStatsId => raw as ClientMoneyStatsId,
  /**
   * The one document id there is (`CLIENT_MONEY_DOC`,
   * `client-stats-document.ts:33`) — `restricted/` holds nothing else.
   */
  FIXED: 'money',
} as const;

/**
 * `clientStats/{uid}/restricted/money` — lifetime spend, admin-only because
 * rules cannot hide a field (R33). Declared change (blueprint §2.6): the flat
 * `lifetimeSpendMinor` + `currencyCode` nest as `lifetimeSpend: Money`.
 *
 * It also carries the `version`/`updatedAtMs` bookkeeping it is stored with
 * today (`ClientMoneyRecord`, `client-stats-document.ts:46`): the two
 * documents move together at ONE version, and the revision guard
 * (`planClientStatsWrite`) rewrites a pair whose versions disagree — so the
 * money document's version is load-bearing.
 */
export type ClientMoneyStatsEntity = ClientMoneyStats &
  ClientStatsMeta & {
    readonly id: ClientMoneyStatsId;
  };
