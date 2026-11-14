import { describe, expect, it } from 'vitest';
import {
  BarberActivation,
  BarberEdit,
  BarberStatus,
  OfferingsEdit,
  type PermissionsCall,
  Role,
  StaffSetupItem,
  type TeamCall,
  TeamMemberStatus,
} from '@core/components';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import { Callables } from '@core/ports';
import {
  AccessScope,
  BarberId,
  ClientOperationId,
  Result,
  StaffCapability,
  UserId,
} from '@core/primitives';
import {
  type GatewayCall,
  deepFreeze,
  localDate,
  scriptedGatewayPorts,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { teamAdminPorts } from './team-admin.adapter';

const LISTED: TeamCall.Listed = {
  members: [
    {
      teamMemberStatus: TeamMemberStatus.RoleOnly,
      memberUserId: UserId.of('u-desk'),
      memberAccountName: 'Елена Василева',
      memberRoles: [Role.Receptionist],
    },
  ],
};

/** The owner cuts the front desk's hours. */
const SAVE: PermissionsCall = {
  changes: [
    {
      staffCapability: StaffCapability.Hours,
      role: Role.Receptionist,
      accessScope: AccessScope.None,
    },
  ],
};

const SAVED: PermissionsCall.Saved = {
  changes: [
    {
      staffCapability: StaffCapability.Hours,
      role: Role.Receptionist,
      accessScopeFrom: AccessScope.All,
      accessScopeTo: AccessScope.None,
    },
  ],
};

describe('teamAdminPorts (team onboarding D8; staff permissions P6)', () => {
  it('listTeam dials listTeam with nothing in, answering the rows as the server read them', async () => {
    const calls: GatewayCall[] = [];
    const ports = teamAdminPorts(
      scriptedGatewayPorts(
        { [Callables.ListTeam]: () => Result.ok(LISTED) },
        calls,
      ),
    );

    const answer = await ports.listTeam({});

    expect(unwrapOk(answer)).toBe(LISTED);
    expect(calls).toEqual([{ callable: Callables.ListTeam, input: {} }]);
  });

  it('setStaffPermissions dials setStaffPermissions with the cells as wanted, answering what really changed', async () => {
    const calls: GatewayCall[] = [];
    const ports = teamAdminPorts(
      scriptedGatewayPorts(
        { [Callables.SetStaffPermissions]: () => Result.ok(SAVED) },
        calls,
      ),
    );
    const call = deepFreeze({ ...SAVE });

    const answer = await ports.setStaffPermissions(call);

    expect(unwrapOk(answer)).toBe(SAVED);
    expect(calls).toEqual([
      { callable: Callables.SetStaffPermissions, input: SAVE },
    ]);
    // The input is sent as it is: the same object, untouched.
    expect(calls[0]?.input).toBe(call);
    expect(call).toEqual(SAVE);
  });

  it('a barber record’s five writes dial their own callables with the call as built, each answering the record', async () => {
    const NEW = BarberId.of('b-new');
    const act = (name: string) =>
      (ClientOperationId.parse(name) as { ok: true; value: ClientOperationId })
        .value;
    const saved: TeamCall.Saved = { barberId: NEW };
    const activation: TeamCall.Activation = {
      barberId: NEW,
      barberActivation: BarberActivation.NotReady,
      staffSetupItem: StaffSetupItem.Hours,
    };
    const calls: GatewayCall[] = [];
    const ports = teamAdminPorts(
      scriptedGatewayPorts(
        {
          [Callables.AddBarber]: () => Result.ok(saved),
          [Callables.EditBarber]: () => Result.ok(saved),
          [Callables.SetBarberOfferings]: () => Result.ok(saved),
          [Callables.DeleteDraftBarber]: () => Result.ok(saved),
          [Callables.ActivateBarber]: () => Result.ok(activation),
        },
        calls,
      ),
    );
    const add: TeamCall = deepFreeze({
      name: { bg: 'Николай Стоянов', en: null },
      locationIds: [],
      barberStartsLocalDate: localDate('2026-12-01'),
      barberLastWorkingLocalDate: null,
      barberDraftTargetStatus: BarberStatus.Public,
      barberJoinsAnyPool: true,
      operationId: act('b-new'),
    });
    const edit: TeamCall.Edit = deepFreeze({
      barberEdit: BarberEdit.Pool,
      barberJoinsAnyPool: false,
      barberId: NEW,
      operationId: act('op-edit'),
    });
    const copy: TeamCall.Offerings = deepFreeze({
      offeringsEdit: OfferingsEdit.Copy,
      copyFromBarberId: BarberId.of('ivan'),
      barberId: NEW,
      operationId: act('op-copy'),
    });
    const named: TeamCall.Named = deepFreeze({
      barberId: NEW,
      operationId: act('op-named'),
    });

    expect(unwrapOk(await ports.addBarber(add))).toBe(saved);
    expect(unwrapOk(await ports.editBarber(edit))).toBe(saved);
    expect(unwrapOk(await ports.setBarberOfferings(copy))).toBe(saved);
    expect(unwrapOk(await ports.deleteDraftBarber(named))).toBe(saved);
    expect(unwrapOk(await ports.activateBarber(named))).toBe(activation);

    expect(calls.map((call) => call.callable)).toEqual([
      Callables.AddBarber,
      Callables.EditBarber,
      Callables.SetBarberOfferings,
      Callables.DeleteDraftBarber,
      Callables.ActivateBarber,
    ]);
    // Each input is the call as built: the same object, untouched.
    expect(calls.map((call) => call.input)).toEqual([
      add,
      edit,
      copy,
      named,
      named,
    ]);
    expect(calls[0]?.input).toBe(add);
  });

  it('hands a refusal on as the one PipelineError, unchanged', async () => {
    const refused = PipelineError.fromWire('functions/permission-denied', {
      errorCode: 'GOVERNANCE_PERMISSIONS_FORBIDDEN',
    });
    const ports = teamAdminPorts(
      scriptedGatewayPorts({
        [Callables.SetStaffPermissions]: () => Result.err(refused),
        [Callables.ListTeam]: () => Result.err(refused),
      }),
    );

    expect(unwrapErr(await ports.setStaffPermissions(SAVE))).toBe(refused);
    expect(unwrapErr(await ports.listTeam({}))).toBe(refused);
  });

  it('answers PIPELINE_UNKNOWN when the client cannot reach a callable', async () => {
    const ports = teamAdminPorts(scriptedGatewayPorts());

    expect(unwrapErr(await ports.listTeam({})).errorCode).toBe(
      PipelineErrorCode.Unknown,
    );
    expect(unwrapErr(await ports.setStaffPermissions(SAVE)).errorCode).toBe(
      PipelineErrorCode.Unknown,
    );
  });
});
