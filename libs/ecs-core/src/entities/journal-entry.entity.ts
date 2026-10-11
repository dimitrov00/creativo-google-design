import type { Actor } from '../components/actor.data';
import type {
  JournalEffectRecord,
  JournalVisibility,
  LabelCode,
  LabelParam,
} from '../components/journal-effect.data';
import type { JournalSourceRecord } from '../components/journal-source.data';
import type {
  AppointmentId,
  CorrelationId,
  JournalEntryId,
  UserId,
} from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/*
 * The id lives in `primitives/ids.primitive.ts` (flatten-spec §1.5), with
 * its `forEntry(userId, seq)`; it is re-exported here only while the
 * barrel's staging block still names this file (`index.ts`), and leaves
 * with that line.
 */

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
