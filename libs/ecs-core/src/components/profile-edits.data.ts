/**
 * What an owner may change of their own profile (`updateProfile`) — every
 * key present, `null` = keep the stored value (no optional property: every
 * edit shares one hidden class). Moved here whole from
 * `profile-edit.system.ts` (Phase 4a): it is the `updateProfile` call's
 * request (`IdentityCall.UpdateProfile`), so a component.
 */
export type ProfileEdits = {
  /** `null` = keep the stored first name. */
  readonly firstName: string | null;
  /** `null` = keep the stored last name. */
  readonly lastName: string | null;
  /**
   * `'YYYY-MM-DD'`, raw: its smart constructor is `AgeSystem.parseIso`, run
   * by `ProfileEditSystem.decide` beside the name rule (the stated Law 7.4
   * exception — its refusal needs `ageDay`). `null` = keep the stored one;
   * there is no clearing, as today.
   */
  readonly birthDate: string | null;
};

/** The edit that keeps everything — every field `null`. */
const KEEP: ProfileEdits = { firstName: null, lastName: null, birthDate: null };

export const ProfileEdits = {
  /** Every field `null`: change nothing. */
  keep(): ProfileEdits {
    return KEEP;
  },
} as const;
