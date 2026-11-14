import { Callables, type GatewayPorts, type TeamAdminPorts } from '@core/ports';

/**
 * THE TEAM SCREENS' CALLS as the web's `TeamAdminPorts` (team onboarding
 * D8; staff permissions P6, P10): `listTeam` and `setStaffPermissions`
 * dialled through the ONE typed callable client (`gateway.callableClient`)
 * — the request the call struct the screen's store built, sent as it is
 * (the client adds the operation id: a read's is the transport's, the save's
 * names the act); the answer decoded by the call component's own decoder
 * (`TeamCall.decodeListed`, `PermissionsCall.decodeSaved`); a failure the
 * one `PipelineError` classification. Nothing is added or read here.
 */
export const teamAdminPorts = (gateway: GatewayPorts): TeamAdminPorts => ({
  listTeam: gateway.callableClient(Callables.ListTeam),
  setStaffPermissions: gateway.callableClient(Callables.SetStaffPermissions),
});
