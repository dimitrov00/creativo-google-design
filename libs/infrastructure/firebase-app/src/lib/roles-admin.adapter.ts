import {
  Callables,
  type GatewayPorts,
  type RolesAdminPorts,
} from '@core/ports';

/**
 * THE ADMIN'S ROLES CHANGE as the web's `RolesAdminPorts` (security
 * hardening S-WS-E, S-RU-13): `setRoles` dialled through the ONE typed
 * callable client (`gateway.callableClient`) — its request the
 * `RolesCall` the staff client card's «Роли» block captured (the account,
 * the whole new set and the act's own minted operation id, sent as they
 * are), its answer decoded by `RolesCall.decodeChanged`, its failure the one
 * `PipelineError` classification. Nothing is added or read here.
 */
export const rolesAdminPorts = (gateway: GatewayPorts): RolesAdminPorts => ({
  setRoles: gateway.callableClient(Callables.SetRoles),
});
