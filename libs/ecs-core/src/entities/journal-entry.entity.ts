import type {
  Actor,
  JournalEffectRecord,
  JournalVisibility,
  LabelCode,
  LabelParam,
  JournalSourceRecord,
} from '@core/components';
import type {
  AppointmentId,
  CorrelationId,
  JournalEntryId,
  UserId,
  LocalDate,
  UtcEpochMs,
} from '@core/primitives';

/**
 * The entry's identity slice: the id, the client, the order and the
 * instant, the bookkeeping, and the client-visible label — every 1-to-1
 * field at the root (Law 6). `utcEpochMs` + `localDate` were `atMs` (T5:
 * the ledger buckets an entry by its shop day, written from the same
 * `ShopNow`); `labelCode` + `labelParams` were `publicLabel`;
 * `journalVisibility` was `visibility` (N15). `userId` keeps its `UserId`
 * until the loyalty flip (3) re-keys the journal (D29, §5.5).
 */
export type JournalEntryMeta = {
  readonly id: JournalEntryId;
  readonly userId: UserId;
  readonly seq: number;
  readonly utcEpochMs: UtcEpochMs;
  readonly localDate: LocalDate;
  /** The entry this one compensates; a reversal is never itself reversed. */
  readonly reverses: JournalEntryId | null;
  /** Entries of one event share it: a visit's seats, a level and its bonus, a redemption and its grant. */
  readonly correlationId: CorrelationId;
  /** The loyalty engine's exactly-once key (§9 D14). */
  readonly idempotencyKey: string;
  readonly journalVisibility: JournalVisibility;
  readonly labelCode: LabelCode;
  /** 1-to-N: the label's named parameters. */
  readonly labelParams: readonly LabelParam[];
  readonly balanceAfter: number;
  /** The visit the entry is about, where it is about one. */
  readonly appointmentId: AppointmentId | null;
};

/**
 * `clientJournal/{userId}_{seq:06}` — append-only, never updated; the source
 * every loyalty projection is folded from. `seq` is dense per client;
 * `balanceAfter` the balance once this entry is folded in. The ledger reads
 * `journalVisibility == 'CLIENT'` point rows only; the label carries a copy
 * key and non-personal params, never a note or a name.
 *
 * The archetype (Law 6): the identity slice, who wrote it (the `Actor`
 * slice, `actor*`), why (the `JournalSourceRecord` slice, `source*`) and
 * what it changed (the `JournalEffectRecord` slice, prefixed per effect) —
 * four slices with disjoint field names.
 */
export type JournalEntry = JournalEntryMeta &
  Actor &
  JournalSourceRecord &
  JournalEffectRecord;
