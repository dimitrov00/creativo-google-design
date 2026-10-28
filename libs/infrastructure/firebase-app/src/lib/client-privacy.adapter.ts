import {
  Callables,
  type ClientPrivacyGatewayPorts,
  type GatewayPorts,
} from '@core/ports';

/**
 * THE ADMIN'S PRIVACY CALLABLES as the web's `ClientPrivacyGatewayPorts`
 * (audit-hardening Phase 3, WS-C / WS-D): each dialled through the ONE
 * typed callable client (`gateway.callableClient`) — its request the
 * `ClientPrivacyCall` the staff client card captured (the record and the
 * act's own minted id, sent as they are), its answer decoded by the
 * callable's own decoder (`ClientPrivacyCall.decodeExported`,
 * `.decodeErasurePreview`, `.decodeErasure`), its failure the one
 * `PipelineError` classification. Nothing is added or read here: the
 * bundle's text reaches the card byte for byte, and the erasure's census
 * reaches the card as the server counted it.
 *
 * - `exportClientData` — the person's ONE JSON bundle (Art. 15 / 20).
 * - `previewClientErasure` — read-only: the census and the sibling records
 *   the card's ONE alert words.
 * - `eraseClient` — one resumable call of the erasure (Art. 17); the card
 *   loops it through `completeClientErasure` with the SAME call.
 */
export const clientPrivacyPorts = (
  gateway: GatewayPorts,
): ClientPrivacyGatewayPorts => ({
  exportClientData: (call) =>
    gateway.callableClient(Callables.ExportClientData)(call),
  previewClientErasure: (call) =>
    gateway.callableClient(Callables.PreviewClientErasure)(call),
  eraseClient: (call) => gateway.callableClient(Callables.EraseClient)(call),
});
