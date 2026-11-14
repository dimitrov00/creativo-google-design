import type { Firestore } from 'firebase-admin/firestore';
import { Result } from '@core/primitives';
import { BookingPolicy, StaffPermissions } from '@core/components';
import {
  BOOKING_POLICY_DOC,
  type BookingPolicySettings,
  Collections,
  STAFF_PERMISSIONS_DOC,
} from '@core/entities';
import type { PolicyReadPorts, StaffPermissionsReadPorts } from '@core/ports';
import { readFailed } from './store-answer';

/**
 * `settings/bookingPolicy`, read OUTSIDE any transaction on purpose
 * (`LoadPolicy`, blueprint §4.1): policy is tuning data and never widens a
 * booking's conflict set. The document IS the flat `BookingPolicySettings`
 * entity (Law 5), spread beside its id as stored; it reaches the pipelines
 * through the component's own edge guard, `BookingPolicy.withDefaults`
 * (§9 D28), so an absent document — the normal case, not a failure — or a
 * partial one reads as the defaults field by field. Only a read that throws
 * is a failure: a `RepositoryError` value, never a rejection.
 *
 * `settings/staffPermissions` (staff permissions P5, P6) is read the same
 * way for the callables that have no transaction to read it in — the
 * analytics pair: the stored body goes through `StaffPermissions.read`, so
 * an absent document is every cell at its default, and an absent field or
 * a hand-edited value is the guard's to answer, never a failure.
 */

const POLICY_PATH = `${Collections.Settings}/${BOOKING_POLICY_DOC}`;
const PERMISSIONS_PATH = `${Collections.Settings}/${STAFF_PERMISSIONS_DOC}`;

export const firestoreSettingsPorts = (
  db: Firestore,
): PolicyReadPorts & StaffPermissionsReadPorts => ({
  loadPolicy: async () => {
    try {
      const snap = await db.doc(POLICY_PATH).get();
      const stored = snap.exists
        ? ({ id: snap.id, ...snap.data() } as BookingPolicySettings)
        : null;
      return Result.ok(BookingPolicy.withDefaults(stored));
    } catch (error) {
      return Result.err(readFailed(POLICY_PATH, error));
    }
  },
  loadStaffPermissions: async () => {
    try {
      const snap = await db.doc(PERMISSIONS_PATH).get();
      return Result.ok(StaffPermissions.read(snap.exists ? snap.data() : null));
    } catch (error) {
      return Result.err(readFailed(PERMISSIONS_PATH, error));
    }
  },
});
