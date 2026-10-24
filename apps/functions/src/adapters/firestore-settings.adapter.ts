import type { Firestore } from 'firebase-admin/firestore';
import { Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { BookingPolicy } from '@core/components';
import {
  BOOKING_POLICY_DOC,
  type BookingPolicySettings,
  Collections,
} from '@core/entities';
import type { PolicyReadPorts } from '@core/ports';

/**
 * `settings/bookingPolicy`, read OUTSIDE any transaction on purpose
 * (`LoadPolicy`, blueprint §4.1): policy is tuning data and never widens a
 * booking's conflict set. The document IS the flat `BookingPolicySettings`
 * entity (Law 5), spread beside its id as stored; it reaches the pipelines
 * through the component's own edge guard, `BookingPolicy.withDefaults`
 * (§9 D28), so an absent document — the normal case, not a failure — or a
 * partial one reads as the defaults field by field. Only a read that throws
 * is a failure: a `RepositoryError` value, never a rejection.
 */

const POLICY_PATH = `${Collections.Settings}/${BOOKING_POLICY_DOC}`;

export const firestoreSettingsPorts = (db: Firestore): PolicyReadPorts => ({
  loadPolicy: async () => {
    try {
      const snap = await db.doc(POLICY_PATH).get();
      const stored = snap.exists
        ? ({ id: snap.id, ...snap.data() } as BookingPolicySettings)
        : null;
      return Result.ok(BookingPolicy.withDefaults(stored));
    } catch (error) {
      return Result.err(RepositoryError.readFailed(POLICY_PATH, String(error)));
    }
  },
});
