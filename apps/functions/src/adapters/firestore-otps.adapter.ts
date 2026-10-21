import type { Firestore } from 'firebase-admin/firestore';
import { RepositoryError, Result } from '@core/primitives';
import { Collections, type Otp } from '@core/entities';
import type { OtpStorePorts } from '@core/ports';
import { TriggerAttemptSystem } from '@core/systems';
import { withPurgeAt } from './firestore-ttl.adapter';

/**
 * The `otps` store outside any transaction (identity flip (2), blueprint
 * §4.1 `requestOtp`) — `otps/{id}` IS the flat `Otp` minus `id` (Law 5):
 *
 * - `loadOpenOtps` — every challenge for a destination still unconsumed and
 *   created at or after the window start: `destination ==`,
 *   `consumedAtUtcMs == null`, `createdAtUtcMs >=` (index #10);
 * - `loadOtp` — `otps/{id}`, `null` when absent;
 * - `saveOtp` — a `Set` of the body plus its `purgeAt` TTL stamp
 *   (`purgeAtFor`, the one place: `expiresAtUtcMs` + 24 h, F2-11).
 *
 * The verification's attempt reads and writes `otps/{id}` inside its
 * transaction (`ReadTx`, a `CommitPlan` `Update`), never here. Bodies spread
 * as stored; a read or write that throws answers a `RepositoryError` value
 * whose `reason` is the failure's canonical code.
 */

function failureOf(error: unknown): string {
  return TriggerAttemptSystem.failureCode(error);
}

export const firestoreOtpPorts = (db: Firestore): OtpStorePorts => ({
  loadOpenOtps: async (destination, sinceUtcMs) => {
    try {
      const snap = await db
        .collection(Collections.Otps)
        .where('destination', '==', destination)
        .where('consumedAtUtcMs', '==', null)
        .where('createdAtUtcMs', '>=', sinceUtcMs)
        .get();
      return Result.ok(
        snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Otp),
      );
    } catch (error) {
      return Result.err(
        RepositoryError.readFailed(Collections.Otps, failureOf(error)),
      );
    }
  },

  loadOtp: async (id) => {
    const path = `${Collections.Otps}/${id}`;
    try {
      const snap = await db.doc(path).get();
      return Result.ok(
        snap.exists ? ({ id: snap.id, ...snap.data() } as Otp) : null,
      );
    } catch (error) {
      return Result.err(RepositoryError.readFailed(path, failureOf(error)));
    }
  },

  saveOtp: async ({ id, ...body }) => {
    const path = `${Collections.Otps}/${id}`;
    try {
      await db.doc(path).set(withPurgeAt([Collections.Otps, id], body));
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(RepositoryError.writeFailed(path, failureOf(error)));
    }
  },
});
