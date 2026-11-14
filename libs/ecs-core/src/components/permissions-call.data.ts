import {
  AccessScope,
  Result,
  StaffCapability,
  StoredFields,
  Tag,
} from '@core/primitives';
import { type PipelineError } from '@core/errors';
import { CallAnswer } from './call-answer.data';
import { Role } from './role.data';
import { StaffPermissions, type StaffLevel } from './staff-permissions.data';

/**
 * One cell the owner sets: the level, the capability and how far it is to
 * reach — never `null`: a save names the scope it wants, and the server
 * stores "follows the default" itself when that is the default.
 */
export type PermissionChange = {
  readonly staffCapability: StaffCapability;
  /** The level as sent — any known role; one the owner does not edit is refused (`NOT_OFFERED`). */
  readonly role: Role;
  readonly accessScope: AccessScope;
};

/**
 * THE PERMISSIONS-SAVE WIRE (`docs/designs/staff-permissions.md`, P6) —
 * `setStaffPermissions`: the cells the owner changed on «Права», at most
 * one entry per cell. The server adds the caller; the act's operation id
 * rides the payload (`OPERATION_ID_FIELD`) and is REQUIRED — it stamps the
 * document and keys the audit row.
 */
export type PermissionsCall = {
  readonly changes: readonly PermissionChange[];
};

/** A changed cell as the answer carries it — `null` when any field is not what the wire promises. */
function cellChangeOf(raw: unknown): PermissionsCall.CellChange | null {
  const staffCapability = StoredFields.field(raw, 'staffCapability');
  const role = StoredFields.field(raw, 'role');
  const accessScopeFrom = StoredFields.field(raw, 'accessScopeFrom');
  const accessScopeTo = StoredFields.field(raw, 'accessScopeTo');
  return Tag.has(StaffCapability, staffCapability) &&
    StaffPermissions.isLevel(role) &&
    Tag.has(AccessScope, accessScopeFrom) &&
    Tag.has(AccessScope, accessScopeTo)
    ? { staffCapability, role, accessScopeFrom, accessScopeTo }
    : null;
}

export const PermissionsCall = {
  /** A save names each cell at most once, so it is never longer than the grid. */
  CHANGES_MAX:
    StaffPermissions.LEVELS.length * Tag.values(StaffCapability).length,

  /**
   * `setStaffPermissions`' answer, read through `CallAnswer` like every
   * answer: the cells the save changed, each with its scope before and
   * after. One cell that cannot be read makes the whole answer unusable
   * (`PIPELINE_UNKNOWN`); an empty list is a save that changed nothing.
   */
  decodeSaved(raw: unknown): Result<PermissionsCall.Saved, PipelineError> {
    const answer = CallAnswer.read(raw);
    const sent =
      answer === null ? undefined : StoredFields.field(answer, 'changes');
    if (!Array.isArray(sent)) return CallAnswer.unusable();
    const changes: PermissionsCall.CellChange[] = [];
    for (const entry of sent as readonly unknown[]) {
      const change = cellChangeOf(entry);
      if (change === null) return CallAnswer.unusable();
      changes.push(change);
    }
    return Result.ok({ changes });
  },
} as const;

export namespace PermissionsCall {
  /** One cell a save changed: where it was and where it is — effective scopes, the default resolved. */
  export type CellChange = {
    readonly staffCapability: StaffCapability;
    readonly role: StaffLevel;
    readonly accessScopeFrom: AccessScope;
    readonly accessScopeTo: AccessScope;
  };
  /** `setStaffPermissions`' answer: the cells that changed, in the request's order. */
  export type Saved = {
    readonly changes: readonly CellChange[];
  };
}
