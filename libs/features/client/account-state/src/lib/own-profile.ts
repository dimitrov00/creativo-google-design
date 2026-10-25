import { type AccountsError, AccountsErrorCode } from '@core/errors';
import { ProfileEditSystem } from '@core/systems';

/** A name draft's refusals, per field, as their structs — `null` where that name passes. */
export type NameRefusals = {
  readonly firstName: AccountsError.FirstNameTooShort | null;
  readonly lastName: AccountsError.LastNameTooShort | null;
};

/**
 * The ONE name rule (`ProfileEditSystem.nameRefusals`: at least two
 * characters once trimmed) applied to a form's drafts, each field's refusal
 * as the struct its line translates (`errors.ACCOUNTS_FIRST_NAME_TOO_SHORT`,
 * `errors.ACCOUNTS_LAST_NAME_TOO_SHORT` — today's words; pass D E-8: the
 * struct, never its bare code). The profile sheet and the onboarding about
 * step judge their drafts with it, so neither can drift from the rule the
 * write enforces.
 */
export function nameRefusalsOf(
  firstName: string,
  lastName: string,
): NameRefusals {
  let first: AccountsError.FirstNameTooShort | null = null;
  let last: AccountsError.LastNameTooShort | null = null;
  for (const refusal of ProfileEditSystem.nameRefusals(firstName, lastName)) {
    if (refusal.errorCode === AccountsErrorCode.FirstNameTooShort) {
      first = refusal;
    } else if (refusal.errorCode === AccountsErrorCode.LastNameTooShort) {
      last = refusal;
    }
  }
  return { firstName: first, lastName: last };
}
