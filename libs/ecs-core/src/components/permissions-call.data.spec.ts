import { describe, expect, it } from 'vitest';
import { PipelineErrorCode } from '@core/errors';
import { AccessScope, StaffCapability } from '@core/primitives';
import { deepFreeze, unwrapErr, unwrapOk } from '@core/testing';
import { PermissionsCall } from './permissions-call.data';
import { Role } from './role.data';
import { StaffTarget, StaffReach } from './staff-target.data';

/*
 * The permissions-save wire (staff permissions P6): `setStaffPermissions`'
 * answer through the capability, level and scope dictionaries; anything
 * else `PIPELINE_UNKNOWN`. The server answers the pipeline's value as it is
 * (Law 5 — no encoder).
 */

/** A usable answer as the server encodes it. */
const ANSWER = deepFreeze({
  changes: [
    {
      staffCapability: 'HOURS',
      role: 'receptionist',
      accessScopeFrom: 'ALL',
      accessScopeTo: 'NONE',
    },
    {
      staffCapability: 'TIME_OFF',
      role: 'barber',
      accessScopeFrom: 'OWN',
      accessScopeTo: 'ALL',
    },
  ],
});

describe('PermissionsCall — the setStaffPermissions call', () => {
  it('carries the cells the owner changed — the server adds the caller', () => {
    const call: PermissionsCall = {
      changes: [
        {
          staffCapability: StaffCapability.Hours,
          role: Role.Receptionist,
          accessScope: AccessScope.None,
        },
      ],
    };
    expect(Object.keys(call)).toEqual(['changes']);
    expect(Object.keys(call.changes[0] ?? {}).sort()).toEqual([
      'accessScope',
      'role',
      'staffCapability',
    ]);
  });

  it('is never longer than the grid: one entry per cell at most', () => {
    expect(PermissionsCall.CHANGES_MAX).toBe(
      3 * Object.values(StaffCapability).length,
    );
  });

  it('decodes the changed cells, in the order answered', () => {
    expect(unwrapOk(PermissionsCall.decodeSaved(ANSWER))).toEqual(ANSWER);
    // The wire's own bytes read back the same.
    expect(
      unwrapOk(PermissionsCall.decodeSaved(JSON.parse(JSON.stringify(ANSWER)))),
    ).toEqual(ANSWER);
  });

  it('decodes a save that changed nothing as no change', () => {
    expect(unwrapOk(PermissionsCall.decodeSaved({ changes: [] }))).toEqual({
      changes: [],
    });
  });

  it.each([
    ['nothing', null],
    ['a list', [ANSWER]],
    ['no changes', {}],
    ['changes that are no list', { changes: 'HOURS' }],
    ['a cell that is no object', { changes: ['HOURS'] }],
    [
      'an unknown capability',
      { changes: [{ ...ANSWER.changes[0], staffCapability: 'BOOKING' }] },
    ],
    [
      'a level the owner does not edit',
      { changes: [{ ...ANSWER.changes[0], role: 'admin' }] },
    ],
    [
      'an unknown scope before',
      { changes: [{ ...ANSWER.changes[0], accessScopeFrom: 'EVERYONE' }] },
    ],
    [
      'no scope after',
      { changes: [{ ...ANSWER.changes[0], accessScopeTo: null }] },
    ],
    [
      'one bad cell among good ones',
      { changes: [ANSWER.changes[0], { staffCapability: 'HOURS' }] },
    ],
  ])(
    'answers %s as PIPELINE_UNKNOWN — the whole answer is unusable',
    (_what, raw) => {
      expect(unwrapErr(PermissionsCall.decodeSaved(raw)).errorCode).toBe(
        PipelineErrorCode.Unknown,
      );
    },
  );

  it('is pure: same input → same output, input untouched', () => {
    expect(PermissionsCall.decodeSaved(ANSWER)).toEqual(
      PermissionsCall.decodeSaved(ANSWER),
    );
  });
});

describe('StaffTarget — what a staff act reaches (staff permissions P3)', () => {
  it('the shop is one shared struct that names no barber', () => {
    expect(StaffTarget.SHOP).toEqual({ staffReach: StaffReach.Shop });
    expect(StaffTarget.SHOP).toBe(StaffTarget.SHOP);
  });

  it('a barbers target carries the ids as given — never copied', () => {
    const ids = deepFreeze(['ivan', 'niko']) as never;
    const target = StaffTarget.barbers(ids);
    expect(target).toEqual({
      staffReach: StaffReach.Barbers,
      targetBarberIds: ['ivan', 'niko'],
    });
    expect(target.targetBarberIds).toBe(ids);
    // Naming none is still a barbers target: "own only" refuses it.
    expect(StaffTarget.barbers([])).toEqual({
      staffReach: 'BARBERS',
      targetBarberIds: [],
    });
  });
});
