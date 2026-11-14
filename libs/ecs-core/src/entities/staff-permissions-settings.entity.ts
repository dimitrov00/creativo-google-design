import type { StaffPermissions, WriteProvenance } from '@core/components';
import type { StaffPermissionsSettingsId } from '@core/primitives';

/**
 * What each staff level may do — `settings/staffPermissions`
 * (`docs/designs/staff-permissions.md`, P5): the owner's cells flat at the
 * document root beside the save that last wrote it, the archetype
 * `{ id } & StaffPermissions & WriteProvenance`, next to
 * `BookingPolicySettings`.
 *
 * Every field is always present: a cell that follows the code's default
 * holds `null`, and a save SETS the whole body. No document at all is
 * every cell at its default — the normal state of a shop whose owner never
 * opened «Права». Its one writer is the `setStaffPermissions` callable,
 * which stamps `writeOperationId` and never deletes it; its readers type
 * the document as this entity and hand it through `StaffPermissions.read`,
 * which covers an absent document, an absent field and a hand-edited value.
 */
export type StaffPermissionsSettings = {
  readonly id: StaffPermissionsSettingsId;
} & StaffPermissions &
  WriteProvenance;
