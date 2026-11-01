import { describe, expect, it } from 'vitest';
import { Role } from '@core/components';
import {
  GovernanceErrorCode,
  HttpsStatus,
  PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import { deepFreeze } from '@core/testing';
import type { TranslateCode } from '@creativo/infrastructure/i18n';
import { catalogueOf, wordsOf } from '../testing/client-card.fixtures';
import {
  type ClientRolesInput,
  type ClientRolesState,
  clientRolesVm,
} from './client-roles.presenter';
import { ClientRolesPhase } from './client-pages.vm';

/** `errors.<code>` from the real catalogue, the code itself when it has none (`translateCodedError`'s contract). */
function errorsOf(lang: 'bg' | 'en'): TranslateCode {
  const errors = new Map(
    Object.entries(catalogueOf(lang)['errors'] as Record<string, string>),
  );
  return (code) => errors.get(code) ?? code;
}

const IDLE: ClientRolesState = { clientRolesPhase: ClientRolesPhase.Idle };

function inputOf(
  lang: 'bg' | 'en',
  overrides: Partial<ClientRolesInput> = {},
): ClientRolesInput {
  return {
    words: wordsOf(lang).roles,
    roles: [Role.Client],
    saveEnabled: false,
    rolesState: IDLE,
    translateCode: errorsOf(lang),
    ...overrides,
  };
}

const refusedWith = (errorCode: string, status: HttpsStatus) =>
  ({
    clientRolesPhase: ClientRolesPhase.Refused,
    rolesError: PipelineError.fromWire(`functions/${status}`, { errorCode }),
  }) as const;

describe('clientRolesVm — «Роли» (security hardening S-WS-E)', () => {
  it('words the group, the five assignable roles in dictionary order and Save, in bg', () => {
    expect(
      clientRolesVm(inputOf('bg', { roles: [Role.Client, Role.Barber] })),
    ).toEqual({
      groupLabel: 'Роли',
      toggles: [
        {
          role: Role.Client,
          label: 'Клиент',
          checked: true,
          testId: 'client-roles-client',
        },
        {
          role: Role.Barber,
          label: 'Бръснар',
          checked: true,
          testId: 'client-roles-barber',
        },
        {
          role: Role.Receptionist,
          label: 'Рецепция',
          checked: false,
          testId: 'client-roles-receptionist',
        },
        {
          role: Role.ContentManager,
          label: 'Съдържание',
          checked: false,
          testId: 'client-roles-content_manager',
        },
        {
          role: Role.Admin,
          label: 'Администратор',
          checked: false,
          testId: 'client-roles-admin',
        },
      ],
      saveLabel: 'Запази ролите',
      saveEnabled: false,
      line: null,
      testId: 'client-roles',
    });
  });

  it('words the same block in en, never offering the sysadmin', () => {
    const vm = clientRolesVm(inputOf('en', { roles: [Role.Admin] }));
    expect(vm.groupLabel).toBe('Roles');
    expect(vm.toggles.map((toggle) => [toggle.label, toggle.checked])).toEqual([
      ['Client', false],
      ['Barber', false],
      ['Front desk', false],
      ['Content', false],
      ['Admin', true],
    ]);
    expect(vm.toggles.some((toggle) => toggle.role === Role.Sysadmin)).toBe(
      false,
    );
    expect(vm.saveLabel).toBe('Save roles');
  });

  it('prints Save as the system answered it — never re-derived from the set', () => {
    // The same set, both answers: the presenter words what it is handed.
    expect(
      clientRolesVm(inputOf('bg', { saveEnabled: true })).saveEnabled,
    ).toBe(true);
    expect(
      clientRolesVm(inputOf('bg', { saveEnabled: false })).saveEnabled,
    ).toBe(false);
  });

  it('has no line while idle or on its way, and the saved line once saved', () => {
    for (const phase of [ClientRolesPhase.Idle, ClientRolesPhase.Running]) {
      expect(
        clientRolesVm(
          inputOf('bg', { rolesState: { clientRolesPhase: phase } }),
        ).line,
      ).toBeNull();
    }
    const saved: ClientRolesState = {
      clientRolesPhase: ClientRolesPhase.Saved,
    };
    expect(clientRolesVm(inputOf('bg', { rolesState: saved })).line).toBe(
      'Ролите са запазени. Важат от следващото влизане.',
    );
    expect(clientRolesVm(inputOf('en', { rolesState: saved })).line).toBe(
      'Roles saved. They apply from the next sign-in.',
    );
  });

  it('words each refusal the block can meet in the server’s own words (wordPipelineError)', () => {
    const cases: readonly (readonly [string, HttpsStatus, string, string])[] = [
      [
        GovernanceErrorCode.RolesForbidden,
        HttpsStatus.PermissionDenied,
        'Нямаш права за това. Влез отново или питай администратора.',
        "You don't have access to this. Sign in again or ask an admin.",
      ],
      [
        GovernanceErrorCode.RolesTargetNotFound,
        HttpsStatus.NotFound,
        'Не намерихме този профил.',
        "We couldn't find this account.",
      ],
      [
        GovernanceErrorCode.RolesTargetNotRegistered,
        HttpsStatus.FailedPrecondition,
        'Този човек още не е завършил регистрацията си.',
        "This person hasn't finished signing up yet.",
      ],
      [
        GovernanceErrorCode.RolesTargetErased,
        HttpsStatus.FailedPrecondition,
        'Личните данни на този клиент са изтрити.',
        "This client's personal data was erased.",
      ],
      [
        GovernanceErrorCode.RolesSessionsNotRevoked,
        HttpsStatus.Unavailable,
        'Ролите са запазени, но старите сесии не бяха прекратени. Опитай пак.',
        "The roles are saved, but the old sessions weren't ended. Try again.",
      ],
    ];
    for (const [errorCode, status, bg, en] of cases) {
      const rolesState = refusedWith(errorCode, status);
      expect(clientRolesVm(inputOf('bg', { rolesState })).line).toBe(bg);
      expect(clientRolesVm(inputOf('en', { rolesState })).line).toBe(en);
    }
  });

  it('words a refusal with no copy of its own — and a bare failure — as the generic line', () => {
    for (const rolesState of [
      refusedWith(
        GovernanceErrorCode.RolesUnauthenticated,
        HttpsStatus.Unauthenticated,
      ),
      refusedWith(
        GovernanceErrorCode.RolesSelf,
        HttpsStatus.FailedPrecondition,
      ),
      {
        clientRolesPhase: ClientRolesPhase.Refused,
        rolesError: PipelineError.bare(PipelineErrorCode.InvalidRequest),
      } as const,
    ]) {
      expect(clientRolesVm(inputOf('bg', { rolesState })).line).toBe(
        'Нещо се обърка. Опитай пак.',
      );
      expect(clientRolesVm(inputOf('en', { rolesState })).line).toBe(
        'Something went wrong. Try again.',
      );
    }
  });

  it('is pure: the same input words the same block and stays unchanged', () => {
    const input = deepFreeze(
      inputOf('bg', {
        roles: [Role.Client, Role.Receptionist],
        saveEnabled: true,
      }),
    );
    expect(clientRolesVm(input)).toEqual(clientRolesVm(input));
    expect(input.roles).toEqual([Role.Client, Role.Receptionist]);
  });
});
