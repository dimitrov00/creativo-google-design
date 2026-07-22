import { InjectionToken } from '@angular/core';
import { Brand, Result } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { ContactChangeTarget } from './contact-change-target';
import { ConfirmationCode } from './confirmation-code';
import { ContactChangeError } from './contact-change.errors';

export type ContactChangeRequestId = Brand<string, 'ContactChangeRequestId'>;

/** Two-step "request a new email/phone, then confirm with a code" flow — mirrors `application/identity`'s OTP shape, but for an already-authenticated user's existing account, not sign-in. */
export interface ContactChangePort {
  requestChange(
    userId: UserId,
    target: ContactChangeTarget,
  ): Promise<Result<ContactChangeRequestId, ContactChangeError>>;
  confirmChange(
    userId: UserId,
    requestId: ContactChangeRequestId,
    code: ConfirmationCode,
  ): Promise<Result<void, ContactChangeError>>;
}

export const CONTACT_CHANGE_PORT = new InjectionToken<ContactChangePort>(
  'ContactChangePort',
);
