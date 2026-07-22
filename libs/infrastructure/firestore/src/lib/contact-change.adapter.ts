import { Injectable, inject } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { FIREBASE_FUNCTIONS } from '@creativo/infrastructure/firebase-app';
import {
  ConfirmationCode,
  ContactChangeError,
  ContactChangePort,
  ContactChangeRequestId,
  ContactChangeTarget,
} from '@creativo/application/accounts';
import { UserId } from '@creativo/domain/accounts';
import { Result, fail, ok } from '@creativo/domain/kernel';

/** Cloud Functions callable names this adapter targets. Neither callable is
 * implemented yet in `apps/functions` (Phase 7 builds the actual handlers) —
 * a confirmation-code exchange needs server-side secret comparison the same
 * way OTP verification does, so this can't be a direct Firestore write. */
const REQUEST_CONTACT_CHANGE_CALLABLE = 'requestContactChange';
const CONFIRM_CONTACT_CHANGE_CALLABLE = 'confirmContactChange';

interface RequestContactChangePayload {
  userId: string;
  target: { kind: 'email'; email: string } | { kind: 'phone'; phone: string };
}

interface RequestContactChangeResponse {
  requestId: string;
}

interface ConfirmContactChangePayload {
  userId: string;
  requestId: string;
  code: string;
}

function targetToPayload(
  target: ContactChangeTarget,
): RequestContactChangePayload['target'] {
  return target.kind === 'email'
    ? { kind: 'email', email: target.email.value }
    : { kind: 'phone', phone: target.phone.value };
}

/** Thin `httpsCallable` wrapper for `ContactChangePort` — a change of an
 * already-authenticated user's email/phone needs the same server-side
 * confirmation-code verification OTP does, so (unlike `ProfilePort`) this
 * can't be a direct Firestore read/write. */
@Injectable()
export class CallableContactChangeAdapter implements ContactChangePort {
  private readonly functions = inject(FIREBASE_FUNCTIONS);

  async requestChange(
    userId: UserId,
    target: ContactChangeTarget,
  ): Promise<Result<ContactChangeRequestId, ContactChangeError>> {
    try {
      const callable = httpsCallable<
        RequestContactChangePayload,
        RequestContactChangeResponse
      >(this.functions, REQUEST_CONTACT_CHANGE_CALLABLE);
      const response = await callable({
        userId: userId.value,
        target: targetToPayload(target),
      });
      return ok(response.data.requestId as ContactChangeRequestId);
    } catch (error) {
      return fail(
        new ContactChangeError('Failed to request contact change', error),
      );
    }
  }

  async confirmChange(
    userId: UserId,
    requestId: ContactChangeRequestId,
    code: ConfirmationCode,
  ): Promise<Result<void, ContactChangeError>> {
    try {
      const callable = httpsCallable<ConfirmContactChangePayload, void>(
        this.functions,
        CONFIRM_CONTACT_CHANGE_CALLABLE,
      );
      await callable({
        userId: userId.value,
        requestId: requestId as string,
        code: code as string,
      });
      return ok(undefined);
    } catch (error) {
      return fail(
        new ContactChangeError('Failed to confirm contact change', error),
      );
    }
  }
}
