import { PhoneNumberInvalidError } from '@creativo/domain/kernel';
import { EmailInvalidError } from './email.errors';
import { EmptyIdError } from './ids.errors';
import { FirstNameTooShortError } from './first-name.errors';
import { LastNameTooShortError } from './last-name.errors';

export type UserAccountValidationError =
  | EmptyIdError
  | PhoneNumberInvalidError
  | FirstNameTooShortError
  | LastNameTooShortError
  | EmailInvalidError;
