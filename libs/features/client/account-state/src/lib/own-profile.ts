import { Callables, type GatewayPorts } from '@core/ports';
import { AccountsErrorCode } from '@core/primitives';
import { ProfileEditSystem } from '@core/systems';
import type { ProfileEdits } from '@core/components';

/**
 * The code every failed owner write answers that is not a refusal of the
 * edit itself — a store failure (the edge's bare `INTERNAL`), a transport
 * failure (offline, no server code at all), an expired session, an
 * unavailable or unknown failure: today's `UpdateProfileRepositoryFailure`
 * code, whose `errors.` key holds the ONE copy today's rule denial or
 * transaction failure showed (Phase 4a 4A-3 (2)).
 */
export const PROFILE_WRITE_FAILED =
  'accounts.update_profile.repository_failure';

/** The edit refusals whose `errors.` keys word themselves. */
const EDIT_REFUSALS: ReadonlySet<string> = new Set<string>([
  AccountsErrorCode.UpdateProfileNotFound,
  AccountsErrorCode.UpdateProfileValidationFailed,
]);

/**
 * The owner's own profile edit — the ONE call the three owner-write sites
 * make (the profile page's store, the onboarding birthday step, the booking
 * contact sheet's «save to profile»): the `updateProfile` callable through
 * the gateway (Phase 4a 4A-3 (2)), which runs `ProfileEditSystem.decide`
 * inside its own transaction, writes the audit row credited to the caller
 * and stamps `profileEditedAtUtcMs` (4A-16). An edit that changes nothing
 * writes nothing. `users/{uid}` refuses every client update.
 *
 * Answers `null` on success, else the code the screen translates
 * (`errors.<code>`): the server's `ACCOUNTS_UPDATE_PROFILE_NOT_FOUND` /
 * `_VALIDATION_FAILED`, and {@link PROFILE_WRITE_FAILED} for every other
 * failure.
 */
export async function saveOwnProfile(
  gateway: GatewayPorts,
  edits: ProfileEdits,
): Promise<string | null> {
  const written = await gateway.callableClient(Callables.UpdateProfile)(edits);
  if (written.ok) return null;
  const code = written.error.serverErrorCode;
  return code !== null && EDIT_REFUSALS.has(code) ? code : PROFILE_WRITE_FAILED;
}

/** A name draft's refusals, per field — `null` where that name passes. */
export type NameRefusalCodes = {
  readonly firstName: string | null;
  readonly lastName: string | null;
};

/**
 * The ONE name rule (`ProfileEditSystem.nameRefusals`: at least two
 * characters once trimmed) applied to a form's drafts, each field's refusal
 * as the `errorCode` its line translates (`ACCOUNTS_FIRST_NAME_TOO_SHORT`,
 * `ACCOUNTS_LAST_NAME_TOO_SHORT` — today's words). The profile sheet and the
 * onboarding about step judge their drafts with it, so neither can drift
 * from the rule the write enforces.
 */
export function nameRefusalCodes(
  firstName: string,
  lastName: string,
): NameRefusalCodes {
  let first: string | null = null;
  let last: string | null = null;
  for (const refusal of ProfileEditSystem.nameRefusals(firstName, lastName)) {
    if (refusal.errorCode === AccountsErrorCode.FirstNameTooShort) {
      first = refusal.errorCode;
    } else if (refusal.errorCode === AccountsErrorCode.LastNameTooShort) {
      last = refusal.errorCode;
    }
  }
  return { firstName: first, lastName: last };
}
