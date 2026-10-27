import {
  Callables,
  type ClientPrivacyGatewayPorts,
  type GatewayPorts,
} from '@core/ports';

/**
 * THE ADMIN'S PRIVACY CALLABLES as the web's `ClientPrivacyGatewayPorts`
 * (audit-hardening Phase 3, WS-C): `exportClientData` dialled through the
 * ONE typed callable client (`gateway.callableClient`) — its request the
 * `ClientPrivacyCall` the staff client card captured (the record and the
 * act's own minted id, sent as they are), its answer decoded by
 * `ClientPrivacyCall.decodeExported`, its failure the one `PipelineError`
 * classification. Nothing is added or read here: the bundle's text reaches
 * the card byte for byte, and the card saves it.
 */
export const clientPrivacyPorts = (
  gateway: GatewayPorts,
): ClientPrivacyGatewayPorts => ({
  exportClientData: (call) =>
    gateway.callableClient(Callables.ExportClientData)(call),
});
