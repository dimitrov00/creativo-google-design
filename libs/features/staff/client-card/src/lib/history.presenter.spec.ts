import { describe, expect, it } from 'vitest';
import type { ClientStatsRecord } from '@core/entities';
import { historyFacts, historyRows } from './history.presenter';
import {
  GEORGI,
  GEORGI_CUSTOMER_ID,
  GEORGI_MONEY,
  MARTIN,
  NBSP_EURO,
  NOW_MS,
  SHOP_CATALOG,
  georgiHistory,
  martinHistory,
  statsOf,
  wordsOf,
} from '../testing/client-card.fixtures';

const WORDS = wordsOf('bg');
const GEORGI_BOOK = georgiHistory();
const GEORGI_STATS = statsOf(GEORGI, GEORGI_BOOK);
const MARTIN_STATS = statsOf(MARTIN, martinHistory());

/** The record with some lifetime counts changed (the flat `lifetime*` fields, Law 6). */
function withLifetime(
  stats: ClientStatsRecord,
  lifetime: Partial<
    Pick<ClientStatsRecord, 'lifetimeClientCancels' | 'lifetimeNoShows'>
  >,
): ClientStatsRecord {
  return { ...stats, ...lifetime };
}

describe('the footnote', () => {
  it('says a clean record in words, and the ‹admin› spend in money', () => {
    expect(historyFacts(GEORGI_STATS, GEORGI_MONEY, WORDS)).toEqual({
      note: 'Без неявявания и откази от клиента',
      spend: {
        value: NBSP_EURO('462,50 €'),
        sentence: NBSP_EURO('Похарчени общо 462,50 €'),
      },
    });
  });

  it('names the client’s cancellations only, so a shop’s struck row below never contradicts it', () => {
    // Мартин's one cancellation was the shop's (Нико away): the row shows
    // struck in the list, and the zero line says whose it counts (R35).
    expect(historyFacts(MARTIN_STATS, null, WORDS).note).toBe(
      'Без неявявания и откази от клиента',
    );
    expect(
      historyFacts(
        withLifetime(GEORGI_STATS, { lifetimeClientCancels: 1 }),
        null,
        WORDS,
      ).note,
    ).toBeNull();
  });

  it('says nothing about a record with a no-show, and «Първо посещение» before the first visit', () => {
    expect(
      historyFacts(
        withLifetime(GEORGI_STATS, { lifetimeNoShows: 1 }),
        null,
        WORDS,
      ),
    ).toEqual({ note: null, spend: null });
    expect(historyFacts(null, null, WORDS).note).toBe('Първо посещение');
  });
});

describe('the rows and the year sections', () => {
  it('counts each visit once, however the pages overlap', () => {
    const rows = historyRows({
      appointments: [...GEORGI_BOOK, ...GEORGI_BOOK.slice(0, 3)],
      subjectUserId: GEORGI,
      subjectCustomerId: GEORGI_CUSTOMER_ID,
      currentAppointmentId: 'appt-dev-1',
      nowMs: NOW_MS,
      photoCounts: new Map(),
      clientWords: true,
      catalog: SHOP_CATALOG,
      words: WORDS,
    });
    expect(rows).toHaveLength(GEORGI_BOOK.length);
  });
});
