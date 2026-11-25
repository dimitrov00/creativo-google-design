import {
  Callables,
  type GatewayPorts,
  type ReadAsCallPorts,
} from '@core/ports';

/**
 * THE SUPPORT READ-AS's TWO CALLS as the web's `ReadAsCallPorts` (OR-24,
 * docs/designs/support-read-as.md): `startImpersonation` and
 * `endImpersonation` dialled through the ONE typed callable client — the
 * requests the support tool built, sent as they are (the client adds the
 * transport operation id), the answers decoded by `GovernanceCall`, a
 * failure the one `PipelineError` classification. Nothing is added or read
 * here.
 */
export const readAsCallPorts = (gateway: GatewayPorts): ReadAsCallPorts => ({
  startReadAs: gateway.callableClient(Callables.StartImpersonation),
  endReadAs: gateway.callableClient(Callables.EndImpersonation),
});
