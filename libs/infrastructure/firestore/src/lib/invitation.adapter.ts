import { Injectable, inject } from '@angular/core';
import { DocumentData, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  Invitation,
  InvitationId,
  InvitationRedemption,
} from '@creativo/domain/engagement';
import { InvitationPort } from '@creativo/application/engagement';
import { RepositoryError } from '@creativo/application/shared';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  invitationDocRef,
  invitationRedemptionDocRef,
} from './firestore-paths';

function toPersistence(invitation: Invitation): DocumentData {
  return {
    inviterUserId: invitation.inviterUserId.value,
    inviterName: invitation.inviterName,
    redemptionCount: invitation.redemptionCount,
    createdAt: invitation.createdAt.toISO(),
  };
}

function toDomain(
  id: string,
  data: DocumentData,
): Result<Invitation, RepositoryError> {
  // `createdAt` is a `ZonedDateTime` VO in `Invitation`'s props, never a raw
  // ISO string — timestamps here carry no Europe/Sofia business-hours
  // meaning (just "when was this minted"), so a fixed `UTC` zone is used,
  // matching the governance context's `ImpersonationSession` convention.
  const createdAtResult = ZonedDateTime.fromISO(data['createdAt'], 'UTC');
  if (createdAtResult.isFailure()) {
    return fail(
      new RepositoryError(
        'Malformed invitation createdAt',
        createdAtResult.error,
      ),
    );
  }

  const reconstituted = Invitation.reconstitute({
    id,
    inviterUserId: data['inviterUserId'],
    inviterName: data['inviterName'],
    redemptionCount: data['redemptionCount'],
    createdAt: createdAtResult.value,
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError('Malformed invitation document', reconstituted.error),
    );
  }
  return ok(reconstituted.value);
}

function redemptionToPersistence(
  redemption: InvitationRedemption,
): DocumentData {
  return {
    redeemedAt: redemption.redeemedAt.toISO(),
  };
}

@Injectable()
export class FirestoreInvitationAdapter implements InvitationPort {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async findById(
    id: InvitationId,
  ): Promise<Result<Invitation | null, RepositoryError>> {
    try {
      const snapshot = await getDoc(invitationDocRef(this.db, id));
      if (!snapshot.exists()) {
        return ok(null);
      }
      return toDomain(snapshot.id, snapshot.data());
    } catch (error) {
      return fail(new RepositoryError('Failed to fetch invitation', error));
    }
  }

  /**
   * Handles both the initial mint (fresh doc, `redemptionCount` 0) and the
   * per-redemption bump. `firestore.rules`' `update` rule only allows the
   * `redemptionCount` field to change (by exactly +1) — a full `setDoc`
   * resend of every field would violate `affectedKeys().hasOnly([...])` on
   * that second path, so an existing invitation is updated with a
   * single-field `updateDoc` instead; only a brand-new invitation goes
   * through `setDoc`.
   */
  async save(invitation: Invitation): Promise<Result<void, RepositoryError>> {
    try {
      const ref = invitationDocRef(this.db, invitation.id);
      const existing = await getDoc(ref);
      if (!existing.exists()) {
        await setDoc(ref, toPersistence(invitation));
      } else {
        await updateDoc(ref, { redemptionCount: invitation.redemptionCount });
      }
      return ok(undefined);
    } catch (error) {
      return fail(new RepositoryError('Failed to save invitation', error));
    }
  }

  async saveRedemption(
    redemption: InvitationRedemption,
  ): Promise<Result<void, RepositoryError>> {
    try {
      await setDoc(
        invitationRedemptionDocRef(
          this.db,
          redemption.invitationId,
          redemption.refereeUserId,
        ),
        redemptionToPersistence(redemption),
      );
      return ok(undefined);
    } catch (error) {
      // A repeat redemption attempt for the same referee hits an existing
      // doc; `firestore.rules` denies `update` on this subcollection, so
      // Firestore itself rejects the overwrite — surfaces here as a
      // RepositoryError rather than a silent no-op.
      return fail(
        new RepositoryError('Failed to save invitation redemption', error),
      );
    }
  }
}
