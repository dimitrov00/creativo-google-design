import type { ServiceId } from '@core/primitives';

/**
 * The selectability tags — the ONLY source of these strings, named after the
 * field they type (`selectability`; was `ServiceSelectabilityKind`).
 */
export const Selectability = {
  Selectable: 'SELECTABLE',
  Blocked: 'BLOCKED',
} as const;
export type Selectability = (typeof Selectability)[keyof typeof Selectability];

/**
 * Whether a candidate service can join one seat's selection, and if not, what
 * stands in the way (`service-conflicts.ts:9-11`) — the answer of
 * `ServiceConflictSystem.selectability`. `BLOCKED` always names the
 * blockers — an unexplained lock is the failure mode this rule exists to
 * prevent. Moved out of `service-conflict.system.ts` with its dictionary
 * (pass D, D-7.4: component-shaped data lives in components).
 */
export type ServiceSelectability =
  ServiceSelectability.Selectable | ServiceSelectability.Blocked;

export namespace ServiceSelectability {
  export type Selectable = {
    readonly selectability: typeof Selectability.Selectable;
  };
  export type Blocked = {
    readonly selectability: typeof Selectability.Blocked;
    readonly by: readonly ServiceId[];
  };
}
