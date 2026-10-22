import { type Functions, httpsCallable } from 'firebase/functions';
import type { LoyaltyCatalogMemo } from '@creativo/infrastructure/firebase-app';
import {
  StreakExcuse,
  StreakInterval,
  StreakOnBreak,
  StreakPublishCall,
  StreakQualifier,
  type StreakRule,
  StreakRuleDirection,
  StreakTransition,
} from '@core/components';
import {
  LocalDate,
  RepositoryError,
  Result,
  StreakPublishError,
  StreakRuleField,
  type StreakDefinitionId,
} from '@core/primitives';
import { Collections } from '@core/entities';
import { Callables, type StreakPublishGatewayPorts } from '@core/ports';
import { reasonOf } from './observe';

// ── The frozen wire (flip-3 plan F3-3) ──────────────────────────────────
//
// This file is one of the two edges of the `publishStreakDefinition`
// callable (the server's is `apps/functions/src/wire/loyalty.wire.ts`):
// the request still carries today's NESTED legacy draft and lowercase
// words, the answer still speaks them. Both edges go when Phase 4's
// `callableClient` lands; until then nothing else may spell this wire.

/** Which visit keeps the rhythm, as the draft spells it. */
type WireQualifier =
  | { readonly kind: 'anyVisit' }
  | { readonly kind: 'services'; readonly serviceIds: readonly string[] }
  | { readonly kind: 'categories'; readonly categoryIds: readonly string[] };

/** How long a period lasts, as the draft spells it. */
type WireInterval =
  | { readonly kind: 'fixed'; readonly days: number }
  | {
      readonly kind: 'personal';
      readonly tolerancePct: number;
      readonly minDays: number;
      readonly maxDays: number;
      readonly fallbackDays: number;
    };

/**
 * The draft the callable reads: ONE version of the rule as the legacy
 * body nested it, field for field and in its key order — the shape the
 * legacy draft mapper wrote (pinned by the spec against its output,
 * recorded on 2026-10-22 before the mapper was deleted). Neither the id
 * nor the name rides in it: they are the head's. Its `version` and
 * `effectiveFrom` are sent and not read (the request's own fields are).
 */
type StreakDraftWire = {
  readonly version: number;
  readonly effectiveFrom: string;
  readonly enabled: boolean;
  readonly qualifier: WireQualifier;
  readonly minGapDays: number;
  readonly bookingHold: {
    readonly enabled: boolean;
    readonly maxDaysPastDue: number;
  };
  readonly interval: WireInterval;
  readonly graceDays: number;
  readonly riskLeadDays: number;
  readonly protections: {
    readonly enabled: boolean;
    readonly maxBanked: number;
    readonly earnEvery: number;
    readonly startWith: number;
  };
  readonly excuses: readonly string[];
  readonly clientPause: {
    readonly enabled: boolean;
    readonly maxDaysPerYear: number;
  };
  readonly repair: {
    readonly enabled: boolean;
    readonly windowDays: number;
    readonly perYear: number;
  };
  readonly onBreak: string;
};

/**
 * What the callable is sent. A publish is §4.4's request, word for word,
 * said to be one (`op`); a withdrawal names the version it calls off, so
 * an undo that arrives after the head moved on is refused rather than
 * calling off something else.
 */
type StreakPublishRequestWire =
  | {
      readonly op: 'publish';
      readonly requestId: string;
      readonly streakId: string;
      readonly baseVersion: number;
      readonly draft: StreakDraftWire;
      readonly effectiveFrom: string;
      readonly transition: string;
      readonly previewHash: string | null;
    }
  | {
      readonly op: 'withdraw';
      readonly requestId: string;
      readonly streakId: string;
      readonly version: number;
    };

/** An excuse as the draft spells it. */
function excuseWordOf(excuse: StreakExcuse): string {
  switch (excuse) {
    case StreakExcuse.ShopClosure:
      return 'shopClosure';
    case StreakExcuse.BarberAbsence:
      return 'barberAbsence';
    case StreakExcuse.StaffCancelled:
      return 'staffCancelled';
    case StreakExcuse.ClosedDays:
      return 'closedDays';
  }
}

