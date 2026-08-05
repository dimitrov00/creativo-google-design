import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { firstValueFrom } from 'rxjs';
import { BarberId, LocationId } from '@creativo/domain/catalog';
import { CalendarDay, DateRange } from '@creativo/domain/scheduling';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { FirestoreAvailabilityReader } from './availability-reader.adapter';

const ZONE = 'Europe/Sofia';

function readerFor(context: RulesTestContext): FirestoreAvailabilityReader {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: modularFirestore(context) },
      FirestoreAvailabilityReader,
    ],
  });
  return TestBed.inject(FirestoreAvailabilityReader);
}

function day(key: string): CalendarDay {
  const result = CalendarDay.create(key, ZONE);
  if (!result.isSuccess()) throw new Error(`bad day ${key}`);
  return result.value;
}

function range(fromKey: string, toKey: string): DateRange {
  const result = DateRange.create(day(fromKey), day(toKey));
  if (!result.isSuccess()) throw new Error('bad range');
  return result.value;
}

function barberId(raw: string): BarberId {
  const result = BarberId.create(raw);
  if (!result.isSuccess()) throw new Error('bad barber id');
  return result.value;
}

function locationId(raw: string): LocationId {
  const result = LocationId.create(raw);
  if (!result.isSuccess()) throw new Error('bad location id');
  return result.value;
}

/**
 * The adapter under test READS the rollup; it computes nothing. The geometry
 * math (roster ∩ hours − exception − padded busy) moved server-side into
 * `rebuildBarberCapacity`, which has its own tests in `apps/functions` — a
 * rules-unit-testing project runs no Cloud Functions, so seeding raw
 * geometry here and expecting derived numbers would test a pipeline that
 * CANNOT run in this environment. What belongs here is the read contract:
 * month-doc lookup, barber filtering, shop narrowing, absent-as-zero, and
 * the rules around the collection.
 */
describe('FirestoreAvailabilityReader.observeRangeCapacity (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-availability');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      // Two months, straddled by the queried range. b1 works loc-a; on the
      // 4th he also covers loc-b for an hour's worth of leftover minutes.
      await setDoc(doc(db, 'capacity', '2026-08'), {
        month: '2026-08',
        days: {
          '2026-08-30': { b1: { 'loc-a': 480 } },
          '2026-08-31': {
            b1: { 'loc-a': 420, 'loc-b': 60 },
            b2: { 'loc-a': 90 },
          },
        },
      });
      await setDoc(doc(db, 'capacity', '2026-09'), {
        month: '2026-09',
        days: {
          '2026-09-01': { b1: { 'loc-a': 480 } },
        },
      });
    });
  });

  it('answers a month-straddling range from the rollup, anonymously, first emission', async () => {
    const reader = readerFor(testEnv.unauthenticatedContext());

    const result = await firstValueFrom(
      reader.observeRangeCapacity(null, range('2026-08-30', '2026-09-02'), [
        barberId('b1'),
      ]),
    );

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.get('2026-08-30')).toBe(480);
    expect(result.value.get('2026-08-31')).toBe(480); // 420 + 60, b2 excluded
    expect(result.value.get('2026-09-01')).toBe(480);
    // A day the rollup has no entry for reads as zero, never as undefined.
    expect(result.value.get('2026-09-02')).toBe(0);
    expect(result.value.size).toBe(4);
  });

  it('narrows to the chosen shop', async () => {
    const reader = readerFor(testEnv.unauthenticatedContext());

    const result = await firstValueFrom(
      reader.observeRangeCapacity(
        locationId('loc-b'),
        range('2026-08-31', '2026-08-31'),
        [barberId('b1'), barberId('b2')],
      ),
    );

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    // Only b1's loc-b hour counts; b2 works loc-a only.
    expect(result.value.get('2026-08-31')).toBe(60);
  });

  it('counts only the barbers the catalog names', async () => {
    const reader = readerFor(testEnv.unauthenticatedContext());

    const result = await firstValueFrom(
      reader.observeRangeCapacity(null, range('2026-08-31', '2026-08-31'), [
        barberId('b2'),
      ]),
    );

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.get('2026-08-31')).toBe(90);
  });

  it('returns an empty map for an empty barber set without touching the network', async () => {
    const reader = readerFor(testEnv.unauthenticatedContext());

    const result = await firstValueFrom(
      reader.observeRangeCapacity(null, range('2026-08-30', '2026-09-02'), []),
    );

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.size).toBe(0);
  });

  it('RULES: capacity is world-readable and client-write-closed', async () => {
    const anon = testEnv.unauthenticatedContext();
    await assertSucceeds(getDoc(doc(anon.firestore(), 'capacity', '2026-08')));

    const client = testEnv.authenticatedContext('user-1', {
      roles: ['client'],
    });
    await assertFails(
      setDoc(doc(client.firestore(), 'capacity', '2026-08'), {
        days: { '2026-08-31': { b1: { 'loc-a': 9999 } } },
      }),
    );
  });
});
