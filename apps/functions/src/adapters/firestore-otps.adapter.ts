import type { Firestore } from 'firebase-admin/firestore';
import { Result } from '@core/primitives';
import { Collections, type Otp } from '@core/entities';
import type { OtpStorePorts } from '@core/ports';
import { readFailed } from './store-answer';

/**
 * The `otps` store outside any transaction (identity flip (2), blueprint
 * §4.1 `requestOtp`) — `otps/{id}` IS the flat `Otp` minus `id` (Law 5):
 * `loadOpenOtps`, every challenge for a destination still unconsumed and
 * created at or after the window start: `destination ==`,
 * `consumedAtUtcMs == null`, `createdAtUtcMs >=` (index #10).
 *
 * No `otps` write lives here (audit-hardening Phase 3, P3-RU-6,
 * P3-DEP-6): `requestOtp` saves the issued challenge by ONE commit — the
 * whole-body `Set` beside its `IDENTITY_OTP_REQUESTED` audit row — and the
 * transaction adapter stamps its `purgeAt` TTL on that `Set`
 * (`firestoreCommitPlan` → `withPurgeAt`, `purgeAtFor`: `expiresAtUtcMs` +
 * 24 h, F2-11); the verification's attempt reads and writes `otps/{id}`
 * inside its transaction (`ReadTx`, a `CommitPlan` `Update`). Bodies spread
 * as stored; a read that throws answers a `RepositoryError` value whose
 * `reason` is the failure's canonical code.
 */

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
      return Result.err(readFailed(Collections.Otps, error));
    }
  },
});