const ON_BREAK_WORD = {
  [StreakOnBreak.Restart]: 'restart',
  [StreakOnBreak.Hold]: 'hold',
} as const satisfies Record<StreakOnBreak, string>;

const TRANSITION_WORD = {
  [StreakTransition.Grandfather]: 'grandfather',
  [StreakTransition.Recompute]: 'recompute',
} as const satisfies Record<StreakTransition, string>;

/** The answer's direction words → the flat dictionary. */
const DIRECTION_OF_WORD: ReadonlyMap<unknown, StreakRuleDirection> = new Map<
  unknown,
  StreakRuleDirection
>([
  ['looser', StreakRuleDirection.Looser],
  ['stricter', StreakRuleDirection.Stricter],
  ['mixed', StreakRuleDirection.Mixed],
  ['neutral', StreakRuleDirection.Neutral],
  ['switch', StreakRuleDirection.Switch],
]);

/**
 * The legacy dotted field locators a refusal's `fields` names (the wire's
 * `StreakDefinitionField`) → the FLAT `StreakRuleField` the admin page
 * keys its controls by. Exhaustive over the flat fields; a locator this
 * table does not know is handed on as written.
 */
const LOCATOR_OF_FIELD = {
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
} as const satisfies Record<StreakRuleField, string>;

const FIELD_OF_LOCATOR: ReadonlyMap<string, string> = new Map(
  Object.entries(LOCATOR_OF_FIELD).map(([field, locator]) => [locator, field]),
);

/** The six words a refusal is answered in. */
const REFUSAL_WORDS: ReadonlySet<unknown> = new Set<unknown>([
  'notAdmin',
  'invalid',
  'stale',
  'tooEarly',
  'recomputeNeedsEngine',
  'previewStale',
]);

/**
 * The SDK's codes for "you may not". The callable throws the first when
 * nobody is signed in (a session that ended while the draft was open),
 * and the platform the second before the callable is reached. Both are
 * read as the caller not being the admin pair: the other failure would
 * tell them to try again, which cannot help.
 */
const NOT_ALLOWED_CODES: ReadonlySet<unknown> = new Set<unknown>([
  'functions/permission-denied',
  'functions/unauthenticated',
  'permission-denied',
  'unauthenticated',
]);

/** The rule as the draft the callable reads — field for field, in the legacy key order. */
function streakDraftOf(rule: StreakRule): StreakDraftWire {
  return {
    version: rule.version,
    effectiveFrom: rule.effectiveFromLocalDate,
    enabled: rule.enabled,
    qualifier:
      rule.streakQualifier === StreakQualifier.Services
        ? { kind: 'services', serviceIds: [...rule.qualifierServiceIds] }
        : rule.streakQualifier === StreakQualifier.Categories
          ? { kind: 'categories', categoryIds: [...rule.qualifierCategoryIds] }
          : { kind: 'anyVisit' },
    minGapDays: rule.minGapDays,
    bookingHold: {
      enabled: rule.bookingHoldEnabled,
      maxDaysPastDue: rule.bookingHoldMaxDaysPastDue,
    },
    interval:
      rule.streakInterval === StreakInterval.Personal
        ? {
            kind: 'personal',
            tolerancePct: rule.intervalTolerancePct,
            minDays: rule.intervalMinDays,
            maxDays: rule.intervalMaxDays,
            fallbackDays: rule.intervalFallbackDays,
          }
        : { kind: 'fixed', days: rule.intervalDays },
    graceDays: rule.graceDays,
    riskLeadDays: rule.riskLeadDays,
    protections: {
      enabled: rule.protectionsEnabled,
      maxBanked: rule.protectionsMaxBanked,
      earnEvery: rule.protectionsEarnEvery,
      startWith: rule.protectionsStartWith,
    },
    excuses: rule.excuses.map(excuseWordOf),
    clientPause: {
      enabled: rule.clientPauseEnabled,
      maxDaysPerYear: rule.clientPauseMaxDaysPerYear,
    },
    repair: {
      enabled: rule.repairEnabled,
      windowDays: rule.repairWindowDays,
      perYear: rule.repairPerYear,
    },
    onBreak: ON_BREAK_WORD[rule.onBreak],
  };
}

