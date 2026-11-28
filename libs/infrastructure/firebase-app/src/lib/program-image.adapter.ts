import {
  Callables,
  type GatewayPorts,
  type ProgramImageCallPorts,
} from '@core/ports';

/**
 * A DESCRIPTION'S PICTURE UPLOAD as the web's `ProgramImageCallPorts`
 * (`docs/architecture/decisions/2026-11-27-rich-text-for-programs-and-posts.md`,
 * decision 4): `addProgramImage`, dialled through the ONE typed callable
 * client — the request the pipeline built, sent as it is; the answer
 * decoded by `ProgramImageCall.decodeAdded`; a failure the one
 * `PipelineError` classification. Nothing is added or read here.
 */
export const programImageCallPorts = (
  gateway: GatewayPorts,
): ProgramImageCallPorts => ({
  addProgramImage: gateway.callableClient(Callables.AddProgramImage),
});
