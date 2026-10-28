import type { ClientPrivacyCall } from '@core/components';
import type { PipelineError } from '@core/errors';
import type { Result } from '@core/primitives';
import type { ClientPrivacyGatewayPorts } from '@core/ports';

/**
 * `completeClientErasure` — the admin's card's ONE erasure act, carried to
 * its end in the browser (audit-hardening Phase 3 WS-D, P3-L-21): the
 * server's `eraseClient` is resumable and budgeted (each call stamps, then
 * sweeps what its budget allows, then answers `erasureDone`), so the card
 * sends the SAME `ClientPrivacyCall` — the record and the act's ONE minted
 * operation id, captured at the preview — again until the answer says the
 * erasure is done. Every call is idempotent: a replayed stamp, sweep or
 * completion plans nothing twice.
 *
 * - A refusal or a failure (`PRIVACY_*`, a transport failure) ends the loop
 *   at once and is answered as it came — the record stays as the last
 *   call left it, and the next act resumes it.
 * - At most {@link MAX_ERASURE_CALLS} calls: past them the LAST answer is
 *   handed back (`erasureDone: false`) and the card words "not finished
 *   yet, try again" — never an unbounded loop over a stuck sweep.
 *
 * No clock, no id minted here (the act's id arrives in the call), no
 * decision of its own: the server decides what each call erases.
 */
export type CompleteClientErasurePorts = ClientPrivacyGatewayPorts;

/** The most `eraseClient` calls one act makes before it answers "not finished yet". */
export const MAX_ERASURE_CALLS = 10;

export const completeClientErasure =
  (ports: CompleteClientErasurePorts) =>
  async (
    call: ClientPrivacyCall,
  ): Promise<Result<ClientPrivacyCall.Erasure, PipelineError>> => {
    let answer = await ports.eraseClient(call);
    for (
      let calls = 1;
      calls < MAX_ERASURE_CALLS && answer.ok && !answer.value.erasureDone;
      calls++
    ) {
      answer = await ports.eraseClient(call);
    }
    return answer;
  };
