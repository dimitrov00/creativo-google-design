import type { Firestore } from 'firebase-admin/firestore';
import { RepositoryError, Result } from '@core/primitives';
import { BookingPolicy } from '@core/components';
import { BOOKING_POLICY_DOC, Collections } from '@core/entities';
import type { PolicyReadPorts } from '@core/ports';

/**
 * `settings/bookingPolicy`, read OUTSIDE any transaction on purpose
 * (`LoadPolicy`, blueprint §4.1): policy is tuning data and never widens a
 * booking's conflict set. The body keeps its shape in flip 1 (blueprint
 * §2.6); an absent or partial document reads through the component's own
 * edge guard, `BookingPolicy.withDefaults` (§9 D28) — a missing document is
 * the normal case, not a failure. Only a read that throws is a failure: a
 * `RepositoryError` value, never a rejection.
 */

const POLICY_PATH = `${Collections.Settings}/${BOOKING_POLICY_DOC}`;

export const firestoreSettingsPorts = (db: Firestore): PolicyReadPorts => ({
  loadPolicy: async () => {
    try {
      const snap = await db.doc(POLICY_PATH).get();
      return Result.ok(BookingPolicy.withDefaults(snap.data() ?? null));
    } catch (error) {
      return Result.err(RepositoryError.readFailed(POLICY_PATH, String(error)));
    }
  },
});
