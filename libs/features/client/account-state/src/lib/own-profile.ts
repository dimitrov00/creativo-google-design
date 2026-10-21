import type { ProfilePorts } from '@core/ports';
import {
  type AccountsError,
  AccountsErrorCode,
  type LocalDate,
  type RepositoryError,
  RepositoryErrorCode,
  type UserId,
} from '@core/primitives';
import { ProfileEditSystem, type ProfileEdits } from '@core/systems';

/**
 * The code a failed owner write answers when the STORE failed (a rule
 * denial, the network): today's `UpdateProfileRepositoryFailure` code,
 * whose `errors.` key holds today's words. A refusal of the edit itself
 * answers its ecs-core `errorCode` (`ACCOUNTS_UPDATE_PROFILE_NOT_FOUND`,
 * `ACCOUNTS_UPDATE_PROFILE_VALIDATION_FAILED`), whose `errors.` keys hold
 * the same words the dotted codes did.
 */
export const PROFILE_WRITE_FAILED =
  'accounts.update_profile.repository_failure';

const REPOSITORY_CODES: ReadonlySet<string> = new Set<string>(
  Object.values(RepositoryErrorCode),
);

/**
 * The owner's own profile edit — the ONE call the three owner-write sites
 * make (the profile page's store, the onboarding birthday step, the booking
 * contact sheet's «save to profile»), identity flip (2) F2-6: the port reads
 * `users/{uid}` and writes the five owner keys `ProfileEditSystem.decide`
 * answers, in one browser transaction — the same rule the server's
 * `updateProfile` runs. An edit that changes nothing writes nothing.
 *
 * `ageDay` is the boundary's UTC civil day (`ageDayOf`). Answers `null` on
 * success, else the code the screen translates (`errors.<code>`).
 */
export async function saveOwnProfile(
  ports: ProfilePorts,
  userId: UserId,
  edits: ProfileEdits,
  ageDay: LocalDate,
): Promise<string | null> {
  const written = await ports.writeOwnProfile(userId, (stored) =>
    ProfileEditSystem.decide(stored, edits, ageDay),
  );
  return written.ok ? null : profileWriteCode(written.error);
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

/** A failed owner write, as the code its screen translates. */
function profileWriteCode(error: AccountsError | RepositoryError): string {
  return REPOSITORY_CODES.has(error.errorCode)
    ? PROFILE_WRITE_FAILED
    : error.errorCode;
}
