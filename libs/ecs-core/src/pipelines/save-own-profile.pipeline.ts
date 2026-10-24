import type { ProfileEdits } from '@core/components';
import { AccountsErrorCode } from '@core/errors';
import { Callables, type GatewayPorts } from '@core/ports';

export type SaveOwnProfilePorts = GatewayPorts;

/** The edit refusals whose `errors.` keys word themselves — passed through as the server named them. */
const EDIT_REFUSALS = [
  AccountsErrorCode.UpdateProfileNotFound,
  AccountsErrorCode.UpdateProfileValidationFailed,
] as const;

/** A refusal of the edit itself, as the server named it. */
type EditRefusal = (typeof EDIT_REFUSALS)[number];

/**
 * What a failed own-profile save answers — the code the screen translates
 * (`errors.<code>`): the edit's own refusal, or the ONE failed-write copy.
 */
export type SaveOwnProfileRefusal =
  EditRefusal | typeof AccountsErrorCode.UpdateProfileRepositoryFailure;

/** The server's code when it is one of {@link EDIT_REFUSALS}, else `null` (linear scan of two). */
function editRefusalOf(code: string | null): EditRefusal | null {
  for (const refusal of EDIT_REFUSALS) {
    if (refusal === code) return refusal;
  }
  return null;
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
 * Answers `null` on success, else the code the screen translates: the
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
  async (edits: ProfileEdits): Promise<SaveOwnProfileRefusal | null> => {
    const written = await ports.callableClient(Callables.UpdateProfile)(edits);
    if (written.ok) return null;
    return (
      editRefusalOf(written.error.serverErrorCode) ??
      AccountsErrorCode.UpdateProfileRepositoryFailure
    );
  };
