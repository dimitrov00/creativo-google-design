import { type Result, fail, ok } from '@creativo/domain/kernel';
import {
  HeadRole,
  LocalDate,
  ServiceCategoryId,
  ServiceId,
  StreakDefinitionId,
  StreakExcuse as SystemExcuse,
  StreakIntervalRule,
  StreakOnBreak as SystemOnBreak,
  type StreakPublishError,
  StreakPublishErrorCode,
  StreakPublishSystem,
  StreakQualifierRule,
  type StreakRule,
  StreakRuleDirection as SystemDirection,
  StreakRuleField,
  StreakRuleParameter,
  StreakRuleSystem,
  type StreakSchedule,
  StreakTransition as SystemTransition,
  defect,
} from '@creativo/ecs-core';
import type { Actor } from '@creativo/domain/governance';
import {
  type IsoDate,
  LOYALTY_ZONE,
  StreakDefinition,
  StreakDefinitionSchedule,
  type StreakExcuse,
  type StreakNoticePolicy,
  type StreakOnBreak,
  type StreakRuleChange,
  type StreakRuleDirection,
  type StreakTransition,
} from '@creativo/domain/engagement';
import {
  STREAK_DEFINITIONS_COLLECTION,
  type StreakDefinitionVersionRecord,
  streakScheduleFromDocument,
} from '@creativo/application/engagement';
import type { ClockPort, RepositoryError } from '@creativo/application/shared';
import {
  type PublishStreakDefinitionFailure,
  PublishStreakDefinitionInvalidError,
  PublishStreakDefinitionNotAdminError,
  PublishStreakDefinitionPreviewStaleError,
  PublishStreakDefinitionRecomputeNeedsEngineError,
  PublishStreakDefinitionStaleError,
  PublishStreakDefinitionStoreError,
  PublishStreakDefinitionTooEarlyError,
  PublishStreakDefinitionUnauthenticatedError,
} from './publish-streak-definition.errors';

/** The audit log's word for a rule published, and for a waiting one called off. */
export const STREAK_DEFINITION_PUBLISHED =
  'loyalty.streak_definition_published';
export const STREAK_DEFINITION_WITHDRAWN =
  'loyalty.streak_definition_withdrawn';

/** What the audit row says was changed: the head's own path. */
export function streakDefinitionResourceId(streakId: string): string {
  return `${STREAK_DEFINITIONS_COLLECTION}/${streakId}`;
}

/**
 * The notice a stricter rule owes the clients who can see the rhythm (R29).
 * While nobody can, a stricter rule may start tomorrow.
 */
export const RULE_CHANGE_NOTICE_DAYS = 30;

/**
 * Who asks, off the VERIFIED token and never off the payload: the uid a
 * version is signed with, the actor the log names, and whether the claim
 * holds one of the pair that manages the shop.
 */
export interface StreakDefinitionCaller {
  readonly uid: string;
  readonly actor: Actor;
  readonly isAdmin: boolean;
}

/** «Запази», as it arrives: §4.4's request, its envelope already read. */
export interface PublishStreakDefinitionInput {
  /** `null`: nobody is signed in. */
  readonly caller: StreakDefinitionCaller | null;
  /** One per intent, kept across retries of it. */
  readonly requestId: string;
  readonly streakId: string;
  /**
   * The newest version the head held when the draft was made: the one that
   * waits, else the one in force; 0 when the shop has published none.
   */
  readonly baseVersion: number;
  /**
   * The rule proposed, AS SENT: nothing in it is trusted, and it becomes a
   * rule only through the wire's reader and the domain's factory. Its own
   * `version` and `effectiveFrom` are not read: the writer numbers the
   * version and the day is the request's.
   */
  readonly draft: Readonly<Record<string, unknown>>;
  /** The first Europe/Sofia day the version judges by, as sent. */
  readonly effectiveFrom: string;
  readonly transition: StreakTransition;
  /** The preview this was confirmed on; `null` until the server has one. */
  readonly previewHash: string | null;
}

/** «Отмени»: calling off the version that waits, named by its number. */
export interface WithdrawStreakDefinitionInput {
  readonly caller: StreakDefinitionCaller | null;
  readonly requestId: string;
  readonly streakId: string;
  readonly version: number;
}

