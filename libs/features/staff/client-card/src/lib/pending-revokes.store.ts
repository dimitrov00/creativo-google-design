import { Injectable, signal, untracked } from '@angular/core';
import type { RolesCall } from '@core/components';
import type { PipelineError } from '@core/errors';
import type { ClientOperationId, UserId } from '@core/primitives';

/**
 * The «Роли» block's act (security hardening S-WS-E): the account, the
 * whole new set and the act's own minted operation id — ONE call, sent
 * again verbatim by a retry of the same act. The id rides the payload
 * under `operationId` (`OPERATION_ID_FIELD`), so the callable client mints
 * no transport id of its own over it.
 */
export type RolesAct = RolesCall & { readonly operationId: ClientOperationId };

/**
 * A roles change the server committed but whose sessions it could not
 * revoke (`GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED`, S-RU-10): the act, kept
 * for its retry (the stored set, sent again), and the refusal its line
 * words.
 */
export interface PendingRevoke {
  readonly call: RolesAct;
  readonly error: PipelineError;
}

/**
 * THE FAILED REVOKES, per account (security hardening S-RU-10, S-L-18;
 * review round 1, finding 6). Provided in the ROOT injector, so the memory
 * outlives the visit sheet whose card store made the call: every
 * `ClientCardStore` — one per sheet, the visit editor's and the create
 * editor's alike — reads and writes this one map, and a person's card
 * opened in a later sheet still offers the retry (Save re-sends the stored
 * set under the act's kept operation id) until a revoke succeeds. It lives
 * as long as the admin's tab: a reload or another device starts empty —
 * the operator's remedy then is the runbook's (§3 step 7).
 */
@Injectable({ providedIn: 'root' })
export class PendingRevokesStore {
  private readonly _pending = signal<ReadonlyMap<UserId, PendingRevoke>>(
    new Map(),
  );

  /** The failed revokes, per account: each one's Save stays offered until a revoke succeeds. */
  readonly pending = this._pending.asReadonly();

  /** A failed revoke, remembered with its act — over any earlier one of the same account. */
  remember(revoke: PendingRevoke): void {
    const pending = new Map(untracked(this._pending));
    pending.set(revoke.call.targetUserId, revoke);
    this._pending.set(pending);
  }

  /** A saved answer: the account's revoke succeeded, so nothing of it is pending any more. */
  forget(targetUserId: UserId): void {
    const current = untracked(this._pending);
    if (!current.has(targetUserId)) return;
    const pending = new Map(current);
    pending.delete(targetUserId);
    this._pending.set(pending);
  }
}
