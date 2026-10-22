import { type Firestore, Timestamp } from 'firebase-admin/firestore';
import { Identifier } from '@core/components';
import { OtpId, RepositoryErrorCode, UtcEpochMs } from '@core/primitives';
import { FIXTURE_NOW_UTC_MS, otpFixture } from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreOtpPorts } from './firestore-otps.adapter';

/*
 * The `otps` store (identity flip (2)): the flat body spread both ways, the
 * open-window probe on index #10's keys, and the `purgeAt` stamp of the one
 * TTL place. Successor of the deleted Firestore OTP repository spec.
 */

const DESTINATION = Identifier.of('client@example.com');
const minus = (ms: number) => UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -ms);

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

function seeded(...otps: ReturnType<typeof otpFixture>[]) {
  return createProjectionFirestore(
    Object.fromEntries(otps.map((otp) => [`otps/${otp.id}`, bodyOf(otp)])),
  );
}

const asDb = (fake: { readonly db: unknown }) =>
  fake.db as unknown as Firestore;

describe('firestoreOtpPorts', () => {
  it('saves an OTP — the flat body, plus purgeAt = expiresAtUtcMs + 24 h', async () => {
    const fake = createProjectionFirestore();
    const ports = firestoreOtpPorts(asDb(fake));
    const otp = otpFixture({ destination: DESTINATION });
    expect(await ports.saveOtp(otp)).toEqual({ ok: true, value: undefined });
    expect(fake.docs.get('otps/otp-1')).toEqual({
      ...bodyOf(otp),
      purgeAt: Timestamp.fromMillis(otp.expiresAtUtcMs + 86_400_000),
    });
    // dead: the read-back through `loadOtp` and «returns null for a missing
    // OTP» — Phase 4a 4A-14: `loadOtp` had no caller; the member is gone.
  });

  it('finds a recent unconsumed OTP for rate limiting — by destination, unconsumed, created at or after the window start', async () => {
    const fake = seeded(
      otpFixture({ destination: DESTINATION }),
      otpFixture({
        id: OtpId.of('otp-other'),
        destination: Identifier.of('other@example.com'),
      }),
    );
    const result = await firestoreOtpPorts(asDb(fake)).loadOpenOtps(
      DESTINATION,
      minus(60_000),
    );
    expect(result.ok && result.value.map((otp) => otp.id)).toEqual(['otp-1']);
  });

  it('does not count a consumed OTP toward the rate limit', async () => {
    const fake = seeded(
      otpFixture({
        destination: DESTINATION,
        consumedAtUtcMs: FIXTURE_NOW_UTC_MS,
      }),
    );
    const result = await firestoreOtpPorts(asDb(fake)).loadOpenOtps(
      DESTINATION,
      minus(60_000),
    );
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('does not count an OTP older than the rate-limit window', async () => {
    const fake = seeded(
      otpFixture({ destination: DESTINATION, createdAtUtcMs: minus(120_000) }),
    );
    const result = await firestoreOtpPorts(asDb(fake)).loadOpenOtps(
      DESTINATION,
      minus(60_000),
    );
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('answers a read or a write that throws as a RepositoryError value', async () => {
    const throwing = {
      collection: () => {
        throw new Error('down');
      },
      doc: () => ({
        get: async () => {
          throw new Error('down');
        },
        set: async () => {
          throw new Error('down');
        },
      }),
    } as unknown as Firestore;
    const ports = firestoreOtpPorts(throwing);
    const probe = await ports.loadOpenOtps(DESTINATION, minus(60_000));
    expect(!probe.ok && probe.error.errorCode).toBe(
      RepositoryErrorCode.ReadFailed,
    );
    const saved = await ports.saveOtp(otpFixture());
    expect(!saved.ok && saved.error.errorCode).toBe(
      RepositoryErrorCode.WriteFailed,
    );
  });
});
