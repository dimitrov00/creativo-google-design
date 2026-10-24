import { Result, type UserId, type WaitlistRequestId } from '@core/primitives';
import type { CancelWaitlistRefusal, RepositoryError } from '@core/errors';
import { Collections, type WaitlistRequest } from '@core/entities';
import type { ClockPorts, CommitPorts } from '@core/ports';
import { WaitlistSystem } from '@core/systems';

/**
 * `cancelWaitlist` — withdraw a waitlist request (`cancel-waitlist.ts`,
 * blueprint §4.1): one transaction reads the request, and
 * `WaitlistSystem.cancel` decides — its `CANCELLED` transition, nothing for
 * a request already cancelled (idempotent on purpose), not-found and
 * not-yours alike, and a request the matcher concluded refused.
 *
 * The two input refusals (no caller, no request id) are the edge decoder's
 * (`waitlist.wire.ts`, F1-3): this pipeline only ever sees a verified owner
 * and a request id.
 */

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
      (request) => WaitlistSystem.cancel(request, cmd.ownerUserId, atUtcMs),
    );
    return committed.ok ? Result.ok({ requestId: cmd.requestId }) : committed;
  };