/** What was written, as the callable answers it. */
export type StreakDefinitionReceipt =
  | {
      readonly kind: 'published';
      /** The number the writer gave the version. */
      readonly version: number;
      readonly effectiveFrom: IsoDate;
      /** Whom the change favours, against the rule in force. */
      readonly direction: StreakRuleDirection;
    }
  | { readonly kind: 'withdrawn'; readonly version: number };

/** One intent, as the store needs to know it to find its own earlier write. */
export type StreakDefinitionIntent =
  | {
      readonly act: 'publish';
      readonly streakId: string;
      readonly requestId: string;
    }
  | {
      readonly act: 'withdraw';
      readonly streakId: string;
      readonly requestId: string;
      readonly version: number;
    };

/** What an intent finds, read inside the transaction it will write in. */
export interface StreakDefinitionSnapshot {
  /** The head as a model; `null` when nobody has published this rule. */
  readonly schedule: StreakDefinitionSchedule | null;
  /**
   * The highest version ever written, the withdrawn among them; 0 with
   * none. After a withdrawal it is more than the head's newest, and the
   * next version is numbered above IT: a version document is written once.
   */
  readonly highestVersion: number;
}

/** The ONE audit row of an act: ids and codes only, never a sentence. */
export interface StreakDefinitionAudit {
  readonly actor: Actor;
  readonly action:
    typeof STREAK_DEFINITION_PUBLISHED | typeof STREAK_DEFINITION_WITHDRAWN;
  readonly resourceId: string;
  readonly atIso: string;
  readonly context: Readonly<Record<string, string>>;
  /** The intent's `requestId`: a retry derives the same row id and writes nothing twice. */
  readonly changeKey: string;
}

/** Everything one act writes. The store writes all of it or none of it. */
export interface StreakDefinitionDecision {
  readonly receipt: StreakDefinitionReceipt;
  /** The head as it stands after the act. */
  readonly head: StreakDefinitionSchedule;
  /** The instant of the act: the head's `updatedAt`, a version's `publishedAt`, a called-off version's `withdrawnAt`. */
  readonly at: Date;
  /** The version a publish adds; `null` on a withdrawal, which adds none. */
  readonly version: StreakDefinitionVersionRecord | null;
  /** The versions that waited and are called off by this act, by number. */
  readonly calledOff: readonly number[];
  readonly audit: StreakDefinitionAudit;
}

/**
 * What an intent resolved to: a fresh decision, written, or the discovery
 * that THIS intent was written before (its answer was lost and the caller
 * asked again). A replay carries the answer the first attempt gave.
 */
export type StreakDefinitionOutcome =
  | { readonly kind: 'written'; readonly decision: StreakDefinitionDecision }
  | { readonly kind: 'replayed'; readonly receipt: StreakDefinitionReceipt };

/**
 * The transactional boundary. It looks for the intent's own earlier write,
 * loads the snapshot, hands it to the decision and writes what the
 * decision returns: the version, the head and the audit row, in ONE
 * transaction.
 */
export interface StreakDefinitionStore {
  commit(
    intent: StreakDefinitionIntent,
    decide: (
      snapshot: StreakDefinitionSnapshot,
    ) => Result<StreakDefinitionDecision, PublishStreakDefinitionFailure>,
  ): Promise<Result<StreakDefinitionOutcome, PublishStreakDefinitionFailure>>;
}

/**
 * `publishStreakDefinition`: the ONLY writer of the rhythm's rule
 * (client-card-revision-3 §4.4). `firestore.rules` refuses every client
 * write to `streakDefinitions`, so there is no second door.
 *
 * The browser ran the same domain before it asked, so the page could name
 * a field or a day without a round trip. None of that is trusted here. The
 * server builds the rule again from the draft as sent, classes the change
 * again against the rule in force on ITS today, and holds the day to ITS
 * notice policy.
 *
 * What it decides, in order, and the reference it must agree with is
 * `InMemoryStreakDefinitionRepository` (`@creativo/application/engagement/
 * testing`), which the page's specs run against:
 *
 * 1. the caller is one of the pair (`notAdmin`);
 * 2. an intent already written answers as it did, and writes nothing;
 * 3. a recompute is refused: it needs the engine, and there is none
 *    (`recomputeNeedsEngine`); so is a preview nobody can vouch for
 *    (`previewStale`);
 * 4. the head has not moved since the draft was made (`stale`);
 * 5. the draft is a rule (`invalid`, with every field at fault);
 * 6. the day asked is no earlier than the change may start (`tooEarly`,
 *    with the first day it may);
 * 7. effective today or earlier the version is the rule in force at once;
 *    later, it WAITS, in place of whatever waited, which is called off.
 *
 * THE WRITER NUMBERS THE VERSION, one above the highest ever written. The
 * number a draft carries is a proposal: after a withdrawal `baseVersion +
 * 1` is the number of the version that was called off, and a version
 * document is never written twice.
 *
 * It contains NO engine. Publishing changes the rule a reader resolves by
 * date; nobody's run is recomputed here.
 */
