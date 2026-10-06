import { describe, expect, it } from 'vitest';
import { UserId } from '@creativo/domain/accounts';
import { AppointmentId } from '@creativo/domain/scheduling';
import { RepositoryError } from '@creativo/application/shared';
import * as production from '../../index';
import { InMemoryClientStatsDirectory } from '../../testing';
import {
  CLIENT_STATS_DIRECTORY,
  type ClientStatsPage,
} from './client-stats-directory.port';
import type { ClientStatsRecord } from './client-stats-document';

function must<T>(result: { isSuccess(): boolean; value?: T }): T {
  if (!result.isSuccess()) throw new Error('bad fixture');
  return result.value as T;
}

/** A client's statistics with `visits` worked visits, a month apart, the last on 28.09.2026. */
function stats(userId: string, visits: number): ClientStatsRecord {
  const last = Date.parse('2026-09-28T07:00:00.000Z');
  const facts = Array.from({ length: visits }, (_, i) => ({
    appointmentId: must<AppointmentId>(
      AppointmentId.create(`appt-${userId}-${i + 1}`),
    ),
    atMs: last - (visits - 1 - i) * 30 * 86_400_000,
  }));
  return {
    userId: must<UserId>(UserId.create(userId)),
    lifetime: {
      visitsCompleted: visits,
      noShows: 0,
      lateCancels: 0,
      clientCancels: 0,
    },
    last365: { visitsCompleted: facts, noShows: [], lateCancels: [] },
    firstVisitAtMs: facts[0]?.atMs ?? null,
    lastVisit: null,
    nextVisit: null,
    avgCadenceDays: visits >= 3 ? 30 : null,
    preferredBarberId: null,
    usualServiceIds: [],
    pauseSuggestion: null,
    version: 1,
    updatedAtMs: last,
  };
}

const ids = (page: ClientStatsPage) =>
  page.records.map((record) => record.userId.value);

/** Every page until nobody is left, as the preview walks them. */
async function walk(
  directory: InMemoryClientStatsDirectory,
  limit: number,
): Promise<readonly ClientStatsPage[]> {
  const pages: ClientStatsPage[] = [];
  let after: string | null = null;
  do {
    const page = await directory.page(limit, after);
    if (page.isFailure()) throw page.error;
    pages.push(page.value);
    after = page.value.next;
  } while (after !== null);
  return pages;
}

/**
 * The port's reference (`@creativo/application/booking/testing`), held to
 * the port's promises, the ones the Firestore adapter keeps too: the
 * shop's clients in the order of their ids, a page at a time, a cursor
 * only while somebody is left.
 */
describe('ClientStatsDirectory — the in-memory reference', () => {
  // Handed over out of order: the directory's order is its own.
  const clients = [
    stats('dev-client-3', 1),
    stats('dev-client-1', 12),
    stats('dev-client-5', 0),
    stats('dev-client-2', 9),
    stats('dev-client-4', 3),
  ];

  it('names its token', () => {
    expect(CLIENT_STATS_DIRECTORY.toString()).toContain('ClientStatsDirectory');
  });

  it('is on the production barrel, its reference is not', () => {
    expect(production.CLIENT_STATS_DIRECTORY).toBe(CLIENT_STATS_DIRECTORY);
    expect(Object.keys(production)).not.toContain(
      'InMemoryClientStatsDirectory',
    );
  });

  it('reads the clients in the order of their ids, whole', async () => {
    const directory = new InMemoryClientStatsDirectory(clients);
    const page = await directory.page(200, null);
    if (page.isFailure()) throw page.error;
    expect(ids(page.value)).toEqual([
      'dev-client-1',
      'dev-client-2',
      'dev-client-3',
      'dev-client-4',
      'dev-client-5',
    ]);
    expect(page.value.next).toBeNull();
    expect(page.value.records[0]).toBe(clients[1]);
    expect(page.value.records[0]?.last365.visitsCompleted).toHaveLength(12);
  });

  it('pages strictly after the cursor, until nobody is left', async () => {
    const directory = new InMemoryClientStatsDirectory(clients);
    const pages = await walk(directory, 2);
    expect(pages.map(ids)).toEqual([
      ['dev-client-1', 'dev-client-2'],
      ['dev-client-3', 'dev-client-4'],
      ['dev-client-5'],
    ]);
    expect(pages.map((page) => page.next)).toEqual([
      'dev-client-2',
      'dev-client-4',
      null,
    ]);
    expect(directory.calls).toEqual([
      { limit: 2, after: null },
      { limit: 2, after: 'dev-client-2' },
      { limit: 2, after: 'dev-client-4' },
    ]);
  });

  it('gives no cursor when a page ends exactly on the last client', async () => {
    const directory = new InMemoryClientStatsDirectory(clients);
    const page = await directory.page(5, null);
    expect(page.isSuccess() && page.value.next).toBeNull();
    const pages = await walk(new InMemoryClientStatsDirectory(clients), 5);
    expect(pages).toHaveLength(1);
  });

  it('reads on from a cursor that names nobody', async () => {
    const directory = new InMemoryClientStatsDirectory(clients);
    const page = await directory.page(2, 'dev-client-2x');
    expect(page.isSuccess() && ids(page.value)).toEqual([
      'dev-client-3',
      'dev-client-4',
    ]);
    const past = await directory.page(2, 'zzz');
    expect(past.isSuccess() && past.value).toEqual({ records: [], next: null });
  });

  it('holds one record per client: the one listed last', async () => {
    const newer = stats('dev-client-1', 13);
    const directory = new InMemoryClientStatsDirectory([...clients, newer]);
    const page = await directory.page(200, null);
    if (page.isFailure()) throw page.error;
    expect(ids(page.value)).toHaveLength(5);
    expect(page.value.records[0]).toBe(newer);
  });

  it('reads a page of one for a limit that is none', async () => {
    const directory = new InMemoryClientStatsDirectory(clients);
    const page = await directory.page(0, null);
    expect(page.isSuccess() && ids(page.value)).toEqual(['dev-client-1']);
    expect(page.isSuccess() && page.value.next).toBe('dev-client-1');
  });

  it('reads nothing from a shop with no client', async () => {
    const page = await new InMemoryClientStatsDirectory().page(200, null);
    expect(page.isSuccess() && page.value).toEqual({ records: [], next: null });
  });

  it('fails while told to, and reads again once recovered', async () => {
    const directory = new InMemoryClientStatsDirectory(clients).failWith();
    const failed = await directory.page(200, null);
    expect(failed.isFailure() && failed.error).toBeInstanceOf(RepositoryError);
    directory.recover();
    expect((await directory.page(200, null)).isSuccess()).toBe(true);
    expect(directory.calls).toHaveLength(2);
  });
});
