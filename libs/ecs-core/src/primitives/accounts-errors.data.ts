/**
 * The accounts context's error codes — the codes of
 * `libs/domain/accounts/src/lib/*.errors.ts` and of the accounts use cases
 * (`update-profile.errors.ts`, the avatar upload checks), collapsed from
 * `DomainError` subclasses into one dictionary of flat structs
 * discriminated by `errorCode` (Law 7.5), SCREAMING_SNAKE with the
 * `ACCOUNTS_` prefix (flatten-spec §4.2). Every non-`errorCode` field is an
 * i18n parameter, so each one is an i18n-safe scalar (infrastructure Q5).
 *
 * Not here: the birth-date age window (one `BirthDate` now, its refusals are
 * the `IDENTITY_BIRTH_DATE_*` codes of `identity-errors.data.ts`),
 * contact change (§9 D12(b): not shipped) and storage/repository failures
 * (`repository-errors.data.ts`, `media-errors.data.ts`).
 */
export const AccountsErrorCode = {
  /** A block reason outside the `BlockReason` dictionary. */
  BlockReasonInvalid: 'ACCOUNTS_BLOCK_REASON_INVALID',
  /** A role outside the `Role` dictionary. */
  UserRoleInvalid: 'ACCOUNTS_USER_ROLE_INVALID',
  /** A registered user holds no role — a roleless user can do nothing. */
  UserRolesEmpty: 'ACCOUNTS_USER_ROLES_EMPTY',
  /** Shorter than `minLength` after trimming. */
  FirstNameTooShort: 'ACCOUNTS_FIRST_NAME_TOO_SHORT',
  /** Shorter than `minLength` after trimming. */
  LastNameTooShort: 'ACCOUNTS_LAST_NAME_TOO_SHORT',
  /** Not an e-mail address (`Email.parse` refused it). */
  EmailInvalid: 'ACCOUNTS_EMAIL_INVALID',
  /** No `users/{uid}` document to edit. */
  UpdateProfileNotFound: 'ACCOUNTS_UPDATE_PROFILE_NOT_FOUND',
  /** The edited profile failed a field rule. */
  UpdateProfileValidationFailed: 'ACCOUNTS_UPDATE_PROFILE_VALIDATION_FAILED',
  /** `updateProfile` called without a signed-in session (identity flip (2), F2-4). */
  UpdateProfileUnauthenticated: 'ACCOUNTS_UPDATE_PROFILE_UNAUTHENTICATED',
  /** The picked avatar file is not an image. */
  UploadAvatarNotAnImage: 'ACCOUNTS_UPLOAD_AVATAR_NOT_AN_IMAGE',
  /** The picked avatar file is over `maxBytes`. */
  UploadAvatarTooLarge: 'ACCOUNTS_UPLOAD_AVATAR_TOO_LARGE',
} as const;
export type AccountsErrorCode =
  (typeof AccountsErrorCode)[keyof typeof AccountsErrorCode];

export type AccountsError =
  | AccountsError.BlockReasonInvalid
  | AccountsError.UserRoleInvalid
  | AccountsError.UserRolesEmpty
  | AccountsError.FirstNameTooShort
  | AccountsError.LastNameTooShort
  | AccountsError.EmailInvalid
  | AccountsError.UpdateProfileNotFound
  | AccountsError.UpdateProfileValidationFailed
  | AccountsError.UpdateProfileUnauthenticated
  | AccountsError.UploadAvatarNotAnImage
  | AccountsError.UploadAvatarTooLarge;

export const AccountsError = {
  blockReasonInvalid(attempted: string): AccountsError.BlockReasonInvalid {
    return { errorCode: AccountsErrorCode.BlockReasonInvalid, attempted };
  },
  userRoleInvalid(attempted: string): AccountsError.UserRoleInvalid {
    return { errorCode: AccountsErrorCode.UserRoleInvalid, attempted };
  },
  userRolesEmpty(): AccountsError.UserRolesEmpty {
    return { errorCode: AccountsErrorCode.UserRolesEmpty };
  },
  firstNameTooShort(
    attempted: string,
    minLength: number,
  ): AccountsError.FirstNameTooShort {
    return {
      errorCode: AccountsErrorCode.FirstNameTooShort,
      attempted,
      minLength,
    };
  },
  lastNameTooShort(
    attempted: string,
    minLength: number,
  ): AccountsError.LastNameTooShort {
    return {
      errorCode: AccountsErrorCode.LastNameTooShort,
      attempted,
      minLength,
    };
  },
  emailInvalid(attempted: string): AccountsError.EmailInvalid {
    return { errorCode: AccountsErrorCode.EmailInvalid, attempted };
  },
  updateProfileNotFound(): AccountsError.UpdateProfileNotFound {
    return { errorCode: AccountsErrorCode.UpdateProfileNotFound };
  },
  updateProfileValidationFailed(): AccountsError.UpdateProfileValidationFailed {
    return { errorCode: AccountsErrorCode.UpdateProfileValidationFailed };
  },
  updateProfileUnauthenticated(): AccountsError.UpdateProfileUnauthenticated {
    return { errorCode: AccountsErrorCode.UpdateProfileUnauthenticated };
  },
  uploadAvatarNotAnImage(): AccountsError.UploadAvatarNotAnImage {
    return { errorCode: AccountsErrorCode.UploadAvatarNotAnImage };
  },
  uploadAvatarTooLarge(maxBytes: number): AccountsError.UploadAvatarTooLarge {
    return { errorCode: AccountsErrorCode.UploadAvatarTooLarge, maxBytes };
  },

  /** Narrows an error to one code — `AccountsError.is(e, AccountsErrorCode.EmailInvalid)`. */
  is<C extends AccountsErrorCode>(
    error: AccountsError,
    errorCode: C,
  ): error is Extract<AccountsError, { readonly errorCode: C }> {
    return error.errorCode === errorCode;
  },
} as const;

export namespace AccountsError {
  export type BlockReasonInvalid = {
    readonly errorCode: typeof AccountsErrorCode.BlockReasonInvalid;
    readonly attempted: string;
  };
  export type UserRoleInvalid = {
    readonly errorCode: typeof AccountsErrorCode.UserRoleInvalid;
    readonly attempted: string;
  };
  export type UserRolesEmpty = {
    readonly errorCode: typeof AccountsErrorCode.UserRolesEmpty;
  };
  export type FirstNameTooShort = {
    readonly errorCode: typeof AccountsErrorCode.FirstNameTooShort;
    readonly attempted: string;
    readonly minLength: number;
  };
  export type LastNameTooShort = {
    readonly errorCode: typeof AccountsErrorCode.LastNameTooShort;
    readonly attempted: string;
    readonly minLength: number;
  };
  export type EmailInvalid = {
    readonly errorCode: typeof AccountsErrorCode.EmailInvalid;
    readonly attempted: string;
  };
  export type UpdateProfileNotFound = {
    readonly errorCode: typeof AccountsErrorCode.UpdateProfileNotFound;
  };
  export type UpdateProfileValidationFailed = {
    readonly errorCode: typeof AccountsErrorCode.UpdateProfileValidationFailed;
  };
  export type UpdateProfileUnauthenticated = {
    readonly errorCode: typeof AccountsErrorCode.UpdateProfileUnauthenticated;
  };
  export type UploadAvatarNotAnImage = {
    readonly errorCode: typeof AccountsErrorCode.UploadAvatarNotAnImage;
  };
  export type UploadAvatarTooLarge = {
    readonly errorCode: typeof AccountsErrorCode.UploadAvatarTooLarge;
    readonly maxBytes: number;
  };
}
