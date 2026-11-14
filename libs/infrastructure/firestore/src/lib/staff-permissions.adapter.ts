import { type Firestore, doc } from 'firebase/firestore';
import { map } from 'rxjs';
import { StaffPermissions } from '@core/components';
import { Result } from '@core/primitives';
import {
  Collections,
  STAFF_PERMISSIONS_DOC,
  type StaffPermissionsSettings,
} from '@core/entities';
import type { StaffPermissionsStreamPorts } from '@core/ports';
import { observeDoc } from './observe';

/**
 * What each staff level may do, live (staff permissions P8) —
 * `settings/staffPermissions`, one document, read by staff sessions only
 * (the rules refuse it to everyone else).
 *
 * The body reaches the reader through the component's reading guard,
 * `StaffPermissions.read`, as the server's copy does: no document is every
 * default, an absent cell follows its default, and a value nobody can read
 * grants nothing. A refused read is the port's `RepositoryError`, handed on
 * as it is: what the reader does without the cells is the reader's rule.
 *
 * Reads only. The cells change through the `setStaffPermissions` callable.
 */
export const staffPermissionsStreamPorts = (
  db: Firestore,
): StaffPermissionsStreamPorts => ({
  observeStaffPermissions: () =>
    observeDoc<StaffPermissionsSettings>(
      doc(db, Collections.Settings, STAFF_PERMISSIONS_DOC),
    ).pipe(
      map((answer) =>
        answer.ok ? Result.ok(StaffPermissions.read(answer.value)) : answer,
      ),
    ),
});
