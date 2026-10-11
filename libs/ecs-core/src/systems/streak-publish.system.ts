import {
  type EngagementError,
  Result,
  StreakPublishError,
  type StreakDefinitionId,
  type LocalDate,
} from '@core/primitives';
import {
  type LocalizedText,
  StreakRule,
  StreakRuleDirection,
  type StreakRuleInput,
  StreakTransition,
  type StreakHeadRule,
} from '@core/components';
import {
  StreakRuleSystem,
  type StreakNoticePolicy,
  type StreakRuleChange,
  type StreakSchedule,
} from './streak-rule.system';

/*
 * PUBLISHING THE RHYTHM'S RULE (client-card-revision-3 §4.4) — the refusal
 * logic of the `publishStreakDefinition` callable
 * (`apps/functions/src/use-cases/publish-streak-definition.use-case.ts`
 * `publish`/`callOff`), of the page's own assessment
 * (`libs/application/engagement/.../publish-streak-definition.use-case.ts`
 * `assess`) and of the in-memory repository the page's specs run against
 * (`InMemoryStreakDefinitionRepository`): one decision, three callers.
 *
 * In order, a publish is: `admit` (no recompute before the engine exists,
 * no preview nobody can vouch for, a head that has not moved — and the
 * version's number, one above the highest ever written), the draft parsed
 * into that numbered version at the edge (`StreakRule.parse`), then
 * `decide` (no day earlier than the change may start; the new head, in
 * force at once or waiting; the version it replaces, called off). A
 * withdrawal is `withdraw`. The writer numbers the version: after a
 * withdrawal `baseVersion + 1` is the called-off version's number, and a
 * version document is never written twice.
 */

/** What a draft comes to — the assessment's discriminator `draftAssessment`, the ONLY source of these strings. */
export const DraftAssessment = {
  Valid: 'VALID',
  Invalid: 'INVALID',
} as const;
export type DraftAssessment =
  (typeof DraftAssessment)[keyof typeof DraftAssessment];

/** What a draft comes to, before anything is sent. */
export type StreakDraftAssessment =
  | {
      readonly draftAssessment: typeof DraftAssessment.Valid;
      /** The next version, ready to publish. */
      readonly rule: StreakRule;
      /** Against the rule in force today. */
      readonly change: StreakRuleChange;
      /** The first day this change may take effect. */
      readonly earliest: LocalDate;
      /** The newest version the head holds: what the publish is based on. */
      readonly baseVersion: number;
    }
  | {
      readonly draftAssessment: typeof DraftAssessment.Invalid;
      /** The flat fields at fault (`StreakRuleField`), each once, in the rule's order. */
      readonly fields: readonly string[];
      readonly errors: readonly EngagementError.StreakRuleError[];
    };

/** What a publish reads inside its transaction. */
export type StreakPublishSnapshot = {
  /** The head; `null` when nobody has published this rule. */
  readonly head: StreakSchedule | null;
  /** The highest version ever written, the withdrawn among them; 0 with none. */
  readonly highestVersion: number;
};

/** «Запази», as the server reads it (the draft is parsed at the edge, after `admit`). */
export type StreakPublishRequest = {
  /** The newest version the head held when the draft was made; 0 when the shop has published none. */
  readonly baseVersion: number;
  readonly streakTransition: StreakTransition;
  /** The preview this was confirmed on; `null` until the server has one. */
  readonly previewHash: string | null;
};

/** What one publish writes. */
export type StreakPublishDecision = {
  /** The head as it stands after the act. */
  readonly head: StreakSchedule;
  /** Against the rule in force; `neutral` and nothing listed for a shop's first rule. */
  readonly change: StreakRuleChange;
  /** The version in force before the act; 0 for a shop's first rule. */
  readonly inForceVersion: number;
  /** The version that waited and is called off by this act, if any. */
  readonly calledOff: readonly number[];
  /** Its day has not come: it waits, and can still be called off. */
  readonly waits: boolean;
};

/** What one withdrawal writes. */
export type StreakWithdrawal = {
  /** The rule in force alone. */
  readonly head: StreakSchedule;
  /** What waited, as it waited — the head's `SCHEDULED` element. */
  readonly waiting: StreakHeadRule;
  readonly calledOff: readonly number[];
};

/** A shop's first rule has nothing before it to be compared with, or to give notice of. */
const FIRST_RULE: StreakRuleChange = {
  direction: StreakRuleDirection.Neutral,
  changed: [],
};

function unique(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i] as string;
    let seen = false;
    for (let k = 0; k < out.length; k++) if (out[k] === value) seen = true;
    if (!seen) out.push(value);
  }
  return out;
}