export class PublishStreakDefinitionUseCase {
  constructor(
    private readonly store: StreakDefinitionStore,
    private readonly clock: ClockPort,
    private readonly policy: StreakNoticePolicy = {
      clientsSeeRhythm: false,
      noticeDays: RULE_CHANGE_NOTICE_DAYS,
    },
  ) {}

  /**
   * May this caller change the rule at all? Asked by the callable BEFORE it
   * reads the request, so a stranger is told they may not ask and never
   * what was wrong with the asking; asked again by `execute` and
   * `withdraw`, so neither can be reached around it.
   */
  admit(
    caller: StreakDefinitionCaller | null,
  ): Result<
    StreakDefinitionCaller,
    | PublishStreakDefinitionUnauthenticatedError
    | PublishStreakDefinitionNotAdminError
  > {
    if (caller === null || caller.uid.trim().length === 0) {
      return fail(new PublishStreakDefinitionUnauthenticatedError());
    }
    return caller.isAdmin
      ? ok(caller)
      : fail(new PublishStreakDefinitionNotAdminError());
  }

  async execute(
    input: PublishStreakDefinitionInput,
  ): Promise<Result<StreakDefinitionReceipt, PublishStreakDefinitionFailure>> {
    const caller = this.admit(input.caller);
    if (caller.isFailure()) return fail(caller.error);
    const now = this.now();
    if (now.isFailure()) return fail(now.error);

    const outcome = await this.store.commit(
      {
        act: 'publish',
        streakId: input.streakId,
        requestId: input.requestId,
      },
      (snapshot) => this.publish(input, caller.value, snapshot, now.value),
    );
    return outcome.isFailure()
      ? fail(outcome.error)
      : ok(receiptOf(outcome.value));
  }

  async withdraw(
    input: WithdrawStreakDefinitionInput,
  ): Promise<Result<StreakDefinitionReceipt, PublishStreakDefinitionFailure>> {
    const caller = this.admit(input.caller);
    if (caller.isFailure()) return fail(caller.error);
    const now = this.now();
    if (now.isFailure()) return fail(now.error);

    const outcome = await this.store.commit(
      {
        act: 'withdraw',
        streakId: input.streakId,
        requestId: input.requestId,
        version: input.version,
      },
      (snapshot) => this.callOff(input, caller.value, snapshot, now.value),
    );
    return outcome.isFailure()
      ? fail(outcome.error)
      : ok(receiptOf(outcome.value));
  }

