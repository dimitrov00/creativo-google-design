import { BarberId } from '../entities/barber.entity';
import { DayKey } from './day-key.data';

/** The separator — a DOUBLE underscore, split at its LAST occurrence. */
const SEPARATOR = '__';

/**
 * `${barberId}__${dayKey}` — the id of a barber's day: the `barberBusy`
 * document, the `scheduleExceptions` document and each entry of
 * `appointments.busyKeys`, all at once (`appointment-document.ts:1145`,
 * `decide-booking.ts:340`). The commit transaction reads the busy and the
 * exception document by the SAME key, so a mis-spelt key is an empty read set
 * and a reopened double-booking race: {@link BusyKey.of} is the ONLY place
 * that builds one — pipelines, the seed and the e2e seed included.
 */
export type BusyKey = string & { readonly __brand: unique symbol };

export const BusyKey = {
  /** The only builder (and the only cast site). */
  of(barberId: BarberId, dayKey: DayKey): BusyKey {
    return `${barberId}${SEPARATOR}${dayKey}` as BusyKey;
  },

  /**
   * The two halves, split at the LAST `__` (`rebuild-busy.ts:77`) — a barber
   * id may itself contain `__`, a day key never does.
   */
  split(key: BusyKey): BusyKey.Parts {
    const at = key.lastIndexOf(SEPARATOR);
    return {
      barberId: BarberId.of(key.slice(0, at)),
      dayKey: DayKey.of(key.slice(at + SEPARATOR.length)),
    };
  },

  /**
   * The edge guard for a raw document id or stored array entry: a non-empty
   * barber id, the double underscore and a real calendar day — rebuilt through
   * {@link of}, so a parsed key is spelt exactly as a built one. `null` when
   * the raw string is not a busy key.
   */
  parse(raw: string): BusyKey | null {
    const at = raw.lastIndexOf(SEPARATOR);
    if (at <= 0) return null;
    const dayKey = raw.slice(at + SEPARATOR.length);
    if (!DayKey.isValid(dayKey)) return null;
    return BusyKey.of(BarberId.of(raw.slice(0, at)), DayKey.of(dayKey));
  },
} as const;

export namespace BusyKey {
  /** What {@link BusyKey.split} returns. */
  export type Parts = {
    readonly barberId: BarberId;
    readonly dayKey: DayKey;
  };
}
