import {
  type LocalizedText,
  type PartyMember,
  SeatKey,
} from '@core/components';
import type { Barber } from '@core/entities';
import type { BarberId, SeatKeyText } from '@core/primitives';

/*
 * THE PEOPLE OF A BOOKING, AS ITS STEPS NAME THEM (pass D, I-34) — the one
 * `barberName`/`personLabel` the review step, the time sheet and the
 * confirmation each kept a copy of. Pure wording (Law 10.4): the catalogue's
 * barbers, the party's guests and the words arrive as inputs; nothing here
 * reads a signal, a session or a catalogue of its own.
 */

/** The booker's own cart seat key — `'self'` (`SeatKey.text(SeatKey.self())`). */
export const BOOKER_SEAT: SeatKeyText = SeatKey.text(SeatKey.self());

/**
 * How a step words a catalogue name in the active language — the catalogue
 * wording's own `text` (`CatalogWording.text`), handed in so the one
 * language rule stays where it lives.
 */
export type CatalogNameWords = (name: LocalizedText) => string;

/**
 * A barber as the steps name them: the catalogue's name in the active
 * language, else the bare id (a barber the active list no longer holds is
 * still somebody the booking names).
 */
export function barberNameOf(
  barbers: readonly Barber[],
  barberId: BarberId,
  words: CatalogNameWords,
): string {
  for (const barber of barbers) {
    if (barber.id === barberId) return words(barber.name);
  }
  return barberId;
}

/**
 * The booker by NAME once it is known — three steps said "You" to a
 * signed-in user whose name was sitting in the session the whole time
 * (owner ruling 2026-07-31). "You" is the fallback, not the rule.
 */
export function bookerLabelOf(displayName: string, you: string): string {
  return displayName || you;
}

/**
 * A cart seat key (`SeatKey.text`) as a person: the booker's own seat is
 * `booker` ({@link bookerLabelOf}); a guest's seat is the guest's label; any
 * other key — a companion's, or a guest the party no longer holds — reads
 * as the key itself.
 */
export function personLabelOf(
  seatKey: SeatKeyText,
  guests: readonly PartyMember.Guest[],
  booker: string,
): string {
  if (seatKey === BOOKER_SEAT) return booker;
  // A guest's seat key IS their minted id (`SeatKey.text(SeatKey.guest(id))`);
  // the key read as the plain text both spell.
  const key: string = seatKey;
  for (const guest of guests) {
    if (guest.guestId === key) return guest.guestLabel;
  }
  return seatKey;
}
