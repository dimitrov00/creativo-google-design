import { WriteOp } from '@core/components';
import {
  type AccountsError,
  type RepositoryError,
  Result,
  type UserId,
} from '@core/primitives';
import { Collections, type User } from '@core/entities';
import type { ClockPorts, CommitPorts, TelemetryPorts } from '@core/ports';
import {
  type ProfileEdits,
  ProfileEditSystem,
  ZonedTimeSystem,
} from '@core/systems';
import { UTC_ZONE } from './booking-read-set.pipeline';

/**
 * `updateProfile` — the owner's edit of their names and birth date, as a
 * callable (blueprint §4.1; identity flip (2), F2-5, F2-6). One
 * transaction reads `users/{callerUserId}` and `ProfileEditSystem.decide`
 * — the ONE profile-edit rule, which the web's owner write runs too —
 * answers the five owner keys (`firstName`, `lastName`, `birthDate`,
 * `searchName`, `searchPrefixes`, the search keys from the STORED contact
 * channels), a refusal (`ACCOUNTS_UPDATE_PROFILE_NOT_FOUND` for an absent or
 * provisioned account, `ACCOUNTS_UPDATE_PROFILE_VALIDATION_FAILED` for a
 * refused name or birth date), or nothing when the edit changes nothing.
 * The plan is one root-key `Update` — or none: the same edits twice write
 * once, and the second call leaves no audit row (the `auditProfileChanges`
 * trigger stays the only profile auditor; this pipeline appends none).
 *
 * The age window is judged on the UTC civil date, derived once from the
 * clock (F2-7).
 */

export type UpdateProfilePorts = CommitPorts & ClockPorts & TelemetryPorts;

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

export const updateProfile =
  (ports: UpdateProfilePorts) =>
  async (
    cmd: UpdateProfileCommand,
  ): Promise<Result<UpdateProfileAnswer, UpdateProfileError>> => {
    // Read once, before the transaction: `decide` may run more than once.
    const ageDay = ZonedTimeSystem.toLocal(
      ports.nowUtcMs(),
      UTC_ZONE,
    ).localDate;
    const path = [Collections.Users, cmd.callerUserId];
    const committed = await ports.commit(
      (tx) => tx.get<User>(path),
      (stored): Result<ProfileDecision, AccountsError> => {
        const decided = ProfileEditSystem.decide(stored, cmd.edits, ageDay);
        if (!decided.ok) return decided;
        return decided.value === null
          ? Result.ok({ changed: false, writes: [] })
          : Result.ok({
              changed: true,
              writes: [WriteOp.update(path, decided.value)],
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
