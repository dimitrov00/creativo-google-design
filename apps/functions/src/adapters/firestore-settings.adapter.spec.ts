import type { Firestore } from 'firebase-admin/firestore';
import { RepositoryErrorCode } from '@core/errors';
import { BookingPolicy } from '@core/components';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreSettingsPorts } from './firestore-settings.adapter';

const portsOver = (seed: Record<string, Record<string, unknown>> = {}) =>
  firestoreSettingsPorts(
    createProjectionFirestore(seed).db as unknown as Firestore,
  );

describe('firestoreSettingsPorts — settings/bookingPolicy', () => {
  it('reads the stored policy through the component guard', async () => {
    const result = await portsOver({
      'settings/bookingPolicy': {
        maxPartySize: 3,
        slotStepMinutes: 30,
        minLeadMinutes: 60,
        horizonMonths: 4,
        cancellationWindowHours: 12,
        maxFlexibleDays: 5,
        autoConfirm: false,
      },
    }).loadPolicy();
    expect(result).toEqual({
      ok: true,
      value: {
        maxPartySize: 3,
        slotStepMinutes: 30,
        minLeadMinutes: 60,
        horizonMonths: 4,
        cancellationWindowHours: 12,
        maxFlexibleDays: 5,
        autoConfirm: false,
      },
    });
  });

  it('answers the defaults for an absent document — the normal case, not a failure (D28)', async () => {
    expect(await portsOver().loadPolicy()).toEqual({
      ok: true,
      value: BookingPolicy.DEFAULT,
    });
  });

  it('falls back field by field for a partial document', async () => {
    const result = await portsOver({
      'settings/bookingPolicy': { cancellationWindowHours: 6 },
    }).loadPolicy();
    expect(result.ok && result.value).toEqual({
      ...BookingPolicy.DEFAULT,
      cancellationWindowHours: 6,
    });
  });

  it('answers a read that throws as a REPOSITORY_READ_FAILED value, never a rejection', async () => {
    const db = {
      doc: () => ({
        get: async () => {
          throw new Error('unavailable');
        },
      }),
    } as unknown as Firestore;
    const result = await firestoreSettingsPorts(db).loadPolicy();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.errorCode).toBe(
      RepositoryErrorCode.ReadFailed,
    );
  });

  it('answers the failure’s canonical code as its reason — never the SDK’s message (S-DEP-2)', async () => {
    const db = {
      doc: () => ({
        get: async () => {
          throw Object.assign(new Error('deadline for +359880000777'), {
            code: 4,
          });
        },
      }),
    } as unknown as Firestore;
    const result = await firestoreSettingsPorts(db).loadPolicy();
    expect(result).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'settings/bookingPolicy',
        reason: 'deadline-exceeded',
      },
    });
    expect(JSON.stringify(result)).not.toContain('359880000777');
  });
});
