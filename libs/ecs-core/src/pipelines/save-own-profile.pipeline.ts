import type { ProfileEdits } from '@core/components';
import { Result } from '@core/primitives';
import { AccountsError, AccountsErrorCode } from '@core/errors';
import { Callables, type GatewayPorts } from '@core/ports';

export type SaveOwnProfilePorts = GatewayPorts;

/**
 * The server's code as the edit's own refusal — `ACCOUNTS_UPDATE_PROFILE_
 * NOT_FOUND` / `_VALIDATION_FAILED`, the two whose `errors.` keys word
 * themselves — else `null`.
 */
function editRefusalOf(
  code: string | null,
):
  | AccountsError.UpdateProfileNotFound
  | AccountsError.UpdateProfileValidationFailed
  | null {
  switch (code) {
    case AccountsErrorCode.UpdateProfileNotFound:
      return AccountsError.updateProfileNotFound();
    case AccountsErrorCode.UpdateProfileValidationFailed:
      return AccountsError.updateProfileValidationFailed();
    default:
      return null;
  }
}

/**
 * `saveOwnProfile` — the owner's own profile edit, the ONE call the three
 * owner-write sites make (the profile page's store, the onboarding birthday
 * step, the booking contact sheet's «save to profile»), moved out of
 * `account-state/own-profile.ts` (pass C, C-31, D-10): the `updateProfile`
 * callable through the gateway (Phase 4a 4A-3 (2)), which runs
 * `ProfileEditSystem.decide` inside its own transaction, writes the audit
 * row credited to the caller and stamps `profileEditedAtUtcMs` (4A-16). An
 * edit that changes nothing writes nothing. `users/{uid}` refuses every
 * client update.
 *
 * Answers `Result.ok` on success, else the refusal the screen translates
 * (`AccountsError.OwnProfileSave`, pass D §2.11, `errors.<errorCode>`): the
 * server's `ACCOUNTS_UPDATE_PROFILE_NOT_FOUND` / `_VALIDATION_FAILED` (the
 * refusal allowlist), and `ACCOUNTS_UPDATE_PROFILE_REPOSITORY_FAILURE` for
 * every other failure that is not a refusal of the edit itself — a store
 * failure (the edge's bare `INTERNAL`), a transport failure (offline, no
 * server code at all), an expired session, an unavailable or unknown
 * failure — whose `errors.` key holds the ONE copy today's rule denial or
 * transaction failure showed.
 */
export const saveOwnProfile =
  (ports: SaveOwnProfilePorts) =>
  async (
    edits: ProfileEdits,
  ): Promise<Result<void, AccountsError.OwnProfileSave>> => {
    const written = await ports.callableClient(Callables.UpdateProfile)(edits);
    if (written.ok) return Result.ok(undefined);
    return Result.err(
      editRefusalOf(written.error.serverErrorCode) ??
        AccountsError.updateProfileRepositoryFailure(),
    );
  };