// ── Reading the answer ──────────────────────────────────────────────────

/** What the call asked, for a refusal that names less than it needs. */
type Asked = {
  /** The version the request names: the publish's `baseVersion`, the withdrawal's `version`. */
  readonly version: number;
  /** The day the publish asks for; `null` for a withdrawal, which asks none. */
  readonly day: LocalDate | null;
};

type Fields = Readonly<Record<string, unknown>>;

function recordOf(raw: unknown): Fields | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Fields)
    : null;
}

function versionOf(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1
    ? raw
    : null;
}

function dayOf(raw: unknown): LocalDate | null {
  if (typeof raw !== 'string') return null;
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : null;
}

/** The flat fields a refusal names; what is no text is no field, a locator nobody knows is kept as written. */
function fieldsOf(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const fields: string[] = [];
  for (const locator of raw) {
    if (typeof locator === 'string') {
      fields.push(FIELD_OF_LOCATOR.get(locator) ?? locator);
    }
  }
  return fields;
}

/**
 * A refusal word as the ecs struct, or `null` for a word nobody knows. The
 * wire carries only the word (and, for `invalid`, the fields; for
 * `tooEarly`, maybe the day): a `stale` names no head version, so both its
 * figures restate the version the request named; a `tooEarly` without a
 * day the wire can vouch for falls back to the day the publish asked for —
 * and a withdrawal asks none, so it is no answer at all.
 */
function refusalOf(
  word: unknown,
  carried: Fields,
  asked: Asked,
): StreakPublishError | null {
  if (!REFUSAL_WORDS.has(word)) return null;
  switch (word) {
    case 'notAdmin':
      return StreakPublishError.callerNotAdmin();
    case 'invalid':
      return StreakPublishError.invalid(fieldsOf(carried['fields']));
    case 'stale':
      return StreakPublishError.stale(asked.version, asked.version);
    case 'tooEarly': {
      const earliest = dayOf(carried['earliest']) ?? asked.day;
      return earliest === null
        ? null
        : StreakPublishError.tooEarly(asked.day ?? earliest, earliest);
    }
    case 'recomputeNeedsEngine':
      return StreakPublishError.recomputeNeedsEngine();
    default:
      return StreakPublishError.previewStale();
  }
}

/**
 * A refusal that arrived THROWN. The callable ANSWERS its refusals and
 * throws its faults, so this reads two things only: details that spell
 * one of the six words (should a refusal ever be thrown), and the SDK's
 * own "you may not" (`NOT_ALLOWED_CODES`). Every other thrown error is a
 * fault: `null`. Duck-typed off the error: the shape is stable across SDK
 * versions and the class buys nothing.
 */
function thrownRefusalOf(
  error: unknown,
  asked: Asked,
): StreakPublishError | null {
  const thrown = recordOf(error);
  if (thrown === null) return null;
  const details = recordOf(thrown['details']);
  if (details !== null) {
    const word = REFUSAL_WORDS.has(details['refusal'])
      ? details['refusal']
      : details['code'];
    const refusal = refusalOf(word, details, asked);
    if (refusal !== null) return refusal;
  }
  return NOT_ALLOWED_CODES.has(thrown['code'])
    ? StreakPublishError.callerNotAdmin()
    : null;
}

/**
 * THE RHYTHM'S PUBLISH AND WITHDRAWAL through the admin-only callable
 * (flip 3, plan §3.4; client-card-revision-3.md §4.4) — the web's half of
 * the frozen wire.
 *
 * A publish and a withdrawal are two operations of one callable, which
 * answers in words (`published` / `withdrawn` / `refused`). A refusal is
 * an ordinary answer and a `StreakPublishError`, never a throw; a request
 * that got no answer (offline, a timeout, a request the server could not
 * read, a write that fell over) is a `RepositoryError` — the OTHER
 * failure, the one trying again fixes — and so is an answer that is none
 * the call expects: a publish with no number or a day that is no day, a
 * word nobody knows, a withdrawal answered to a publish, a withdrawal
 * answered for another version or as a publish. Reporting a write that
 * may not have happened is the one failure worse than reporting none.
 *
 * A `tooEarly` refusal carries the first day the change may start when
 * the answer names it; else the day the publish asked for.
 *
 * After a write that landed and passed those checks — and only then — the
 * session's copy of the catalogue (`memo`, the root
 * `LOYALTY_CATALOG_MEMO`) is dropped, so the next card opened in this
 * session reads the rule that was just published.
 */
