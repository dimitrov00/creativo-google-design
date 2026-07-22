import { Brand, Result, fail, ok } from '@creativo/domain/kernel';
import { InvalidConfirmationCodeError } from './confirmation-code.errors';

/** The 6-digit code a user enters to confirm a contact change — a distinct concept from `application/identity`'s `OtpCode` (login vs. changing an already-authenticated account's contact), kept local to avoid a needless cross-context dependency. */
export type ConfirmationCode = Brand<string, 'ConfirmationCode'>;

export const ConfirmationCode = {
  create(raw: string): Result<ConfirmationCode, InvalidConfirmationCodeError> {
    return /^\d{6}$/.test(raw)
      ? ok(raw as ConfirmationCode)
      : fail(new InvalidConfirmationCodeError());
  },
} as const;
