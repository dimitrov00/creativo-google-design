import { describe, expect, it } from 'vitest';
import { AccountsError, AccountsErrorCode } from './accounts.error';

describe('AccountsError', () => {
  it('builds each struct with its errorCode and i18n params', () => {
    expect(AccountsError.blockReasonInvalid('x')).toEqual({
      errorCode: 'ACCOUNTS_BLOCK_REASON_INVALID',
      attempted: 'x',
    });
    expect(AccountsError.userRoleInvalid('owner')).toEqual({
      errorCode: 'ACCOUNTS_USER_ROLE_INVALID',
      attempted: 'owner',
    });
    expect(AccountsError.userRolesEmpty()).toEqual({
      errorCode: 'ACCOUNTS_USER_ROLES_EMPTY',
    });
    expect(AccountsError.firstNameTooShort('A', 2)).toEqual({
      errorCode: 'ACCOUNTS_FIRST_NAME_TOO_SHORT',
      attempted: 'A',
      minLength: 2,
    });
    expect(AccountsError.lastNameTooShort('B', 2)).toEqual({
      errorCode: 'ACCOUNTS_LAST_NAME_TOO_SHORT',
      attempted: 'B',
      minLength: 2,
    });
    expect(AccountsError.emailInvalid('nope')).toEqual({
      errorCode: 'ACCOUNTS_EMAIL_INVALID',
      attempted: 'nope',
    });
    expect(AccountsError.updateProfileNotFound()).toEqual({
      errorCode: 'ACCOUNTS_UPDATE_PROFILE_NOT_FOUND',
    });
    expect(AccountsError.updateProfileValidationFailed()).toEqual({
      errorCode: 'ACCOUNTS_UPDATE_PROFILE_VALIDATION_FAILED',
    });
    expect(AccountsError.updateProfileUnauthenticated()).toEqual({
      errorCode: 'ACCOUNTS_UPDATE_PROFILE_UNAUTHENTICATED',
    });
    expect(AccountsError.uploadAvatarNotAnImage()).toEqual({
      errorCode: 'ACCOUNTS_UPLOAD_AVATAR_NOT_AN_IMAGE',
    });
    expect(AccountsError.uploadAvatarTooLarge(5_242_880)).toEqual({
      errorCode: 'ACCOUNTS_UPLOAD_AVATAR_TOO_LARGE',
      maxBytes: 5_242_880,
    });
    expect(AccountsError.uploadAvatarUploadFailed()).toEqual({
      errorCode: 'ACCOUNTS_UPLOAD_AVATAR_UPLOAD_FAILED',
    });
    expect(AccountsError.removeAvatarRemoveFailed()).toEqual({
      errorCode: 'ACCOUNTS_REMOVE_AVATAR_REMOVE_FAILED',
    });
    expect(AccountsError.updateProfileRepositoryFailure()).toEqual({
      errorCode: 'ACCOUNTS_UPDATE_PROFILE_REPOSITORY_FAILURE',
    });
    expect(AccountsError.repositoryFailure()).toEqual({
      errorCode: 'ACCOUNTS_REPOSITORY_FAILURE',
    });
  });

  it('spells the web’s own failure words — the successors of the dotted i18n keys (Phase 4b, 4B-4)', () => {
    expect(AccountsErrorCode.UploadAvatarUploadFailed).toBe(
      'ACCOUNTS_UPLOAD_AVATAR_UPLOAD_FAILED',
    );
    expect(AccountsErrorCode.RemoveAvatarRemoveFailed).toBe(
      'ACCOUNTS_REMOVE_AVATAR_REMOVE_FAILED',
    );
    expect(AccountsErrorCode.UpdateProfileRepositoryFailure).toBe(
      'ACCOUNTS_UPDATE_PROFILE_REPOSITORY_FAILURE',
    );
    expect(AccountsErrorCode.RepositoryFailure).toBe(
      'ACCOUNTS_REPOSITORY_FAILURE',
    );
  });

  it('keeps every code in the ACCOUNTS_ domain, SCREAMING_SNAKE, each once', () => {
    const codes = Object.values(AccountsErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^ACCOUNTS_[A-Z_]+$/);
  });

  it('is() narrows by errorCode', () => {
    const error: AccountsError = AccountsError.firstNameTooShort('A', 2);
    expect(AccountsError.is(error, AccountsErrorCode.FirstNameTooShort)).toBe(
      true,
    );
    expect(AccountsError.is(error, AccountsErrorCode.EmailInvalid)).toBe(false);
    if (AccountsError.is(error, AccountsErrorCode.FirstNameTooShort)) {
      expect(error.minLength).toBe(2);
    }
  });

  it('OwnProfileSave names exactly the three answers of an own-profile save (pass D §2.11)', () => {
    const answers: readonly AccountsError.OwnProfileSave[] = [
      AccountsError.updateProfileNotFound(),
      AccountsError.updateProfileValidationFailed(),
      AccountsError.updateProfileRepositoryFailure(),
    ];
    expect(answers.map((answer) => answer.errorCode)).toEqual([
      'ACCOUNTS_UPDATE_PROFILE_NOT_FOUND',
      'ACCOUNTS_UPDATE_PROFILE_VALIDATION_FAILED',
      'ACCOUNTS_UPDATE_PROFILE_REPOSITORY_FAILURE',
    ]);
    // @ts-expect-error — an invalid e-mail is no own-profile save answer.
    const stranger: AccountsError.OwnProfileSave =
      AccountsError.emailInvalid('x');
    expect(stranger.errorCode).toBe('ACCOUNTS_EMAIL_INVALID');
  });
});