export const StreakPublishSystem = {
  /** The newest version a head holds: the one that waits, else the one in force; 0 with no head. */
  newestOf(head: StreakSchedule | null): number {
    if (head === null) return 0;
    return (
      StreakRuleSystem.scheduled(head)?.version ??
      StreakRuleSystem.current(head).version
    );
  },

  /**
   * The rule's name: the head's, once for every version. With no head the
   * only rule that can be opened is the business's one rhythm, under the
   * recommended rule's own id and name; any other id names nothing
   * (`null`), and is refused rather than christened.
   */
  nameOf(
    streakId: StreakDefinitionId,
    headName: LocalizedText | null,
  ): LocalizedText | null {
    if (headName !== null) return headName;
    return streakId === StreakRule.DEFAULT_DEFINITION_ID
      ? StreakRule.DEFAULT_NAME
      : null;
  },

  /**
   * The page's assessment, sending nothing: the draft made the next
   * version of the rule (based on what WAITS, numbered one above it; 1 on
   * nothing) on the day asked, compared with what is IN FORCE today, and
   * the first day the change may take effect. Every fault at once, each
   * field once.
   */
  assess(
    head: StreakSchedule,
    published: boolean,
    draft: StreakRuleInput,
    /** The day asked, AS WRITTEN — `StreakRule.parse` refuses one that is no day, as a fault of the draft. */
    effectiveFromLocalDate: string,
    today: LocalDate,
    policy: StreakNoticePolicy,
  ): StreakDraftAssessment {
    const inForce = StreakRuleSystem.inForceOn(head, today);
    const baseVersion = published ? StreakPublishSystem.newestOf(head) : 0;
    const built = StreakRule.parse({
      ...draft,
      version: baseVersion + 1,
      effectiveFromLocalDate,
    });
    if (!built.ok) {
      const fields: string[] = [];
      for (let i = 0; i < built.error.length; i++) {
        fields.push((built.error[i] as EngagementError.StreakRuleError).field);
      }
      return {
        draftAssessment: DraftAssessment.Invalid,
        fields: unique(fields),
        errors: built.error,
      };
    }
    const change = StreakRuleSystem.changeFrom(built.value, inForce, false);
    return {
      draftAssessment: DraftAssessment.Valid,
      rule: built.value,
      change,
      earliest: StreakRuleSystem.earliestEffectiveDay(
        change.direction,
        today,
        policy,
      ),
      baseVersion,
    };
  },

  /**
   * The server's first questions, before the draft is read: a recompute
   * needs the engine; a preview nobody can vouch for is refused; the head
   * must not have moved since the draft was made. The answer is the
   * version's number: one above the highest ever written.
   */
  admit(
    request: StreakPublishRequest,
    snapshot: StreakPublishSnapshot,
  ): Result<number, StreakPublishError> {
    if (request.streakTransition === StreakTransition.Recompute) {
      return Result.err(StreakPublishError.recomputeNeedsEngine());
    }
    if (request.previewHash !== null) {
      return Result.err(StreakPublishError.previewStale());
    }
    const newest = StreakPublishSystem.newestOf(snapshot.head);
    if (request.baseVersion !== newest) {
      return Result.err(StreakPublishError.stale(request.baseVersion, newest));
    }
    return Result.ok(Math.max(newest, snapshot.highestVersion) + 1);
  },

  /**
   * The publish of `rule` — the draft, parsed and numbered — over the head
   * the transaction read, on the shop's `today`: no earlier than the change
   * may start (a shop's first rule owes no notice); effective today or
   * earlier it is the rule in force at once (a shop's first rule always
   * is), later it WAITS in place of whatever waited, which is called off.
   */
  decide(
    rule: StreakRule,
    streakTransition: StreakTransition,
    head: StreakSchedule | null,
    today: LocalDate,
    policy: StreakNoticePolicy,
  ): Result<StreakPublishDecision, StreakPublishError> {
    const inForce =
      head === null ? null : StreakRuleSystem.inForceOn(head, today);
    const change =
      inForce === null
        ? FIRST_RULE
        : StreakRuleSystem.changeFrom(rule, inForce, false);
    if (inForce !== null) {
      const earliest = StreakRuleSystem.earliestEffectiveDay(
        change.direction,
        today,
        policy,
      );
      if (rule.effectiveFromLocalDate < earliest) {
        return Result.err(
          StreakPublishError.tooEarly(rule.effectiveFromLocalDate, earliest),
        );
      }
    }
    const next =
      inForce === null || rule.effectiveFromLocalDate <= today
        ? StreakRuleSystem.schedule(rule, null)
        : StreakRuleSystem.schedule(inForce, { ...rule, streakTransition });
    if (!next.ok) {
      const fields: string[] = [];
      for (let i = 0; i < next.error.length; i++) {
        fields.push((next.error[i] as { readonly field: string }).field);
      }
      return Result.err(StreakPublishError.invalid(unique(fields)));
    }
    const replaced =
      head === null ? null : StreakRuleSystem.upcomingOn(head, today);
    return Result.ok({
      head: next.value,
      change,
      inForceVersion: inForce?.version ?? 0,
      calledOff: replaced === null ? [] : [replaced.version],
      waits: rule.effectiveFromLocalDate > today,
    });
  },

  /**
   * «Отмени»: the version that waits on `today`, named by its number, is
   * called off and the head holds the rule in force alone. An undo that
   * arrives after the head moved on (the day came, another publish
   * replaced it, somebody else called it off, no rule) is refused as stale
   * instead of calling off something else.
   */
  withdraw(
    version: number,
    head: StreakSchedule | null,
    today: LocalDate,
  ): Result<StreakWithdrawal, StreakPublishError> {
    const waiting =
      head === null ? null : StreakRuleSystem.upcomingOn(head, today);
    if (head === null || waiting === null || waiting.version !== version) {
      return Result.err(
        StreakPublishError.stale(version, waiting?.version ?? 0),
      );
    }
    return Result.ok({
      head: { rules: [StreakRuleSystem.current(head)] },
      waiting,
      calledOff: [version],
    });
  },
} as const;
