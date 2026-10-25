/** Who may read an entry — the entry's field `journalVisibility`; the ledger reads `CLIENT` rows only. */
export const JournalVisibility = {
  Client: 'CLIENT',
  Staff: 'STAFF',
} as const;
export type JournalVisibility =
  (typeof JournalVisibility)[keyof typeof JournalVisibility];
