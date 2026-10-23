/**
 * The wallet's discs under the pass (client-card-revision-3 §2.2.3), in
 * their drawing order — the ONLY source of these strings (Law 1, Law 6.2):
 * «Използвай» a held reward on this visit, «Код» a code, «Награди» the
 * points catalogue, «История» the ledger. `WalletSystem.actions` decides
 * which discs stand; the presenter's one table words each (its id, glyph,
 * label and prominence). A disc that cannot be used is absent, never a
 * fifth tag.
 */
export const WalletAction = {
  Use: 'USE',
  Code: 'CODE',
  Catalog: 'CATALOG',
  History: 'HISTORY',
} as const;
export type WalletAction = (typeof WalletAction)[keyof typeof WalletAction];
