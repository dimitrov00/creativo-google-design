import {
  BarberId,
  type ClientOperationId,
  type LocalDate,
  type LocationId,
  Result,
} from '@core/primitives';
import type { PipelineError } from '@core/errors';
import type { AuthoredText } from './authored-text.data';
import {
  BarberActivation,
  type BarberActivationAnswer,
} from './barber-activation.data';
import type { BarberLifecycle } from './barber-lifecycle.data';
import { CallAnswer } from './call-answer.data';
import { StaffSetupItem } from './staff-setup-item.data';

/**
 * Which part of a barber record an `editBarber` call replaces — the ONLY
 * source of these strings, the field `barberEdit`. One callable, five
 * editors: each save is one part, whole.
 */
export const BarberEdit = {
  /** The public profile: name, title, bio, Instagram, experience. */
  Profile: 'PROFILE',
  /** The shops they work at. */
  Shops: 'SHOPS',
  /** The working period: the start day and the last working day. */
  Period: 'PERIOD',
  /** In or out of the «Който и да е» pool. */
  Pool: 'POOL',
  /** Who may book them: staff only, or everyone. */
  Access: 'ACCESS',
} as const;
export type BarberEdit = (typeof BarberEdit)[keyof typeof BarberEdit];

/**
 * The edit half of an `editBarber` call — flat variants on `barberEdit`,
 * each carrying the whole part it replaces.
 */
export type BarberEditRequest =
  | BarberEditRequest.Profile
  | BarberEditRequest.Shops
  | BarberEditRequest.Period
  | BarberEditRequest.Pool
  | BarberEditRequest.Access;

export namespace BarberEditRequest {
  export type Profile = {
    readonly barberEdit: typeof BarberEdit.Profile;
    readonly name: AuthoredText;
    /** `null` or a blank Bulgarian is "none". */
    readonly title: AuthoredText | null;
    readonly bio: AuthoredText | null;
    /** With or without the leading `@`; `null` or blank is "none". */
    readonly instagramHandle: string | null;
    readonly yearsExperience: number | null;
  };
  export type Shops = {
    readonly barberEdit: typeof BarberEdit.Shops;
    /** `[]` is every shop. */
    readonly locationIds: readonly LocationId[];
  };
  export type Period = {
    readonly barberEdit: typeof BarberEdit.Period;
    readonly barberStartsLocalDate: LocalDate;
    readonly barberLastWorkingLocalDate: LocalDate | null;
  };
  export type Pool = {
    readonly barberEdit: typeof BarberEdit.Pool;
    readonly barberJoinsAnyPool: boolean;
  };
  export type Access = {
    readonly barberEdit: typeof BarberEdit.Access;
    /** A draft's status once it goes live; a live record's status now. */
    readonly barberStatus: BarberLifecycle.LiveStatus;
  };
}

/**
 * THE TEAM WIRE (team onboarding D5, D9, D10,
 * `docs/designs/team-onboarding.md`) — the barber record's callables. The
 * root is `addBarber`: a new record as a `DRAFT`. Every call names its act
 * (`operationId`, minted by the web once per save, WS-4.1): a retried or
 * double-tapped call is the same act and writes nothing twice — and
 * `addBarber`'s id IS the new record's id, as a booking attempt's is the
 * appointment's.
 */
export type TeamCall = {
  readonly name: AuthoredText;
  /** The shops they work at; `[]` is every shop. */
  readonly locationIds: readonly LocationId[];
  readonly barberStartsLocalDate: LocalDate;
  readonly barberLastWorkingLocalDate: LocalDate | null;
  /** Where the record goes when its needed items are done. */
  readonly barberDraftTargetStatus: BarberLifecycle.LiveStatus;
  readonly barberJoinsAnyPool: boolean;
  /** The act's name — and the new record's id. */
  readonly operationId: ClientOperationId;
};

export const TeamCall = {
  /** The answer of `addBarber`, `editBarber` and `deleteDraftBarber`: the record, or nothing usable. */
  decodeSaved(raw: unknown): Result<TeamCall.Saved, PipelineError> {
    const answer = CallAnswer.read(raw);
    const barberId =
      answer === null
        ? null
        : CallAnswer.parsed(answer, 'barberId', BarberId.parse);
    return barberId === null ? CallAnswer.unusable() : Result.ok({ barberId });
  },

  /**
   * `activateBarber`'s answer: the record and what the step came to — a
   * record that is not ready names the first needed item still missing.
   */
  decodeActivation(raw: unknown): Result<TeamCall.Activation, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const barberId = CallAnswer.parsed(answer, 'barberId', BarberId.parse);
    const barberActivation = CallAnswer.tag(
      answer,
      'barberActivation',
      BarberActivation,
    );
    if (barberId === null || barberActivation === null) {
      return CallAnswer.unusable();
    }
    if (barberActivation !== BarberActivation.NotReady) {
      return Result.ok({ barberId, barberActivation });
    }
    const staffSetupItem = CallAnswer.tag(
      answer,
      'staffSetupItem',
      StaffSetupItem,
    );
    return staffSetupItem === null
      ? CallAnswer.unusable()
      : Result.ok({ barberId, barberActivation, staffSetupItem });
  },
} as const;

export namespace TeamCall {
  /** `editBarber` — one part of one record, replaced whole. */
  export type Edit = BarberEditRequest & {
    readonly barberId: BarberId;
    /** The act's name — the web mints one per save. */
    readonly operationId: ClientOperationId;
  };
  /** A call that names a record and nothing else — `activateBarber`, `deleteDraftBarber`. */
  export type Named = {
    readonly barberId: BarberId;
    readonly operationId: ClientOperationId;
  };
  /** The record a call wrote (or, for a replay, had already written). */
  export type Saved = { readonly barberId: BarberId };
  /** `activateBarber`'s answer. */
  export type Activation = BarberActivationAnswer & {
    readonly barberId: BarberId;
  };
}
