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
  CustomerId,
  JournalEntryId,
  LocalDate,
  UtcEpochMs,
} from '@core/primitives';

/**
 * The entry's identity slice: the id, the client record, the order and the
 * instant, the bookkeeping, and the client-visible label — every 1-to-1
 * field at the root (Law 6). `utcEpochMs` + `localDate` are the entry's
 * instant and its shop day, written together from one reading (T5: the
 * ledger buckets an entry by the stored day, never re-bucketing the
 * instant); `labelCode` + `labelParams` the client-visible copy;
 * `journalVisibility` who may read it. `customerId` is the client RECORD
 * the entry rewarded (D29); WHO acted is the `Actor` slice's `actor*`
 * account ids — two fields, two values, never derived one from the other.
 */
export type JournalEntryMeta = {
  readonly id: JournalEntryId;
  readonly customerId: CustomerId;
  readonly seq: number;
  readonly utcEpochMs: UtcEpochMs;
  readonly localDate: LocalDate;
  /** The entry this one compensates; a reversal is never itself reversed. */
  readonly reverses: JournalEntryId | null;
  /** Entries of one event share it: a visit's seats, a level and its bonus, a redemption and its grant. */
  readonly correlationId: CorrelationId;
  /** The loyalty engine's exactly-once key (§9 D14) — opaque, never parsed. */
  readonly idempotencyKey: string;
  readonly journalVisibility: JournalVisibility;
  readonly labelCode: LabelCode;
  /** 1-to-N: the label's named parameters, in the order they were written. */
  readonly labelParams: readonly LabelParam[];
  readonly balanceAfter: number;
  /** The visit the entry is about, where it is about one. */
  readonly appointmentId: AppointmentId | null;
};

/**
 * `clientJournal/{customerId}_{seq:06}` (`JournalEntryId.forEntry`) —
 * append-only, never updated; the source every loyalty projection is folded
 * from. `seq` is dense per client record; `balanceAfter` the balance once
 * this entry is folded in. The activity feed and the ledger read
 * `journalVisibility == 'CLIENT'` rows of the pill's effects
 * (`JournalFeed.effectsOf`, index #21: `customerId`, `journalVisibility`,
 * `journalEffect`, `seq` desc); the label carries a copy key and
 * non-personal params, never a note or a name.
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
