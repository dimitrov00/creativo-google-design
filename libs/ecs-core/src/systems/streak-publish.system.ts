import {
  AuditResourceId,
  defect,
  OperationId,
  Result,
  type StreakDefinitionId,
  LocalDate,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { type EngagementError, StreakPublishError } from '@core/errors';
import {
  type Actor,
  AuditContext,
  DraftAssessment,
  HeadRole,
  type LocalizedText,
  StreakPublishCall,
  StreakPublishConsent,
  StreakRule,
  StreakRuleDirection,
  type StreakRuleInput,
  StreakTransition,
  type StreakHeadRule,
} from '@core/components';
import type { StreakDefinition, StreakDefinitionVersion } from '@core/entities';
import { AuditSystem, type AuditRowPlan } from './audit.system';
import {
  StreakRuleSystem,
  type StreakNoticePolicy,
  type StreakRuleChange,
  type StreakSchedule,
} from './streak-rule.system';

/*
 * PUBLISHING THE RHYTHM'S RULE (client-card-revision-3 §4.4) — the
 * decision of the `publishStreakDefinition` pipeline (`@core/pipelines`
 * `publish-streak-definition.pipeline.ts`, behind the admin-only callable;
 * the admin page's specs run that same pipeline through the gateway double
 * `memoryStreakPublishGatewayPorts` of `@core/testing`) and of the page's
 * own assessment (`assess`): one decision, two callers.
 *
 * In order, a publish is: `admitCaller` (a signed-in admin, judged before
 * the request is read), `admit` (no recompute before the engine exists, no
 * preview nobody can vouch for, a head that has not moved — and the
 * version's number, one above the highest ever written), the draft parsed
 * into that numbered version at the edge (`StreakRule.parse`), then
 * `decide` (no day earlier than the change may start; the new head, in
 * force at once or waiting; the version it replaces, called off) and
 * `publishPlan` (what it writes). A withdrawal is `withdraw` and
 * `withdrawPlan`; a retry of either answers its first receipt
 * (`replayReceipt`). The writer numbers the version: after a withdrawal
 * `baseVersion + 1` is the called-off version's number, and a version
 * document is never written twice.
 */

/** What a draft comes to, before anything is sent (system I/O: the valid variant names a {@link StreakRuleChange}). */
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

/** A draft that IS a rule — the assessment's `VALID` variant: what `gate` hands on to be sent. */
export type ValidStreakDraft = Extract<
  StreakDraftAssessment,
  { readonly draftAssessment: typeof DraftAssessment.Valid }
>;

/**
 * The earliest day the SERVER allowed a change of one direction, once it
 * refused an earlier one: the page's floor for every later draft that turns
 * the same way.
 */
export type StreakPublishFloor = {
  readonly day: LocalDate;
  readonly direction: StreakRuleDirection;
};

/** The two days «Влизане в сила» works with: the first a change may start, and the one it is published for. */
export type StreakEffectiveDay = {
  /** The day picker's minimum. */
  readonly earliest: LocalDate;
  /** The day chosen, never earlier than `earliest`. */
  readonly effectiveFrom: LocalDate;
};

/** The head a publish leaves behind, and whether the new version waits for its day. */
export type StreakHeadAfter = {
  readonly head: StreakSchedule;
  readonly waits: boolean;
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

/**
 * A version document's body — `streakDefinitions/{id}/versions/{version:06}`,
 * the entity minus `id` with every variant of the flat rule kept (a plain
 * `Omit` of the union-typed archetype would keep only the keys its
 * qualifier and interval variants share).
 */
export type StreakDefinitionVersionBody = BodyOf<StreakDefinitionVersion>;

/** An entity minus its `id`, distributed over every variant of a union-typed archetype. */
type BodyOf<E> = E extends unknown ? Omit<E, 'id'> : never;

/** The head's body — `streakDefinitions/{id}`, written whole. */
export type StreakDefinitionBody = Omit<StreakDefinition, 'id'>;

/**
 * Everything ONE publish writes, decided (Law 3/4: no `WriteOp`, no hash —
 * the pipeline maps it to its plan and hashes each audit `idBasis`).
 */
export type StreakPublishPlan = {
  /** What the publish answers — the number the writer gave the version, its day, its direction. */
  readonly receipt: StreakPublishCall.Receipt;
  /** The new version, created once at `versions/{forVersion(receipt.version)}`. */
  readonly versionBody: StreakDefinitionVersionBody;
  /** The called-off versions whose documents the read found — each stamped `withdrawnAtUtcMs`. */
  readonly stampVersions: readonly number[];
  /** The head after the act, written whole. */
  readonly headBody: StreakDefinitionBody;
  /** The act's ONE untargeted audit row (F1-8), id basis keyed by the `requestId`. */
  readonly audit: readonly AuditRowPlan[];
};

/** Everything ONE withdrawal writes, decided — mapped by the pipeline as {@link StreakPublishPlan} is. */
export type StreakWithdrawPlan = {
  readonly stampVersions: readonly number[];
  readonly headBody: StreakDefinitionBody;
  readonly audit: readonly AuditRowPlan[];
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

/**
 * THE notice guard, one for both callers (`decide` on the server, `gate` on
 * the page): a day earlier than the change may start is refused, naming the
 * first day it may; `null` when the day may start.
 */
function tooEarlyFor(
  day: LocalDate,
  earliest: LocalDate,
): StreakPublishError.TooEarly | null {
  return day < earliest ? StreakPublishError.tooEarly(day, earliest) : null;
}

/** The flat fields a refused head names, each once, in the order given. */
function fieldsOf(
  errors: readonly { readonly field: string }[],
): readonly string[] {
  const fields: string[] = [];
  for (let i = 0; i < errors.length; i++) {
    fields.push((errors[i] as { readonly field: string }).field);
  }
  return unique(fields);
}

/**
 * Who a version names as its publisher when nobody published it by hand:
 * the rule the shop opened with (the seed's first version). A reserved
 * uid, branded once here.
 */
const SYSTEM_PUBLISHER: UserId = UserId.of('system');

export const StreakPublishSystem = {
  /** The publisher of a version nobody published by hand — the shop's opening rule («системата»). */
  SYSTEM_PUBLISHER,

  /** Whether nobody published this version by hand: the history says «системата», not a uid. */
  isSystemPublisher(
    version: Pick<StreakDefinitionVersion, 'publishedByUserId'>,
  ): boolean {
    return version.publishedByUserId === SYSTEM_PUBLISHER;
  },

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
    const baseVersion = StreakPublishSystem.baseVersionOf(head, published);
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
      const early = tooEarlyFor(
        rule.effectiveFromLocalDate,
        StreakRuleSystem.earliestEffectiveDay(change.direction, today, policy),
      );
      if (early !== null) return Result.err(early);
    }
    const after = StreakPublishSystem.headAfter(
      head,
      rule,
      streakTransition,
      today,
    );
    if (!after.ok) return after;
    const replaced =
      head === null ? null : StreakRuleSystem.upcomingOn(head, today);
    return Result.ok({
      head: after.value.head,
      change,
      inForceVersion: inForce?.version ?? 0,
      calledOff: replaced === null ? [] : [replaced.version],
      waits: after.value.waits,
    });
  },

  /**
   * The head a publish of `rule` (parsed and numbered) leaves behind over
   * `head` on the shop's `today` — `decide`'s, and the page's while it
   * stands on the answer until the stream says the same: in force at once
   * when its day has come, and always for a shop's first rule (no head);
   * else WAITING beside the rule in force by `streakTransition`, in place
   * of whatever waited. `waits` is its day still to come. A head that would
   * not stand is `INVALID`, naming its fields once each.
   */
  headAfter(
    head: StreakSchedule | null,
    rule: StreakRule,
    streakTransition: StreakTransition,
    today: LocalDate,
  ): Result<StreakHeadAfter, StreakPublishError> {
    const inForce =
      head === null ? null : StreakRuleSystem.inForceOn(head, today);
    const next =
      inForce === null || rule.effectiveFromLocalDate <= today
        ? StreakRuleSystem.schedule(rule, null)
        : StreakRuleSystem.schedule(inForce, { ...rule, streakTransition });
    if (!next.ok) {
      return Result.err(StreakPublishError.invalid(fieldsOf(next.error)));
    }
    return Result.ok({
      head: next.value,
      waits: StreakPublishSystem.waits(rule, today),
    });
  },

  /**
   * Whether a published version waits for its day on the shop's `today`:
   * its effective day is still to come (a version effective today is in
   * force at once) — `headAfter`'s `waits`, and the publish receipt's.
   */
  waits(
    version: { readonly effectiveFromLocalDate: LocalDate },
    today: LocalDate,
  ): boolean {
    return version.effectiveFromLocalDate > today;
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
    const waiting = StreakPublishSystem.waitingOn(head, true, today);
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

  /**
   * The version that waits on `today` and can be called off — `withdraw`'s
   * subject, and what the page's «Отмени» names by its number: nothing
   * waits under no head, nor before the shop has published (the head is
   * then the recommended rule, which waits for nothing).
   */
  waitingOn(
    head: StreakSchedule | null,
    published: boolean,
    today: LocalDate,
  ): StreakHeadRule | null {
    return head === null || !published
      ? null
      : StreakRuleSystem.upcomingOn(head, today);
  },

  /**
   * The newest version a draft is based on — what a publish names as its
   * `baseVersion`, and what a STALE refusal says the draft was made on: the
   * head's newest ({@link newestOf}) once the shop has published, 0 before.
   */
  baseVersionOf(head: StreakSchedule | null, published: boolean): number {
    return published ? StreakPublishSystem.newestOf(head) : 0;
  },

  /**
   * There is something to publish: the draft is a rule and it changes
   * something — or the shop has published nothing yet, when even the
   * recommended rule as it stands is published (until it is, there is no
   * rule). With `published: true` it answers whether the draft CHANGES
   * anything at all — what the preview waits for.
   */
  publishable(assessment: StreakDraftAssessment, published: boolean): boolean {
    return (
      assessment.draftAssessment === DraftAssessment.Valid &&
      (assessment.change.changed.length > 0 || !published)
    );
  },

  /**
   * The page's judgement of a «Запази» before anything is sent — over the
   * draft assessed for the day it is to be published on: a draft that is
   * no rule is `INVALID` (its fields); nothing to publish ({@link
   * publishable}) is `null`; a day earlier than the change may start is
   * `TOO_EARLY` (the one notice guard `decide` judges by too); else the
   * valid draft, to be sent.
   */
  gate(
    assessment: StreakDraftAssessment,
    published: boolean,
    effectiveFrom: LocalDate,
  ): Result<ValidStreakDraft | null, StreakPublishError> {
    if (assessment.draftAssessment === DraftAssessment.Invalid) {
      return Result.err(StreakPublishError.invalid(assessment.fields));
    }
    if (!StreakPublishSystem.publishable(assessment, published)) {
      return Result.ok(null);
    }
    const early = tooEarlyFor(effectiveFrom, assessment.earliest);
    return early === null ? Result.ok(assessment) : Result.err(early);
  },

  /**
   * The day the page offers after the SERVER refused `refusedDay` as too
   * early, whatever day the server named: the strictest the domain knows
   * for a change of this direction (the notice owed as if clients saw the
   * rhythm), and always a later day than the one refused.
   */
  refusedEarliest(
    direction: StreakRuleDirection,
    refusedDay: LocalDate,
    today: LocalDate,
    policy: StreakNoticePolicy,
  ): LocalDate {
    return LocalDate.later(
      StreakRuleSystem.earliestEffectiveDay(direction, today, {
        ...policy,
        clientsSeeRhythm: true,
      }),
      LocalDate.addDays(refusedDay, 1),
    );
  },

  /**
   * «Влизане в сила»: the first day the draft may start and the day it is
   * published for. The first is tomorrow for a draft that is no rule (or
   * not judged yet); else the assessment's own, raised to the server's
   * floor when the floor was set by a change of the SAME direction. The day
   * published for is the one chosen (`null`: «От утре»), never earlier than
   * the first.
   */
  effectiveDay(
    chosen: LocalDate | null,
    assessment: StreakDraftAssessment | null,
    floor: StreakPublishFloor | null,
    tomorrow: LocalDate,
  ): StreakEffectiveDay {
    let earliest = tomorrow;
    if (
      assessment !== null &&
      assessment.draftAssessment === DraftAssessment.Valid
    ) {
      earliest =
        floor !== null && floor.direction === assessment.change.direction
          ? LocalDate.later(floor.day, assessment.earliest)
          : assessment.earliest;
    }
    return {
      earliest,
      effectiveFrom: LocalDate.later(chosen ?? tomorrow, earliest),
    };
  },

  /** The form differs from the rule in force — a draft that is no rule, or one that changes something: what «Отхвърли промените?» guards. */
  isDraftDirty(assessment: StreakDraftAssessment): boolean {
    return (
      assessment.draftAssessment === DraftAssessment.Invalid ||
      assessment.change.changed.length > 0
    );
  },

  /**
   * The receipt offers «Отмени» only for a version that WAITS and was saved
   * without asking first (`StreakRuleSystem.publishConsent` `AT_ONCE`: a
   * looser or neutral change) — a change the admin confirmed is not taken
   * back in passing.
   */
  undoOffered(direction: StreakRuleDirection, waits: boolean): boolean {
    return (
      waits &&
      StreakRuleSystem.publishConsent(direction) === StreakPublishConsent.AtOnce
    );
  },

  /** «История»: the versions newest first (a stable sort of a copy; the list handed in is never written). */
  historyNewestFirst<V extends { readonly version: number }>(
    versions: readonly V[],
  ): readonly V[] {
    return [...versions].sort((a, b) => b.version - a.version);
  },

  /**
   * May this caller change the rule at all? Asked of the VERIFIED caller
   * (the wire's reading of the token, never the payload) BEFORE the request
   * is read — a stranger is told they may not ask, never what was wrong
   * with the asking — and again by the pipeline, so neither act can be
   * reached around it. Nobody signed in (or a blank uid) is
   * `CALLER_UNAUTHENTICATED`; anyone but the shop's admin pair is
   * `CALLER_NOT_ADMIN`. The answer is the account that signs the version.
   */
  admitCaller(
    callerUserId: UserId | null,
    callerIsAdmin: boolean,
  ): Result<UserId, StreakPublishError> {
    if (callerUserId === null || callerUserId.trim().length === 0) {
      return Result.err(StreakPublishError.callerUnauthenticated());
    }
    return callerIsAdmin
      ? Result.ok(callerUserId)
      : Result.err(StreakPublishError.callerNotAdmin());
  },

  /**
   * The draft as the version it proposes: parsed into the rule numbered
   * `version` on the day asked (`StreakRule.parse`, the rule's one door), or
   * `INVALID` naming every flat field at fault, each once, in the rule's
   * order.
   */
  proposal(
    draft: StreakRuleInput,
    version: number,
    effectiveFromLocalDate: string,
  ): Result<StreakRule, StreakPublishError> {
    const built = StreakRule.parse({
      ...draft,
      version,
      effectiveFromLocalDate,
    });
    if (built.ok) return built;
    const fields: string[] = [];
    for (let i = 0; i < built.error.length; i++) {
      fields.push((built.error[i] as EngagementError.StreakRuleError).field);
    }
    return Result.err(StreakPublishError.invalid(unique(fields)));
  },

  /**
   * A retried publish's answer: the ORIGINAL receipt, read off the version
   * its first attempt wrote (found by its `requestId`) — never the head as
   * it stands now, which the first attempt itself moved.
   */
  replayReceipt(stored: StreakDefinitionVersion): StreakPublishCall.Receipt {
    return StreakPublishCall.receipt(
      stored.version,
      stored.effectiveFromLocalDate,
      stored.streakRuleDirection,
    );
  },

  /**
   * What one publish writes, decided over what its transaction read: the
   * new version (the flat rule at its root, signed by the admitted account,
   * stamped `nowUtcMs`, never withdrawn), the `withdrawnAtUtcMs` stamp of
   * each called-off version whose document `stored` lists (a head seeded
   * without its history has nothing to stamp), the head written whole (its
   * name kept, its `rules` the decided list) and the act's ONE untargeted
   * audit row — compared with the rule IN FORCE, never with what waited.
   * A row the audit planner refuses is a defect: the verb is a constant.
   */
  publishPlan(
    call: StreakPublishCall,
    name: LocalizedText,
    decision: StreakPublishDecision,
    stored: readonly number[],
    publishedByUserId: UserId,
    actor: Actor,
    nowUtcMs: UtcEpochMs,
  ): StreakPublishPlan {
    const { rule } = call;
    const { change } = decision;
    return {
      receipt: StreakPublishCall.receipt(
        rule.version,
        rule.effectiveFromLocalDate,
        change.direction,
      ),
      versionBody: {
        ...StreakRule.sliceOf(rule),
        publishedAtUtcMs: nowUtcMs,
        publishedByUserId,
        streakTransition: call.streakTransition,
        streakRuleDirection: change.direction,
        changed: [...change.changed],
        requestId: call.requestId,
        withdrawnAtUtcMs: null,
      },
      stampVersions: stampable(decision.calledOff, stored),
      headBody: { name, rules: decision.head.rules, updatedAtUtcMs: nowUtcMs },
      audit: auditRows(
        call.streakId,
        call.requestId,
        AuditContext.streakPublished({
          streakFromVersion: decision.inForceVersion,
          streakToVersion: rule.version,
          streakEffectiveFrom: rule.effectiveFromLocalDate,
          streakTransition: call.streakTransition,
          streakRuleDirection: change.direction,
          streakChanged: change.changed,
          streakReplacedVersion: decision.calledOff[0] ?? null,
        }),
        actor,
        nowUtcMs,
      ),
    };
  },

  /**
   * What one withdrawal writes: the `withdrawnAtUtcMs` stamp of the
   * called-off version when `stored` lists its document, the head holding
   * the rule in force alone (written whole, its name kept) and the act's
   * ONE untargeted audit row — what waited, and the version the shop stays
   * under.
   */
  withdrawPlan(
    call: StreakPublishCall.Withdraw,
    name: LocalizedText,
    withdrawal: StreakWithdrawal,
    stored: readonly number[],
    actor: Actor,
    nowUtcMs: UtcEpochMs,
  ): StreakWithdrawPlan {
    const current = StreakRuleSystem.current(withdrawal.head);
    const { waiting } = withdrawal;
    return {
      stampVersions: stampable(withdrawal.calledOff, stored),
      headBody: {
        name,
        rules: [
          {
            ...StreakRule.sliceOf(current),
            headRole: HeadRole.Current,
            streakTransition: null,
          },
        ],
        updatedAtUtcMs: nowUtcMs,
      },
      audit: auditRows(
        call.streakId,
        call.requestId,
        AuditContext.streakWithdrawn({
          streakFromVersion: waiting.version,
          streakToVersion: current.version,
          streakEffectiveFrom: waiting.effectiveFromLocalDate,
          // What waits always names its transition (the head's SCHEDULED element).
          streakTransition:
            waiting.streakTransition ??
            defect('a waiting rule names its transition'),
        }),
        actor,
        nowUtcMs,
      ),
    };
  },
} as const;

/** The called-off versions whose documents exist, in the decision's order. */
function stampable(
  calledOff: readonly number[],
  stored: readonly number[],
): readonly number[] {
  const out: number[] = [];
  for (let i = 0; i < calledOff.length; i++) {
    const version = calledOff[i] as number;
    if (stored.includes(version)) out.push(version);
  }
  return out;
}

/**
 * The act's ONE row as the flat log stores it (F1-8): no subjects — a rule
 * is about no one client — so one untargeted row, its id basis keyed by the
 * intent's `requestId` (a retry derives the same id and writes nothing
 * twice).
 */
function auditRows(
  streakId: StreakDefinitionId,
  requestId: string,
  context: AuditContext.StreakPublished | AuditContext.StreakWithdrawn,
  actor: Actor,
  nowUtcMs: UtcEpochMs,
): readonly AuditRowPlan[] {
  const planned = AuditSystem.plan(
    [
      {
        resourceId: AuditResourceId.forStreakDefinition(streakId),
        subjects: [],
        changeKey: requestId,
        // The intent's request id is the act's operation id (WS-4.4).
        operationId: OperationId.of(requestId),
        context,
      },
    ],
    actor,
    nowUtcMs,
  );
  return planned.ok
    ? planned.value
    : defect(`audit entry refused by domain: ${planned.error.errorCode}`);
}
