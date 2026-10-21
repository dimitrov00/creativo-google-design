import {
  type RepositoryError,
  Result,
  type UserId,
  type WaitlistRequestId,
  WaitlistStatus,
} from '@core/primitives';
import { WaitlistLifecycle, WriteOp } from '@core/components';
import { Collections, type WaitlistRequest } from '@core/entities';
import type { ClockPorts, CommitPorts } from '@core/ports';

/**
 * `cancelWaitlist` — withdraw a waitlist request (`cancel-waitlist.ts`,
 * blueprint §4.1): one transaction reads the request and plans its
 * `CANCELLED` transition (`WriteOp.transition`, the lifecycle slice has no
 * variant fields to delete). Idempotent on purpose — cancelling a request
 * already cancelled answers success and writes nothing: the caller's intent,
 * "stop watching", is already true. Not-found and not-yours answer
 * identically (an id's existence is no leak); a request the matcher has
 * concluded (`BOOKED`, `EXPIRED`) is refused rather than its history
 * rewritten.
 *
 * The two input refusals (no caller, no request id) are the edge decoder's
 * (`waitlist.wire.ts`, F1-3): this pipeline only ever sees a verified owner
 * and a request id.
 */

/** Why a withdrawal was refused — the ONLY source of these strings, the field `errorCode`. */
export const CancelWaitlistRefusalCode = {
  /** No such request, or not the caller's. */
  NotFound: 'BOOKING_WAITLIST_NOT_FOUND',
  /** The request already concluded (`BOOKED`, `EXPIRED`). */
  NotCancellable: 'BOOKING_WAITLIST_NOT_CANCELLABLE',
} as const;
export type CancelWaitlistRefusalCode =
  (typeof CancelWaitlistRefusalCode)[keyof typeof CancelWaitlistRefusalCode];

/** A refused withdrawal — a flat struct the edge translates by `errorCode`. */
export type CancelWaitlistRefusal = {
  readonly errorCode: CancelWaitlistRefusalCode;
};

export type CancelWaitlistCommand = {
  /** The verified caller — only the owner may withdraw. */
  readonly ownerUserId: UserId;
  readonly requestId: WaitlistRequestId;
};

export type CancelWaitlistAnswer = {
  readonly requestId: WaitlistRequestId;
};

export type CancelWaitlistPorts = CommitPorts & ClockPorts;

export const cancelWaitlist =
  (ports: CancelWaitlistPorts) =>
  async (
    cmd: CancelWaitlistCommand,
  ): Promise<
    Result<CancelWaitlistAnswer, CancelWaitlistRefusal | RepositoryError>
  > => {
    const path = [Collections.WaitlistRequests, cmd.requestId];
    // Read once, before the transaction: `decide` may run more than once.
    const atUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      (tx) => tx.get<WaitlistRequest>(path),
      (
        request,
      ): Result<
        { readonly writes: readonly WriteOp[] },
        CancelWaitlistRefusal
      > => {
        if (request === null || request.ownerUserId !== cmd.ownerUserId) {
          return Result.err({ errorCode: CancelWaitlistRefusalCode.NotFound });
        }
        // Already what the caller wants.
        if (request.waitlistStatus === WaitlistStatus.Cancelled) {
          return Result.ok({ writes: [] });
        }
        // `BOOKED`/`EXPIRED` are the matcher's terminal verdicts.
        if (!WaitlistLifecycle.isWatching(request)) {
          return Result.err({
            errorCode: CancelWaitlistRefusalCode.NotCancellable,
          });
        }
        const cancelled = WaitlistLifecycle.transition(
          request,
          WaitlistStatus.Cancelled,
          atUtcMs,
        );
        if (!cancelled.ok) {
          return Result.err({
            errorCode: CancelWaitlistRefusalCode.NotCancellable,
          });
        }
        const before = {
          waitlistStatus: request.waitlistStatus,
          waitlistStatusAtUtcMs: request.waitlistStatusAtUtcMs,
        };
        return Result.ok({
          writes: [
            WriteOp.transition(
              path,
              cancelled.value,
              WriteOp.variantFieldsToDelete(before, cancelled.value),
            ),
          ],
        });
      },
    );
    return committed.ok ? Result.ok({ requestId: cmd.requestId }) : committed;
  };
