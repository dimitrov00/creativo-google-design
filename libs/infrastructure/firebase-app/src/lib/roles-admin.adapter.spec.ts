import { describe, expect, it } from 'vitest';
import { Role, type RolesCall } from '@core/components';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import { Callables } from '@core/ports';
import { ClientOperationId, Result, UserId } from '@core/primitives';
import {
  type GatewayCall,
  deepFreeze,
  scriptedGatewayPorts,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { rolesAdminPorts } from './roles-admin.adapter';

/** The card's act: the account, the whole new set, its own minted operation id. */
const CALL: RolesCall & { readonly operationId: ClientOperationId } = {
  targetUserId: UserId.of('dev-client-1'),
  roles: [Role.Client, Role.Barber],
  operationId: unwrapOk(ClientOperationId.parse('op-card-roles-0001')),
};

const CHANGED: RolesCall.Changed = {
  targetUserId: CALL.targetUserId,
  roles: [Role.Client, Role.Barber],
  rolesChanged: true,
};

describe('rolesAdminPorts (security hardening S-WS-E)', () => {
  it('setRoles dials setRoles with the call as captured, answering the stored set as the server decided it', async () => {
    const calls: GatewayCall[] = [];
    const ports = rolesAdminPorts(
      scriptedGatewayPorts(
        { [Callables.SetRoles]: () => Result.ok(CHANGED) },
        calls,
      ),
    );
    const call = deepFreeze({ ...CALL });

    const answer = await ports.setRoles(call);

    expect(unwrapOk(answer)).toBe(CHANGED);
    expect(calls).toEqual([{ callable: Callables.SetRoles, input: CALL }]);
    // The input is sent as it is: the same object, its operation id included, untouched.
    expect(calls[0]?.input).toBe(call);
    expect(call).toEqual(CALL);
  });

  it('hands a refusal on as the one PipelineError, unchanged', async () => {
    const refused = PipelineError.fromWire('functions/unavailable', {
      errorCode: 'GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED',
    });
    const ports = rolesAdminPorts(
      scriptedGatewayPorts({ [Callables.SetRoles]: () => Result.err(refused) }),
    );

    const error = unwrapErr(await ports.setRoles(CALL));

    expect(error).toBe(refused);
    expect(error.serverErrorCode).toBe('GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED');
  });

  it('answers PIPELINE_UNKNOWN when the client cannot reach the callable', async () => {
    const ports = rolesAdminPorts(scriptedGatewayPorts());

    const error = unwrapErr(await ports.setRoles(CALL));

    expect(error.errorCode).toBe(PipelineErrorCode.Unknown);
  });
});
