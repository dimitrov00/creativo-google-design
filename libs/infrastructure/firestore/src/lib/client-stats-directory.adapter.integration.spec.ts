import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import type { ClientStatsPage } from '@creativo/application/booking';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { FirestoreClientStatsDirectory } from './client-stats-directory.adapter';

/** `clientStats/{uid}` as the functions write it, with `visits` worked visits in the last year. */
function stored(userId: string, visits: number): Record<string, unknown> {
  const last = Date.parse('2026-09-28T07:00:00.000Z');
  return {
    userId,
    lifetime: {
      visitsCompleted: visits,
      noShows: 0,
      lateCancels: 0,
      clientCancels: 0,
    },
    last365: {
      visitsCompleted: Array.from({ length: visits }, (_, index) => ({
        appointmentId: `appt-${userId}-${index + 1}`,
        at: new Date(
          last - (visits - 1 - index) * 30 * 86_400_000,
        ).toISOString(),
      })),
      noShows: [],
      lateCancels: [],
    },
    firstVisitAt: null,
    lastVisit: null,
    nextVisit: null,
    avgCadenceDays: visits >= 3 ? 30 : null,
    preferredBarberId: null,
    usualServiceIds: [],
    pauseSuggestion: null,
    version: 1,
    updatedAt: new Date(last).toISOString(),
  };
}

function directoryFor(
  context: RulesTestContext,
): FirestoreClientStatsDirectory {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: modularFirestore(context) },
      FirestoreClientStatsDirectory,
    ],
  });
  return TestBed.inject(FirestoreClientStatsDirectory);
}

const ids = (page: ClientStatsPage) =>
  page.records.map((record) => record.userId.value);

describe('FirestoreClientStatsDirectory (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  async function write(path: string, data: Record<string, unknown>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(modularFirestore(ctx), path), data);
    });
  }

  const as = (role: string) =>
    directoryFor(testEnv.authenticatedContext('staff-1', { roles: [role] }));

  async function walk(limit: number): Promise<ClientStatsPage[]> {
    const directory = as('admin');
    const pages: ClientStatsPage[] = [];
    let after: string | null = null;
    do {
      const page = await directory.page(limit, after);
      if (page.isFailure()) throw page.error;
      pages.push(page.value);
      after = page.value.next;
    } while (after !== null && pages.length < 50);
    return pages;
  }

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv(
      'demo-firestore-client-stats-directory',
    );
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    // Written out of order: the directory's order is the ids'.
    for (const [uid, visits] of [
      ['dev-client-3', 1],
      ['dev-client-1', 12],
      ['dev-client-5', 0],
      ['dev-client-2', 9],
      ['dev-client-4', 3],
    ] as const) {
      await write(`clientStats/${uid}`, stored(uid, visits));
      await write(`clientStats/${uid}/restricted/money`, {
        userId: uid,
        lifetimeSpendMinor: 12_000,
        currencyCode: 'EUR',
        version: 1,
        updatedAt: '2026-09-28T07:00:00.000Z',
      });
    }
  });

  it('walks everybody in the order of their ids, a cursor only while somebody is left', async () => {
    const pages = await walk(2);

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
  });

  it('hands over the visits the preview folds, parsed', async () => {
    const [page] = await walk(200);

    expect(page?.next).toBeNull();
    expect(
      page?.records.map((record) => record.last365.visitsCompleted.length),
    ).toEqual([12, 9, 1, 3, 0]);
    expect(page?.records[0]?.last365.visitsCompleted.at(-1)?.atMs).toBe(
      Date.parse('2026-09-28T07:00:00.000Z'),
    );
  });

  it('leaves out a document that does not parse, and walks on past it', async () => {
    await write('clientStats/dev-client-2', {
      userId: 'dev-client-2',
      version: 1,
    });

    const pages = await walk(2);

    expect(pages.map(ids)).toEqual([
      ['dev-client-1'],
      ['dev-client-3', 'dev-client-4'],
      ['dev-client-5'],
    ]);
  });

  it.each(['barber', 'receptionist', 'sysadmin'])(
    'lets a %s walk them too: whoever reads one client’s statistics reads them all',
    async (role) => {
      const page = await as(role).page(200, null);

      expect(page.isSuccess() && ids(page.value)).toHaveLength(5);
    },
  );

  it('is refused to a client, a content manager and an anonymous visitor', async () => {
    for (const directory of [
      as('client'),
      as('content_manager'),
      directoryFor(testEnv.unauthenticatedContext()),
    ]) {
      expect((await directory.page(200, null)).isFailure()).toBe(true);
    }
  });
});
