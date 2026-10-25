import { describe, expect, it } from 'vitest';
import {
  type LocalizedText,
  PartyMember,
  SeatKey,
  SeatLabel,
} from '@core/components';
import { BarberId, GuestId, SeatKeyText, UserId } from '@core/primitives';
import { barberFixture } from '@core/testing';
import {
  BOOKER_SEAT,
  barberNameOf,
  bookerLabelOf,
  personLabelOf,
} from './booking-people.words';

/*
 * The one way the booking steps name the people of a booking — the review
 * step, the time sheet and the confirmation used to keep three copies of it.
 */

const IVAN = barberFixture({
  id: BarberId.of('ivan'),
  name: { en: 'Ivan', bg: 'Иван' },
});
const NIKO = barberFixture({
  id: BarberId.of('niko'),
  name: { en: 'Niko', bg: 'Нико' },
});

/** The catalogue wording's rule, in Bulgarian. */
const inBulgarian = (name: LocalizedText): string => name.bg;

const MARIA = PartyMember.guest(GuestId.of('guest-0'), SeatLabel.of('Мария'));
const PETAR = PartyMember.guest(GuestId.of('guest-1'), SeatLabel.of('Петър'));

describe('barberNameOf', () => {
  it('names a barber the catalogue holds in the language it is handed', () => {
    expect(barberNameOf([IVAN, NIKO], BarberId.of('niko'), inBulgarian)).toBe(
      'Нико',
    );
    expect(
      barberNameOf([IVAN, NIKO], BarberId.of('ivan'), (name) => name.en),
    ).toBe('Ivan');
  });

  it('falls back to the bare id for a barber the active list no longer holds', () => {
    expect(barberNameOf([IVAN], BarberId.of('gone'), inBulgarian)).toBe('gone');
  });
});

describe('bookerLabelOf', () => {
  it('names the booker once the name is known, and says “you” until then', () => {
    expect(bookerLabelOf('Димитър Димитров', 'Ти')).toBe('Димитър Димитров');
    expect(bookerLabelOf('', 'Ти')).toBe('Ти');
  });
});

describe('personLabelOf', () => {
  it('is the booker on the booker’s own seat', () => {
    expect(BOOKER_SEAT).toBe(SeatKey.text(SeatKey.self()));
    expect(personLabelOf(BOOKER_SEAT, [MARIA], 'Ти')).toBe('Ти');
  });

  it('is the guest’s label on a guest’s seat', () => {
    expect(
      personLabelOf(
        SeatKey.text(SeatKey.guest(PETAR.guestId)),
        [MARIA, PETAR],
        'Ти',
      ),
    ).toBe('Петър');
  });

  it('reads as the key itself for a seat no guest of the party holds', () => {
    expect(personLabelOf(SeatKeyText.of('guest-9'), [MARIA], 'Ти')).toBe(
      'guest-9',
    );
    const companion = SeatKey.text(SeatKey.companion(UserId.of('son-1')));
    expect(personLabelOf(companion, [MARIA], 'Ти')).toBe('companion-son-1');
  });
});