  /**
   * Steps 3 to 7: the publish, decided over what the transaction read — the
   * decision is `StreakPublishSystem` (`@creativo/ecs-core`); this method
   * reads the draft through the wire's reader between its two halves and
   * hands the answer on as the classes the callable knows.
   */
  private publish(
    input: PublishStreakDefinitionInput,
    caller: StreakDefinitionCaller,
    snapshot: StreakDefinitionSnapshot,
    now: Moment,
  ): Result<StreakDefinitionDecision, PublishStreakDefinitionFailure> {
    const { schedule } = snapshot;
    const head = schedule === null ? null : headOf(schedule);
    const admitted = StreakPublishSystem.admit(
      {
        baseVersion: input.baseVersion,
        streakTransition: transitionOf(input.transition),
        previewHash: input.previewHash,
      },
      { head, highestVersion: snapshot.highestVersion },
    );
    if (!admitted.ok) return fail(refusalOf(admitted.error));

    const name = StreakPublishSystem.nameOf(
      StreakDefinitionId.of(input.streakId),
      schedule === null
        ? null
        : { bg: schedule.current.name.bg, en: schedule.current.name.en },
    );
    if (name === null) {
      return fail(new PublishStreakDefinitionInvalidError(['id']));
    }
    const built = ruleOf(
      input.streakId,
      { bg: name.bg, en: name.en },
      {
        ...input.draft,
        version: admitted.value,
        effectiveFrom: input.effectiveFrom,
      },
      now.at,
    );
    if (built.isFailure()) {
      return fail(new PublishStreakDefinitionInvalidError(built.error));
    }
    const definition = built.value;

    const decided = StreakPublishSystem.decide(
      structOf(definition),
      transitionOf(input.transition),
      head,
      dayOf(now.today),
      this.policy,
    );
    if (!decided.ok) return fail(refusalOf(decided.error));
    const { calledOff, inForceVersion } = decided.value;
    // The change in the legacy words the receipt, the version and the
    // audit row have always carried.
    const change = {
      direction: LEGACY_DIRECTION[decided.value.change.direction],
      changed: decided.value.change.changed.map(
        (parameter) => LEGACY_PARAMETER[parameter],
      ),
    };

    // The head the system decided, as the classes it was made of: the new
    // version in force at once, or waiting beside the rule in force.
    const inForce = schedule?.inForceOn(now.today) ?? null;
    const legacyHead = StreakDefinitionSchedule.create(
      StreakRuleSystem.scheduled(decided.value.head) === null ||
        inForce === null
        ? { current: definition, scheduled: null }
        : {
            current: inForce,
            scheduled: { definition, transition: input.transition },
          },
    );
    if (legacyHead.isFailure()) {
      return fail(
        new PublishStreakDefinitionInvalidError(
          unique(legacyHead.error.map((error) => error.field)),
        ),
      );
    }

    const replaced = calledOff[0] ?? null;
    const changed: StreakRuleChange['changed'] = change.changed;
    return ok({
      receipt: {
        kind: 'published',
        version: definition.version,
        effectiveFrom: definition.effectiveFrom,
        direction: change.direction,
      },
      head: legacyHead.value,
      at: now.at,
      version: {
        definition,
        publishedAt: now.at,
        publishedBy: caller.uid,
        transition: input.transition,
        direction: change.direction,
        changed,
        requestId: input.requestId,
        withdrawnAt: null,
      },
      calledOff,
      audit: {
        actor: caller.actor,
        action: STREAK_DEFINITION_PUBLISHED,
        resourceId: streakDefinitionResourceId(input.streakId),
        atIso: now.at.toISOString(),
        context: {
          from: String(inForceVersion),
          to: String(definition.version),
          effectiveFrom: definition.effectiveFrom,
          transition: input.transition,
          direction: change.direction,
          changed: changed.join(','),
          ...(replaced === null ? {} : { replaced: String(replaced) }),
        },
        changeKey: input.requestId,
      },
    });
  }

  /**
   * The withdrawal, decided over what the transaction read
   * (`StreakPublishSystem.withdraw`). `version` names what is called off,
   * so an undo that arrives after the head moved on (the day came, another
   * publish replaced it, somebody else called it off) is refused instead of
   * calling off something else.
   */
  private callOff(
    input: WithdrawStreakDefinitionInput,
    caller: StreakDefinitionCaller,
    snapshot: StreakDefinitionSnapshot,
    now: Moment,
  ): Result<StreakDefinitionDecision, PublishStreakDefinitionFailure> {
    const { schedule } = snapshot;
    const withdrawn = StreakPublishSystem.withdraw(
      input.version,
      schedule === null ? null : headOf(schedule),
      dayOf(now.today),
    );
    if (!withdrawn.ok || schedule === null) {
      return fail(
        withdrawn.ok
          ? new PublishStreakDefinitionStaleError(input.version, 0)
          : refusalOf(withdrawn.error),
      );
    }
    const head = StreakDefinitionSchedule.create({
      current: schedule.current,
      scheduled: null,
    });
    if (head.isFailure()) {
      return fail(
        new PublishStreakDefinitionInvalidError(
          unique(head.error.map((error) => error.field)),
        ),
      );
    }
    const { waiting } = withdrawn.value;
    return ok({
      receipt: { kind: 'withdrawn', version: input.version },
      head: head.value,
      at: now.at,
      version: null,
      calledOff: withdrawn.value.calledOff,
      audit: {
        actor: caller.actor,
        action: STREAK_DEFINITION_WITHDRAWN,
        resourceId: streakDefinitionResourceId(input.streakId),
        atIso: now.at.toISOString(),
        context: {
          // What waited, and the version the shop stays under.
          from: String(input.version),
          to: String(schedule.current.version),
          effectiveFrom: waiting.effectiveFromLocalDate,
          // What waits always names its transition (the head's SCHEDULED element).
          transition:
            LEGACY_TRANSITION[
              waiting.streakTransition ??
                defect('a waiting rule names its transition')
            ],
        },
        changeKey: input.requestId,
      },
    });
  }

