import { Callables, type GatewayPorts, type TeamAdminPorts } from '@core/ports';

/**
 * THE TEAM SCREENS' CALLS as the web's `TeamAdminPorts` (team onboarding
 * D5, D8, D9; staff permissions P6, P10): `listTeam`, `setStaffPermissions`
 * and a barber record's five writes, each dialled through the ONE typed
 * callable client (`gateway.callableClient`) — the request the call struct
 * the screen's store built, sent as it is (a record's write carries the
 * act's own minted operation id; the client names a read's and the
 * permissions save's); the answer decoded by the call component's own
 * decoder (`TeamCall.decodeListed`, `decodeSaved`, `decodeActivation`,
 * `PermissionsCall.decodeSaved`); a failure the one `PipelineError`
 * classification. Nothing is added or read here.
 */
export const teamAdminPorts = (gateway: GatewayPorts): TeamAdminPorts => ({
  listTeam: gateway.callableClient(Callables.ListTeam),
  setStaffPermissions: gateway.callableClient(Callables.SetStaffPermissions),
  addBarber: gateway.callableClient(Callables.AddBarber),
  editBarber: gateway.callableClient(Callables.EditBarber),
  setBarberOfferings: gateway.callableClient(Callables.SetBarberOfferings),
  deleteDraftBarber: gateway.callableClient(Callables.DeleteDraftBarber),
  activateBarber: gateway.callableClient(Callables.ActivateBarber),
});
