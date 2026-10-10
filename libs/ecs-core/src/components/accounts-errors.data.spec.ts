import { describe, expect, it } from 'vitest';
import { AccountsError, AccountsErrorCode } from './accounts-errors.data';

describe('AccountsError', () => {
  it('builds each struct with its dotted code and i18n params', () => {
    expect(AccountsError.blockReasonInvalid('x')).toEqual({
      code: 'accounts.block_reason.invalid',
      attempted: 'x',
    });
    expect(AccountsError.userRoleInvalid('owner')).toEqual({
      code: 'accounts.user_role.invalid',
      attempted: 'owner',
    });
    expect(AccountsError.userRolesEmpty()).toEqual({
      code: 'accounts.user.roles_empty',
    });
    expect(AccountsError.firstNameTooShort('A', 2)).toEqual({
      code: 'accounts.first_name.too_short',
      attempted: 'A',
      minLength: 2,
    });
    expect(AccountsError.lastNameTooShort('B', 2)).toEqual({
      code: 'accounts.last_name.too_short',
      attempted: 'B',
      minLength: 2,
    });
    expect(AccountsError.emailInvalid('nope')).toEqual({
      code: 'accounts.email.invalid',
      attempted: 'nope',
    });
    expect(AccountsError.updateProfileNotFound()).toEqual({
      code: 'accounts.update_profile.not_found',
    });
    expect(AccountsError.updateProfileValidationFailed()).toEqual({
      code: 'accounts.update_profile.validation_failed',
    });
    expect(AccountsError.uploadAvatarNotAnImage()).toEqual({
      code: 'accounts.upload_avatar.not_an_image',
    });
    expect(AccountsError.uploadAvatarTooLarge(5_242_880)).toEqual({
      code: 'accounts.upload_avatar.too_large',
      maxBytes: 5_242_880,
    });
  });

  it('keeps every code in the accounts namespace, each once', () => {
    const codes = Object.values(AccountsErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^accounts\.[a-z_.]+$/);
  });

  it('is() narrows by code', () => {
    const error: AccountsError = AccountsError.firstNameTooShort('A', 2);
    expect(AccountsError.is(error, AccountsErrorCode.FirstNameTooShort)).toBe(
      true,
    );
    expect(AccountsError.is(error, AccountsErrorCode.EmailInvalid)).toBe(false);
    if (AccountsError.is(error, AccountsErrorCode.FirstNameTooShort)) {
      expect(error.minLength).toBe(2);
    }
  });
});