  /**
   * The SERVER's clock, never the caller's: the instant of the act, and the
   * day of the shop's calendar it falls on (`LOYALTY_ZONE`, the zone every
   * loyalty date is a day of).
   */
  private now(): Result<Moment, PublishStreakDefinitionStoreError> {
    const now = this.clock.now(LOYALTY_ZONE);
    return now.isFailure()
      ? fail(new PublishStreakDefinitionStoreError(now.error))
      : ok({
          at: new Date(now.value.toMillis()),
          today: now.value.toISODate(),
        });
  }
}

/** The instant of an act, and the Europe/Sofia day it falls on. */
interface Moment {
  readonly at: Date;
  readonly today: IsoDate;
}

function receiptOf(outcome: StreakDefinitionOutcome): StreakDefinitionReceipt {
  return outcome.kind === 'replayed'
    ? outcome.receipt
    : outcome.decision.receipt;
}

/**
 * The draft → the rule, through the SAME reader every stored rule is read
 * by (`streakScheduleFromDocument`) and so through the domain's factory:
 * what this accepts is exactly what reads back. The draft is read as the
 * head it would be if it stood alone.
 *
 * A failure is the fields at fault: every one the domain names, or the one
 * field the reader stopped at because it is not of the wire's kind (a
 * grace of "7", an interval with no days).
 */
function ruleOf(
  streakId: string,
  name: { bg: string; en: string },
  body: Readonly<Record<string, unknown>>,
  at: Date,
): Result<StreakDefinition, readonly string[]> {
  const read = streakScheduleFromDocument(streakId, {
    name,
    current: body,
    scheduled: null,
    updatedAt: at.toISOString(),
  });
  return read.isSuccess()
    ? ok(read.value.current)
    : fail(
        fieldsOf(
          read.error,
          `${streakDefinitionResourceId(streakId)}.current.`,
        ),
      );
}

/** The fields a refused document names, as paths into the rule. */
function fieldsOf(error: RepositoryError, root: string): readonly string[] {
  const { cause } = error;
  if (Array.isArray(cause)) {
    return unique(
      cause
        .map((fault: unknown) => fieldOf(fault, 'field'))
        .filter((field): field is string => field !== null),
    );
  }
  const path = fieldOf(cause, 'path');
  return path !== null && path.startsWith(root)
    ? // `excuses[2]` is a fault of `excuses`: the page keys a control, not an entry.
      [path.slice(root.length).replace(/\[\d+\]$/, '')]
    : [];
}

