import { type Role, Roles } from '@core/components';
import { type PipelineError, PipelineErrorCode } from '@core/errors';
import {
  type TranslateCode,
  wordPipelineError,
} from '@creativo/infrastructure/i18n';
import type { ClientRolesWords } from './client-card.words';
import {
  ClientRolesPhase,
  type ClientRoleToggleVm,
  type ClientRolesVm,
} from './client-pages.vm';

/**
 * The card's roles change as the store holds it: the phase, and the
 * refusal the callable answered when it was refused.
 */
export type ClientRolesState =
  | {
      readonly clientRolesPhase: Exclude<
        ClientRolesPhase,
        typeof ClientRolesPhase.Refused
      >;
    }
  | {
      readonly clientRolesPhase: typeof ClientRolesPhase.Refused;
      readonly rolesError: PipelineError;
    };

/** What the «Роли» block is worded from. */
export interface ClientRolesInput {
  /** The block's words in the card's language (`clientCard.roles.*`). */
  readonly words: ClientRolesWords;
  /**
   * The set Save would send, as `RoleAssignmentSystem.changeOf` normalised
   * it (each role once, dictionary order): the toggles that are on.
   */
  readonly roles: readonly Role[];
  /** `RoleAssignmentSystem.saveOf`'s answer — never re-derived here (Law 10.2). */
  readonly saveEnabled: boolean;
  /** Where the act stands. */
  readonly rolesState: ClientRolesState;
  /** `errors.<code>` in the card's language, the code itself when the catalogue has none. */
  readonly translateCode: TranslateCode;
}

/**
 * The «Роли» block (security hardening S-WS-E, S-RU-13, S-L-18) in words.
 * Whether the block exists at all (the port, the id source, an admin
 * viewer, an account `RoleAssignmentSystem.offerOf` admits, the network)
 * and whether Save may send (`RoleAssignmentSystem.saveOf`) are the
 * store's answers; this words what it is handed and decides nothing: one
 * row per role of `Roles.ASSIGNABLE`, in its order, on when the set Save
 * would send holds it; the phase picks the line, and a refusal is said in
 * the server's own words when the catalogue has them (`wordPipelineError`),
 * else the generic `PIPELINE_UNKNOWN` line — the privacy block's idiom.
 */
export function clientRolesVm(input: ClientRolesInput): ClientRolesVm {
  const { words } = input;
  return {
    groupLabel: words.groupLabel,
    toggles: Roles.ASSIGNABLE.map((role): ClientRoleToggleVm => ({
      role,
      // eslint-disable-next-line security/detect-object-injection -- `role` is a member of the closed `Roles.ASSIGNABLE` the words table is keyed by.
      label: words.role[role],
      checked: input.roles.includes(role),
      testId: `client-roles-${role}`,
    })),
    saveLabel: words.save,
    saveEnabled: input.saveEnabled,
    line: lineOf(input),
    testId: 'client-roles',
  };
}

/** The line under the block: nothing while idle or on its way. */
function lineOf(input: ClientRolesInput): string | null {
  const state = input.rolesState;
  switch (state.clientRolesPhase) {
    case ClientRolesPhase.Idle:
    case ClientRolesPhase.Running:
      return null;
    case ClientRolesPhase.Saved:
      return input.words.saved;
    case ClientRolesPhase.Refused:
      return wordPipelineError(
        state.rolesError,
        input.translateCode,
        PipelineErrorCode.Unknown,
      );
  }
}
