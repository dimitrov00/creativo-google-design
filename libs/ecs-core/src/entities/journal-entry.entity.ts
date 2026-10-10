import type { JournalActor } from '../components/journal-actor.data';
import type {
  JournalEffect,
  JournalVisibility,
  PublicLabel,
} from '../components/journal-effect.data';
import type { JournalSource } from '../components/journal-source.data';
import type { AppointmentId } from './appointment.entity';
import type { UserId } from './user.entity';

export type JournalEntryId = string & { readonly __brand: unique symbol };
export const JournalEntryId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): JournalEntryId => raw as JournalEntryId,

  /**
   * The id of a client's `seq`-th entry: `${userId}_${seq:06}`
   * (`clientJournalEntryId`, `loyalty-document.ts:139-141`,
   * `firestore.rules:377`) — the zero padding is what makes document ids
   * sort as the ledger does.
   */
  forEntry: (userId: UserId, seq: number): JournalEntryId =>
    JournalEntryId.of(`${userId}_${String(seq).padStart(6, '0')}`),
} as const;

/**
 * `clientJournal/{userId}_{seq:06}` — append-only, never updated; the source
 * every loyalty projection is folded from. `seq` is dense per client;
 * `balanceAfter` the balance once this entry is folded in. The ledger reads
 * `visibility == 'client'` point rows only; the label carries a copy key
 * and non-personal params, never a note or a name.
 *
 * The stored body of `loyalty-document.ts:745-762`: `at` → `atMs`, the
 * label's open `params` map → `LabelParam[]` (§3.2), and ONE declared new
 * field, `appointmentId` (today parsed back out of `correlationId` by
 * `ledger.presenter.ts:90-91`).
 */
export type JournalEntryEntity = {
  readonly id: JournalEntryId;
  readonly userId: UserId;
  readonly seq: number;
  readonly atMs: number;
  readonly effect: JournalEffect;
  readonly source: JournalSource;
  readonly actor: JournalActor;
  /** The entry this one compensates; a reversal is never itself reversed. */
  readonly reverses: JournalEntryId | null;
  /** Entries of one event share it: a visit's seats, a level and its bonus, a redemption and its grant. */
  readonly correlationId: string;
  /** The loyalty engine's exactly-once key (§9 D14). */
  readonly idempotencyKey: string;
  readonly visibility: JournalVisibility;
  readonly publicLabel: PublicLabel;
  readonly balanceAfter: number;
  /** The visit the entry is about, where it is about one. */
  readonly appointmentId: AppointmentId | null;
};
