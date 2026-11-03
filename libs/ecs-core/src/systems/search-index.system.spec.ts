import { describe, expect, it } from 'vitest';
import { BookingStatus } from '@core/primitives';
import { BookingContact, E164, Email } from '@core/components';
import {
  SEARCH_LABELS,
  appointmentFixture,
  deepFreeze,
  localDate,
  seatFixture,
  unwrapOk,
} from '@core/testing';
import { BarberId, ServiceId } from '@core/primitives';
import { SearchIndexSystem } from './search-index.system';

const NIKO = BarberId.of('b-niko');
const FADE = ServiceId.of('svc-fade');

const visit = appointmentFixture({
  ...BookingContact.NONE,
  contactName: 'Георги ПЕТРОВ',
  contactPhone: unwrapOk(E164.parse('+359887778899')),
  contactEmail: Email.of('Georgi@Mail.bg'),
  contactNote: 'Алергия',
  barberIds: [NIKO],
  seats: [seatFixture({ barberId: NIKO, serviceId: FADE })],
  localDate: localDate('2026-08-06'),
});

describe('SearchIndexSystem.build — the window folded once', () => {
  const index = SearchIndexSystem.build([visit], SEARCH_LABELS);

  it('folds every text field, case and all', () => {
    expect(index.visitCount).toBe(1);
    expect(index.clientText).toEqual(['георги петров']);
    expect(index.serviceText).toEqual(['фейд']);
    expect(index.barberText).toEqual(['нико']);
    expect(index.emailText).toEqual(['georgi@mail.bg']);
    expect(index.noteText).toEqual(['алергия']);
  });

  it('holds the number as digits alone, and the structure as is', () => {
    expect(index.phoneDigits).toEqual(['359887778899']);
    expect(index.barberIds).toEqual([[NIKO]]);
    expect(index.serviceIds).toEqual([[FADE]]);
    expect(index.bookingStatus).toEqual([BookingStatus.Confirmed]);
    expect(index.localDate).toEqual(['2026-08-06']);
    expect(index.hasNote).toEqual([true]);
  });

  it('holds an empty string for what a visit lacks', () => {
    const bare = SearchIndexSystem.build(
      [appointmentFixture({ ...BookingContact.NONE })],
      { ...SEARCH_LABELS, clientNames: () => [] },
    );
    expect(bare.clientText).toEqual(['']);
    expect(bare.phoneDigits).toEqual(['']);
    expect(bare.emailText).toEqual(['']);
    expect(bare.noteText).toEqual(['']);
    expect(bare.hasNote).toEqual([false]);
  });

  it('joins several names of one visit and counts a service once', () => {
    const party = SearchIndexSystem.build(
      [
        appointmentFixture({
          ...BookingContact.NONE,
          seats: [seatFixture(), seatFixture()],
        }),
      ],
      { ...SEARCH_LABELS, clientNames: () => ['Ани', 'Борис'] },
    );
    expect(party.clientText).toEqual(['ани\nборис']);
    expect(party.serviceIds[0]).toHaveLength(1);
  });

  it('keeps the columns the same length, and the window untouched', () => {
    const frozen = deepFreeze([visit, visit]);
    const two = SearchIndexSystem.build(frozen, SEARCH_LABELS);
    expect(two.clientText).toHaveLength(2);
    expect(two.localDate).toHaveLength(2);
    expect(SearchIndexSystem.build(frozen, SEARCH_LABELS)).toEqual(two);
  });
});