/** A text property of something thrown, or `null`. */
function fieldOf(fault: unknown, key: 'field' | 'path'): string | null {
  if (typeof fault !== 'object' || fault === null) return null;
  const value: unknown = new Map(Object.entries(fault)).get(key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const unique = (fields: readonly string[]): readonly string[] => [
  ...new Set(fields),
];

// ── The bridge: legacy class ↔ ecs-core struct (Phase 4 deletes it) ──────

const SYSTEM_EXCUSE = {
  shopClosure: SystemExcuse.ShopClosure,
  barberAbsence: SystemExcuse.BarberAbsence,
  staffCancelled: SystemExcuse.StaffCancelled,
  closedDays: SystemExcuse.ClosedDays,
} as const satisfies Record<StreakExcuse, SystemExcuse>;

const SYSTEM_ON_BREAK = {
  restart: SystemOnBreak.Restart,
  hold: SystemOnBreak.Hold,
} as const satisfies Record<StreakOnBreak, SystemOnBreak>;

const SYSTEM_TRANSITION = {
  grandfather: SystemTransition.Grandfather,
  recompute: SystemTransition.Recompute,
} as const satisfies Record<StreakTransition, SystemTransition>;

const LEGACY_TRANSITION = {
  [SystemTransition.Grandfather]: 'grandfather',
  [SystemTransition.Recompute]: 'recompute',
} as const satisfies Record<SystemTransition, StreakTransition>;

/** A change's direction, in the words the receipt and the audit row carry. */
const LEGACY_DIRECTION: Readonly<Record<SystemDirection, StreakRuleDirection>> =
  {
    [SystemDirection.Looser]: 'looser',
    [SystemDirection.Stricter]: 'stricter',
    [SystemDirection.Mixed]: 'mixed',
    [SystemDirection.Neutral]: 'neutral',
    [SystemDirection.Switch]: 'switch',
  };

/** A parameter that moved, as the legacy props name it. */
const LEGACY_PARAMETER: Readonly<
  Record<StreakRuleParameter, StreakRuleChange['changed'][number]>
> = {
  [StreakRuleParameter.Name]: 'name',
  [StreakRuleParameter.Enabled]: 'enabled',
  [StreakRuleParameter.Qualifier]: 'qualifier',
  [StreakRuleParameter.MinGapDays]: 'minGapDays',
  [StreakRuleParameter.BookingHold]: 'bookingHold',
  [StreakRuleParameter.Interval]: 'interval',
  [StreakRuleParameter.GraceDays]: 'graceDays',
  [StreakRuleParameter.RiskLeadDays]: 'riskLeadDays',
  [StreakRuleParameter.Protections]: 'protections',
  [StreakRuleParameter.Excuses]: 'excuses',
  [StreakRuleParameter.ClientPause]: 'clientPause',
  [StreakRuleParameter.Repair]: 'repair',
  [StreakRuleParameter.OnBreak]: 'onBreak',
};

/**
 * A field at fault as the callable has always spelled it: the legacy
 * rule's dotted locator (`interval.days`, `scheduled.effectiveFrom`), never
 * the flat field the system names (`intervalDays`,
 * `scheduledEffectiveFromLocalDate`).
 */
const LEGACY_FIELD: Readonly<Record<StreakRuleField, string>> = {
  [StreakRuleField.Id]: 'id',
  [StreakRuleField.NameBg]: 'name.bg',
  [StreakRuleField.NameEn]: 'name.en',
  [StreakRuleField.Version]: 'version',
  [StreakRuleField.EffectiveFromLocalDate]: 'effectiveFrom',
  [StreakRuleField.QualifierKind]: 'qualifier.kind',
  [StreakRuleField.QualifierServiceIds]: 'qualifier.serviceIds',
  [StreakRuleField.QualifierCategoryIds]: 'qualifier.categoryIds',
  [StreakRuleField.MinGapDays]: 'minGapDays',
  [StreakRuleField.BookingHoldMaxDaysPastDue]: 'bookingHold.maxDaysPastDue',
  [StreakRuleField.IntervalKind]: 'interval.kind',
  [StreakRuleField.IntervalDays]: 'interval.days',
  [StreakRuleField.IntervalTolerancePct]: 'interval.tolerancePct',
  [StreakRuleField.IntervalMinDays]: 'interval.minDays',
  [StreakRuleField.IntervalMaxDays]: 'interval.maxDays',
  [StreakRuleField.IntervalFallbackDays]: 'interval.fallbackDays',
  [StreakRuleField.GraceDays]: 'graceDays',
  [StreakRuleField.RiskLeadDays]: 'riskLeadDays',
  [StreakRuleField.ProtectionsMaxBanked]: 'protections.maxBanked',
  [StreakRuleField.ProtectionsEarnEvery]: 'protections.earnEvery',
  [StreakRuleField.ProtectionsStartWith]: 'protections.startWith',
  [StreakRuleField.Excuses]: 'excuses',
  [StreakRuleField.ClientPauseMaxDaysPerYear]: 'clientPause.maxDaysPerYear',
  [StreakRuleField.RepairWindowDays]: 'repair.windowDays',
  [StreakRuleField.RepairPerYear]: 'repair.perYear',
  [StreakRuleField.OnBreak]: 'onBreak',
  [StreakRuleField.ScheduledVersion]: 'scheduled.version',
  [StreakRuleField.ScheduledEffectiveFromLocalDate]: 'scheduled.effectiveFrom',
  [StreakRuleField.ScheduledTransition]: 'scheduled.transition',
};

/** The shop's day the server's clock read: always a day. */
function dayOf(raw: IsoDate): LocalDate {
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : defect(`${raw} is no calendar day`);
}

/**
 * A transition in the system's words. One the vocabulary does not know
 * is handed across as written: the system's own guard refuses it.
 */
function transitionOf(transition: StreakTransition): SystemTransition {
  const known: SystemTransition | undefined = (
    SYSTEM_TRANSITION as Readonly<Record<string, SystemTransition>>
  )[transition];
  return known ?? (transition as string as SystemTransition);
}

/**
 * A version as `StreakPublishSystem` reads it: the class's figures, flat
 * (every part's figures prefixed by the part), every tag the dictionary's;
 * its day was checked by `StreakDefinition.create`.
 */
function structOf(definition: StreakDefinition): StreakRule {
  const props = definition.toProps();
  const { qualifier, interval } = props;
  return {
    version: props.version,
    effectiveFromLocalDate: dayOf(props.effectiveFrom),
    enabled: props.enabled,
    ...(qualifier.kind === 'services'
      ? StreakQualifierRule.services(
          qualifier.serviceIds.map((id) => ServiceId.of(id)),
        )
      : qualifier.kind === 'categories'
        ? StreakQualifierRule.categories(
            qualifier.categoryIds.map((id) => ServiceCategoryId.of(id)),
          )
        : StreakQualifierRule.anyVisit()),
    minGapDays: props.minGapDays,
    bookingHoldEnabled: props.bookingHold.enabled,
    bookingHoldMaxDaysPastDue: props.bookingHold.maxDaysPastDue,
    ...(interval.kind === 'fixed'
      ? StreakIntervalRule.fixed(interval.days)
      : StreakIntervalRule.personal(
          interval.tolerancePct,
          interval.minDays,
          interval.maxDays,
          interval.fallbackDays,
        )),
    graceDays: props.graceDays,
    riskLeadDays: props.riskLeadDays,
    protectionsEnabled: props.protections.enabled,
    protectionsMaxBanked: props.protections.maxBanked,
    protectionsEarnEvery: props.protections.earnEvery,
    protectionsStartWith: props.protections.startWith,
    excuses: props.excuses.map((excuse) => SYSTEM_EXCUSE[excuse]),
    clientPauseEnabled: props.clientPause.enabled,
    clientPauseMaxDaysPerYear: props.clientPause.maxDaysPerYear,
    repairEnabled: props.repair.enabled,
    repairWindowDays: props.repair.windowDays,
    repairPerYear: props.repair.perYear,
    onBreak: SYSTEM_ON_BREAK[props.onBreak],
  };
}

/** The head as the system reads it: its `rules` list, the rule in force first. */
function headOf(schedule: StreakDefinitionSchedule): StreakSchedule {
  const { scheduled } = schedule;
  const current = {
    ...structOf(schedule.current),
    headRole: HeadRole.Current,
    streakTransition: null,
  };
  return {
    rules:
      scheduled === null
        ? [current]
        : [
            current,
            {
              ...structOf(scheduled.definition),
              headRole: HeadRole.Scheduled,
              streakTransition: transitionOf(scheduled.transition),
            },
          ],
  };
}

/** The system's refusal as the class the callable answers with; fields spelled as the legacy rule spells them. */
function refusalOf(error: StreakPublishError): PublishStreakDefinitionFailure {
  switch (error.errorCode) {
    case StreakPublishErrorCode.RecomputeNeedsEngine:
      return new PublishStreakDefinitionRecomputeNeedsEngineError();
    case StreakPublishErrorCode.PreviewStale:
      return new PublishStreakDefinitionPreviewStaleError();
    case StreakPublishErrorCode.Stale:
      return new PublishStreakDefinitionStaleError(
        error.expected,
        error.actual,
      );
    case StreakPublishErrorCode.TooEarly:
      return new PublishStreakDefinitionTooEarlyError(
        error.effectiveFromLocalDate,
        error.earliest,
      );
    default:
      return new PublishStreakDefinitionInvalidError(
        unique(
          error.fields.map(
            (field) =>
              (LEGACY_FIELD as Readonly<Record<string, string>>)[field] ??
              field,
          ),
        ),
      );
  }
}