export const streakPublishGatewayPorts = (
  functions: Functions,
  memo: LoyaltyCatalogMemo,
): StreakPublishGatewayPorts => {
  /** One round trip: the answer as sent, or the thrown error. */
  const send = async (
    request: StreakPublishRequestWire,
  ): Promise<
    | { readonly answered: true; readonly data: unknown }
    | {
        readonly answered: false;
        readonly error: unknown;
      }
  > => {
    const callable = httpsCallable<StreakPublishRequestWire, unknown>(
      functions,
      Callables.PublishStreakDefinition,
    );
    try {
      return { answered: true, data: (await callable(request)).data };
    } catch (error) {
      return { answered: false, error };
    }
  };

  /** A refusal answered or thrown, the fault, or `null` when the answer is something else. */
  const failureOf = (
    sent: Awaited<ReturnType<typeof send>>,
    asked: Asked,
    path: string,
  ): StreakPublishError | RepositoryError | null => {
    if (!sent.answered) {
      return (
        thrownRefusalOf(sent.error, asked) ??
        RepositoryError.writeFailed(path, reasonOf(sent.error))
      );
    }
    const answer = recordOf(sent.data);
    return answer !== null && answer['kind'] === 'refused'
      ? refusalOf(answer['code'], answer, asked)
      : null;
  };

  const unusable = (path: string, why: string): RepositoryError =>
    RepositoryError.malformed(
      path,
      `${Callables.PublishStreakDefinition} answered nothing usable: ${why}`,
    );

  const pathOf = (streakId: StreakDefinitionId): string =>
    `${Collections.StreakDefinitions}/${streakId}`;

  return {
    publishStreakRule: async (call) => {
      const path = pathOf(call.streakId);
      const asked: Asked = {
        version: call.baseVersion,
        day: call.rule.effectiveFromLocalDate,
      };
      const sent = await send({
        op: 'publish',
        requestId: call.requestId,
        streakId: call.streakId,
        baseVersion: call.baseVersion,
        draft: streakDraftOf(call.rule),
        effectiveFrom: call.rule.effectiveFromLocalDate,
        transition: TRANSITION_WORD[call.streakTransition],
        previewHash: call.previewHash,
      });
      const failure = failureOf(sent, asked, path);
      if (failure !== null) return Result.err(failure);
      const answer = sent.answered ? recordOf(sent.data) : null;
      if (answer === null || answer['kind'] !== 'published') {
        return Result.err(
          unusable(
            path,
            answer !== null && answer['kind'] === 'withdrawn'
              ? 'a publish was answered as a withdrawal'
              : 'the answer is none it knows',
          ),
        );
      }
      const version = versionOf(answer['version']);
      const effectiveFrom = dayOf(answer['effectiveFrom']);
      const direction = DIRECTION_OF_WORD.get(answer['direction']);
      if (
        version === null ||
        effectiveFrom === null ||
        direction === undefined
      ) {
        return Result.err(unusable(path, 'the answer is none it knows'));
      }
      memo.invalidate();
      return Result.ok(
        StreakPublishCall.receipt(version, effectiveFrom, direction),
      );
    },

    withdrawStreakRule: async (call) => {
      const path = pathOf(call.streakId);
      const sent = await send({
        op: 'withdraw',
        requestId: call.requestId,
        streakId: call.streakId,
        version: call.version,
      });
      const failure = failureOf(
        sent,
        { version: call.version, day: null },
        path,
      );
      if (failure !== null) return Result.err(failure);
      const answer = sent.answered ? recordOf(sent.data) : null;
      if (
        answer === null ||
        answer['kind'] !== 'withdrawn' ||
        versionOf(answer['version']) !== call.version
      ) {
        return Result.err(
          unusable(path, 'a withdrawal was answered for another version'),
        );
      }
      memo.invalidate();
      return Result.ok(undefined);
    },
  };
};
