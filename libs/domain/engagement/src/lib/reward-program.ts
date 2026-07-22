import {
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { MilestoneId, RewardProgramId } from './ids';
import { EmptyIdError } from './ids.errors';
import { Milestone } from './milestone';
import {
  RewardProgramEmptyMilestonesError,
  RewardProgramEmptyNameError,
} from './reward-program.errors';

/**
 * Ports v2's `RewardProgram.Kind` — what drives audience defaults.
 * Deviation: `audience`/per-referrer `cap`/date-window campaign fields
 * are dropped for this pass (anti-abuse policy is an application-layer
 * concern once a real materialization use-case exists in Goal 03).
 */
export type RewardProgramKind =
  'welcome' | 'referral' | 'loyalty' | 'reactivation';

export type RewardProgramError =
  | EmptyIdError
  | RewardProgramEmptyNameError
  | RewardProgramEmptyMilestonesError;

export interface CreateRewardProgramProps {
  id: string;
  name: string;
  kind: RewardProgramKind;
  milestones: Milestone[];
  enabled: boolean;
  activeFrom?: ZonedDateTime;
  activeUntil?: ZonedDateTime;
}

/**
 * **Aggregate root.** Admin-defined reward program (ports v2's
 * `RewardProgram.ts`, simplified — see module-level deviation note).
 */
export class RewardProgram {
  private constructor(
    readonly id: RewardProgramId,
    readonly name: string,
    readonly kind: RewardProgramKind,
    readonly milestones: readonly Milestone[],
    readonly enabled: boolean,
    readonly activeFrom: ZonedDateTime | null,
    readonly activeUntil: ZonedDateTime | null,
  ) {}

  static create(
    props: CreateRewardProgramProps,
  ): Result<RewardProgram, RewardProgramError[]> {
    return RewardProgram.build(props);
  }

  static reconstitute(
    props: CreateRewardProgramProps,
  ): Result<RewardProgram, RewardProgramError[]> {
    return RewardProgram.build(props);
  }

  private static build(
    props: CreateRewardProgramProps,
  ): Result<RewardProgram, RewardProgramError[]> {
    const idResult = RewardProgramId.create(props.id);
    const nameResult = RewardProgram.validateName(props.name);
    const milestonesResult = RewardProgram.validateMilestones(props.milestones);

    const combined = combineAll([
      idResult,
      nameResult,
      milestonesResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, name, milestones] = combined.value;

    return ok(
      new RewardProgram(
        id,
        name,
        props.kind,
        milestones,
        props.enabled,
        props.activeFrom ?? null,
        props.activeUntil ?? null,
      ),
    );
  }

  /** Active at `now` per its (optional) date window — does not check `enabled`. */
  isActiveAt(now: ZonedDateTime): boolean {
    if (this.activeFrom && now.isBefore(this.activeFrom)) return false;
    if (this.activeUntil && now.isAfter(this.activeUntil)) return false;
    return true;
  }

  milestoneById(id: MilestoneId): Milestone | undefined {
    return this.milestones.find((m) => m.id.equals(id));
  }

  private static validateName(
    raw: string,
  ): Result<string, RewardProgramEmptyNameError> {
    const trimmed = raw.trim();
    return trimmed.length > 0
      ? ok(trimmed)
      : fail(new RewardProgramEmptyNameError());
  }

  private static validateMilestones(
    raw: Milestone[],
  ): Result<readonly Milestone[], RewardProgramEmptyMilestonesError> {
    if (raw.length === 0) {
      return fail(new RewardProgramEmptyMilestonesError());
    }
    return ok(raw);
  }
}
