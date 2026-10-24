import { type ProfileEdits, WriteOp } from '@core/components';
import {
  AuditEntryId,
  defect,
  Result,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { type AccountsError, type RepositoryError } from '@core/errors';
import { Collections, type User } from '@core/entities';
import type {
  ClockPorts,
  CommitPorts,
  HashPorts,
  TelemetryPorts,
} from '@core/ports';
import { AgeSystem, AuditSystem, ProfileEditSystem } from '@core/systems';

/**
 * `updateProfile` — the owner's edit of their names and birth date, as a
 * callable (blueprint §4.1; identity flip (2), F2-5, F2-6) — since Phase 4a
 * the ONLY way an owner's profile changes (`users/{uid}` refuses every
 * client update, 4A-3 (2)). One transaction reads `users/{callerUserId}`
 * and `ProfileEditSystem.decide` — the ONE profile-edit rule — answers the
 * five owner keys (`firstName`, `lastName`, `birthDate`, `searchName`,
 * `searchPrefixes`, the search keys from the STORED contact channels), a
 * refusal (`ACCOUNTS_UPDATE_PROFILE_NOT_FOUND` for an absent or provisioned
 * account, `ACCOUNTS_UPDATE_PROFILE_VALIDATION_FAILED` for a refused name or
 * birth date), or nothing when the edit changes nothing.
 *
 * Owner ruling flip-2 §10.15 (4A-16): when an audited field changed, the
 * SAME transaction stamps the user's `profileEditedAtUtcMs` and `Create`s
 * the edit's ONE audit row (`AuditSystem.planOwnProfileEdit`:
 * `PROFILE_UPDATED`, credited to the caller, the changed field names), its
 * id `hash(basis)` — so the row and the edit land together or not at all,
 * and the `auditProfileChanges` trigger, seeing the stamp move, plans
 * nothing for the event (`AuditSystem.auditedByCallable`). The same edits
 * twice write once: the second call writes nothing and leaves no row.
 *
 * The age window is judged on the UTC civil date (`AgeSystem.judgedOn`),
 * derived once from the clock (F2-7); the stamp is that same instant.
 */

export type UpdateProfilePorts = CommitPorts &
  ClockPorts &
  HashPorts &
  TelemetryPorts;

export type UpdateProfileCommand = {
  /** The VERIFIED session's uid — an owner edits only their own account. */
  readonly callerUserId: UserId;
  readonly edits: ProfileEdits;
};

export type UpdateProfileAnswer = {
  /** Whether anything was written — `false` for an edit equal to the stored values. */
  readonly changed: boolean;
};

export type UpdateProfileError = AccountsError | RepositoryError;

/** The transaction's decision: whether it writes, and its plan. */
type ProfileDecision = {
  readonly changed: boolean;
  readonly writes: readonly WriteOp[];
};

/**
 * The plan of one decided edit: the owner keys alone — or, when an audited
 * field changed, the keys with the marker stamped and the edit's row.
 */
function editWrites(
  stored: User,
  keys: Readonly<Record<string, unknown>>,
  callerUserId: UserId,
  nowUtcMs: UtcEpochMs,
  hash: (input: string) => string,
): readonly WriteOp[] {
  const path = [Collections.Users, callerUserId];
  const audit = AuditSystem.planOwnProfileEdit(
    callerUserId,
    AuditSystem.changedProfileFields(stored, { ...stored, ...keys }),
    nowUtcMs,
  );
  if (audit === null) return [WriteOp.update(path, keys)];
  const id = AuditEntryId.of(
    hash(audit.idBasis ?? defect('an own edit’s row carries its basis')),
  );
  return [
    WriteOp.update(path, { ...keys, profileEditedAtUtcMs: nowUtcMs }),
    WriteOp.create([Collections.AuditLog, id], audit.row),
  ];
}

export const updateProfile =
  (ports: UpdateProfilePorts) =>
  async (
    cmd: UpdateProfileCommand,
  ): Promise<Result<UpdateProfileAnswer, UpdateProfileError>> => {
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    const ageDay = AgeSystem.judgedOn(nowUtcMs);
    const path = [Collections.Users, cmd.callerUserId];
    const committed = await ports.commit(
      (tx) => tx.get<User>(path),
      (stored): Result<ProfileDecision, AccountsError> => {
        const decided = ProfileEditSystem.decide(stored, cmd.edits, ageDay);
        if (!decided.ok) return decided;
        // `decide` answers keys only for a stored, registered account.
        return decided.value === null || stored === null
          ? Result.ok({ changed: false, writes: [] })
          : Result.ok({
              changed: true,
              writes: editWrites(
                stored,
                decided.value,
                cmd.callerUserId,
                nowUtcMs,
                ports.hash,
              ),
            });
      },
    );
    if (!committed.ok) {
      ports.log('info', 'profile.update.refused', {
        uid: cmd.callerUserId,
        errorCode: committed.error.errorCode,
      });
      return committed;
    }
    return Result.ok({ changed: committed.value.changed });
  };
