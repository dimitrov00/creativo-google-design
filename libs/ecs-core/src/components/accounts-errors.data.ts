/**
 * The accounts context's error codes — the dotted codes of
 * `libs/domain/accounts/src/lib/*.errors.ts` and of the accounts use cases
 * (`update-profile.errors.ts`, the avatar upload checks), reused as is,
 * collapsed from `DomainError` subclasses into one dictionary of plain
 * structs (blueprint §2.4, §2.7). Every non-`code` field is an i18n
 * parameter, so each one is an i18n-safe scalar (infrastructure Q5).
 *
 * Not here: the birth-date age window (one `BirthDate` now, its refusals are
 * the translated `identity.birth_date.*` codes of `identity-errors.data.ts`),
 * contact change (§9 D12(b): not shipped) and storage/repository failures
 * (`repository-errors.data.ts`, `media-errors.data.ts`).
 */
export const AccountsErrorCode = {
  /** A block reason outside the `BlockReason` dictionary. */
  BlockReasonInvalid: 'accounts.block_reason.invalid',
  /** A role outside the `Role` dictionary. */
  UserRoleInvalid: 'accounts.user_role.invalid',
  /** A registered user holds no role — a roleless user can do nothing. */
  UserRolesEmpty: 'accounts.user.roles_empty',
  /** Shorter than `minLength` after trimming. */
  FirstNameTooShort: 'accounts.first_name.too_short',
  /** Shorter than `minLength` after trimming. */
  LastNameTooShort: 'accounts.last_name.too_short',
  /** Not an e-mail address (`Email.parse` refused it). */
  EmailInvalid: 'accounts.email.invalid',
  /** No `users/{uid}` document to edit. */
  UpdateProfileNotFound: 'accounts.update_profile.not_found',
  /** The edited profile failed a field rule. */
  UpdateProfileValidationFailed: 'accounts.update_profile.validation_failed',
  /** The picked avatar file is not an image. */
  UploadAvatarNotAnImage: 'accounts.upload_avatar.not_an_image',
  /** The picked avatar file is over `maxBytes`. */
  UploadAvatarTooLarge: 'accounts.upload_avatar.too_large',
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
  | AccountsError.UploadAvatarNotAnImage
  | AccountsError.UploadAvatarTooLarge;

export const AccountsError = {
  blockReasonInvalid(attempted: string): AccountsError.BlockReasonInvalid {
    return { code: AccountsErrorCode.BlockReasonInvalid, attempted };
  },
  userRoleInvalid(attempted: string): AccountsError.UserRoleInvalid {
    return { code: AccountsErrorCode.UserRoleInvalid, attempted };
  },
  userRolesEmpty(): AccountsError.UserRolesEmpty {
    return { code: AccountsErrorCode.UserRolesEmpty };
  },
  firstNameTooShort(
    attempted: string,
    minLength: number,
  ): AccountsError.FirstNameTooShort {
    return { code: AccountsErrorCode.FirstNameTooShort, attempted, minLength };
  },
  lastNameTooShort(
    attempted: string,
    minLength: number,
  ): AccountsError.LastNameTooShort {
    return { code: AccountsErrorCode.LastNameTooShort, attempted, minLength };
  },
  emailInvalid(attempted: string): AccountsError.EmailInvalid {
    return { code: AccountsErrorCode.EmailInvalid, attempted };
  },
  updateProfileNotFound(): AccountsError.UpdateProfileNotFound {
    return { code: AccountsErrorCode.UpdateProfileNotFound };
  },
  updateProfileValidationFailed(): AccountsError.UpdateProfileValidationFailed {
    return { code: AccountsErrorCode.UpdateProfileValidationFailed };
  },
  uploadAvatarNotAnImage(): AccountsError.UploadAvatarNotAnImage {
    return { code: AccountsErrorCode.UploadAvatarNotAnImage };
  },
  uploadAvatarTooLarge(maxBytes: number): AccountsError.UploadAvatarTooLarge {
    return { code: AccountsErrorCode.UploadAvatarTooLarge, maxBytes };
  },

  /** Narrows an error to one code — `AccountsError.is(e, AccountsErrorCode.EmailInvalid)`. */
  is<C extends AccountsErrorCode>(
    error: AccountsError,
    code: C,
  ): error is Extract<AccountsError, { readonly code: C }> {
    return error.code === code;
  },
} as const;

export namespace AccountsError {
  export type BlockReasonInvalid = {
    readonly code: typeof AccountsErrorCode.BlockReasonInvalid;
    readonly attempted: string;
  };
  export type UserRoleInvalid = {
    readonly code: typeof AccountsErrorCode.UserRoleInvalid;
    readonly attempted: string;
  };
  export type UserRolesEmpty = {
    readonly code: typeof AccountsErrorCode.UserRolesEmpty;
  };
  export type FirstNameTooShort = {
    readonly code: typeof AccountsErrorCode.FirstNameTooShort;
    readonly attempted: string;
    readonly minLength: number;
  };
  export type LastNameTooShort = {
    readonly code: typeof AccountsErrorCode.LastNameTooShort;
    readonly attempted: string;
    readonly minLength: number;
  };
  export type EmailInvalid = {
    readonly code: typeof AccountsErrorCode.EmailInvalid;
    readonly attempted: string;
  };
  export type UpdateProfileNotFound = {
    readonly code: typeof AccountsErrorCode.UpdateProfileNotFound;
  };
  export type UpdateProfileValidationFailed = {
    readonly code: typeof AccountsErrorCode.UpdateProfileValidationFailed;
  };
  export type UploadAvatarNotAnImage = {
    readonly code: typeof AccountsErrorCode.UploadAvatarNotAnImage;
  };
  export type UploadAvatarTooLarge = {
    readonly code: typeof AccountsErrorCode.UploadAvatarTooLarge;
    readonly maxBytes: number;
  };
}
