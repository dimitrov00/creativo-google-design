import type { StaffSetupItem } from './staff-setup-item.data';

/**
 * What asking a barber record to go live came to (team onboarding D9,
 * `activateBarberIfReady`) — the ONLY source of these strings, named after
 * the field it types (`barberActivation`). Not a refusal: the step is
 * idempotent and runs after every editor save, so "not ready yet" and
 * "nothing to do" are answers.
 */
export const BarberActivation = {
  /** A `DRAFT` with every needed item done: now live at its target status. */
  Activated: 'ACTIVATED',
  /** A `DRAFT` still missing a needed item. */
  NotReady: 'NOT_READY',
  /** Not a `DRAFT` — already live, or departed: nothing changes. */
  Unchanged: 'UNCHANGED',
} as const;
export type BarberActivation =
  (typeof BarberActivation)[keyof typeof BarberActivation];

/**
 * The step's answer, flat on its discriminator: a record that is not ready
 * names the first needed item still missing.
 */
export type BarberActivationAnswer =
  | BarberActivationAnswer.Activated
  | BarberActivationAnswer.NotReady
  | BarberActivationAnswer.Unchanged;

export namespace BarberActivationAnswer {
  export type Activated = {
    readonly barberActivation: typeof BarberActivation.Activated;
  };
  export type NotReady = {
    readonly barberActivation: typeof BarberActivation.NotReady;
    readonly staffSetupItem: StaffSetupItem;
  };
  export type Unchanged = {
    readonly barberActivation: typeof BarberActivation.Unchanged;
  };
}
