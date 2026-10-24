import { AccountsErrorCode } from '@core/errors';
import { ProfileEditSystem } from '@core/systems';

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
