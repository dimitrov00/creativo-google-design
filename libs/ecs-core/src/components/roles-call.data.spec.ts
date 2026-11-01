import { describe, expect, it } from 'vitest';
import { PipelineErrorCode } from '@core/errors';
import { UserId } from '@core/primitives';
import { deepFreeze, unwrapErr, unwrapOk } from '@core/testing';
import { Role } from './role.data';
import { RolesCall } from './roles-call.data';

/*
 * The roles-change wire (security hardening S-WS-E): `setRoles`' answer
 * through `UserId.parse`, the `Role` dictionary and a boolean; anything
 * else `PIPELINE_UNKNOWN`. The server answers the pipeline's value as it is
 * (Law 5 — no encoder).
 */

/** A usable answer as the server encodes it. */
const ANSWER = deepFreeze({
  targetUserId: 'u-target',
  roles: ['client', 'barber'],
  rolesChanged: true,
});

describe('RolesCall — the setRoles call', () => {
  it('carries the account and the whole new set — the server adds the caller', () => {
    const call: RolesCall = {
      targetUserId: UserId.of('u-target'),
      roles: [Role.Client, Role.Barber],
    };
    expect(Object.keys(call).sort()).toEqual(['roles', 'targetUserId']);
  });
});

describe('RolesCall.decodeChanged', () => {
  it('decodes a usable answer — the account, its stored set and whether anything was written', () => {
    expect(unwrapOk(RolesCall.decodeChanged(ANSWER))).toEqual({
      targetUserId: 'u-target',
      roles: ['client', 'barber'],
      rolesChanged: true,
    });
    expect(
      unwrapOk(RolesCall.decodeChanged({ ...ANSWER, rolesChanged: false }))
        .rolesChanged,
    ).toBe(false);
  });

  it('refuses an answer that is no object', () => {
    for (const raw of [null, undefined, 'ok', 42, [ANSWER]]) {
      expect(unwrapErr(RolesCall.decodeChanged(raw)).errorCode).toBe(
        PipelineErrorCode.Unknown,
      );
    }
  });

  it('refuses a missing or malformed field as PIPELINE_UNKNOWN', () => {
    const broken: readonly Record<string, unknown>[] = [
      { roles: ANSWER.roles, rolesChanged: true },
      { ...ANSWER, targetUserId: '' },
      { ...ANSWER, targetUserId: 'a/b' },
      { targetUserId: 'u-target', rolesChanged: true },
      { ...ANSWER, roles: 'client' },
      { targetUserId: 'u-target', roles: ANSWER.roles },
      { ...ANSWER, rolesChanged: 'yes' },
    ];
    for (const raw of broken) {
      expect(unwrapErr(RolesCall.decodeChanged(raw)).errorCode).toBe(
        PipelineErrorCode.Unknown,
      );
    }
  });

  it('refuses a set holding an unknown role — never dropped silently', () => {
    for (const roles of [['client', 'owner'], ['ADMIN'], [7]]) {
      expect(
        unwrapErr(RolesCall.decodeChanged({ ...ANSWER, roles })).errorCode,
      ).toBe(PipelineErrorCode.Unknown);
    }
  });

  it('is pure: the raw answer is never touched', () => {
    const first = RolesCall.decodeChanged(ANSWER);
    expect(RolesCall.decodeChanged(ANSWER)).toEqual(first);
    expect(ANSWER.roles).toEqual(['client', 'barber']);
  });
});
