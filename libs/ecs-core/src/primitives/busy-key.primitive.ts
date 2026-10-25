import type { Brand } from './brand';
import { defect } from './defect';
import { BarberId } from './ids.primitive';
import { LocalDate } from './local-date.primitive';

/** The separator — a DOUBLE underscore, split at its LAST occurrence. */
const SEPARATOR = '__';
/** The text length of the key's day half — `YYYY-MM-DD`. */
const DAY_LENGTH = 10;

/**
 * `${barberId}__${localDate}` — the id of a barber's shop day: the
 * `barberBusy` document, the `scheduleExceptions` document and each entry of
 * `appointments.busyKeys`, all at once. The commit transaction reads the busy
 * and the exception document by the SAME key, so a mis-spelt key is an empty
 * read set and a reopened double-booking race: {@link BusyKey.of} is the ONLY
 * builder — pipelines, the seed and the e2e seed included.
 */
export type BusyKey = Brand<string, 'BusyKey'>;

export const BusyKey = {
  /** The only builder (and the only cast site). */
  of(barberId: BarberId, localDate: LocalDate): BusyKey {
    return `${barberId}${SEPARATOR}${localDate}` as BusyKey;
  },

  /**
   * The two halves, split at the LAST `__` — a barber id may itself contain
   * `__`, a `LocalDate` never does.
   */
  split(key: BusyKey): BusyKey.Parts {
    const at = key.lastIndexOf(SEPARATOR);
    const day = LocalDate.parse(key.slice(at + SEPARATOR.length));
    // A BusyKey is built only by `of` (or `parse`), so its tail is a LocalDate.
    if (!day.ok) return defect(`BusyKey without a LocalDate: ${key}`);
    return { barberId: BarberId.of(key.slice(0, at)), localDate: day.value };
  },

  /**
   * The edge guard for a raw document id or stored array entry: a non-empty
   * barber id, the double underscore and a real calendar day — rebuilt
   * through {@link of}, so a parsed key is spelt exactly as a built one.
   * `null` when the raw string is not a busy key.
   */
  parse(raw: string): BusyKey | null {
    const at = raw.lastIndexOf(SEPARATOR);
    if (at <= 0) return null;
    const day = LocalDate.parse(raw.slice(at + SEPARATOR.length));
    if (!day.ok) return null;
    const barber = BarberId.parse(raw.slice(0, at));
    return barber.ok ? BusyKey.of(barber.value, day.value) : null;
  },

  /**
   * The read-time door (edge hardening D-1): `raw` is a string
   * {@link parse} accepts — `parse(raw) !== null` — read in place: the LAST
   * `__`, a barber id before it (`BarberId.isSpan`: not blank, no `/`) and
   * exactly one real day after it (`LocalDate.isAt`). `false` for every
   * other value. Allocates nothing (no slice, no `Result`, no rebuilt key) —
   * a stored appointment's `busyKeys` and a busy day's id are checked with
   * it per document.
   */
  is(raw: unknown): raw is BusyKey {
    if (typeof raw !== 'string') return false;
    const at = raw.lastIndexOf(SEPARATOR);
    const dayAt = at + SEPARATOR.length;
    return (
      at > 0 &&
      raw.length - dayAt === DAY_LENGTH &&
      LocalDate.isAt(raw, dayAt) &&
      BarberId.isSpan(raw, 0, at)
    );
  },
} as const;

export namespace BusyKey {
  /** What {@link BusyKey.split} returns. */
  export type Parts = {
    readonly barberId: BarberId;
    readonly localDate: LocalDate;
  };
}
