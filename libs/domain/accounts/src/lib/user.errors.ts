import { DomainError, PhoneNumberInvalidError } from '@creativo/domain/kernel';
import { BirthDateError } from './birth-date.errors';
import { EmailInvalidError } from './email.errors';
import { EmptyIdError } from './ids.errors';
import { FirstNameTooShortError } from './first-name.errors';
import { LastNameTooShortError } from './last-name.errors';
import { InvalidUserRoleError } from './user-role.errors';

export class EmptyRolesError extends DomainError {
  override readonly code = 'accounts.user.roles_empty' as const;
  constructor() {
    super(
      'A user must hold at least one role — a roleless user can do nothing',
    );
  }
}

export type UserValidationError =
  | EmptyIdError
  | PhoneNumberInvalidError
  | FirstNameTooShortError
  | LastNameTooShortError
  | EmailInvalidError
  | InvalidUserRoleError
  | EmptyRolesError
  | BirthDateError;
