import {
  ClientOperationId,
  LocalDate,
  PublishRequestId,
  Result,
  ServiceCategoryId,
  ServiceId,
  StreakDefinitionId,
  Tag,
  type UserId,
} from '@core/primitives';
import { StreakPublishError, StreakRuleField } from '@core/errors';
import {
  type Actor,
  StreakExcuse,
  StreakInterval,
  StreakIntervalRule,
  StreakOnBreak,
  StreakPublishCall,
  StreakQualifier,
  StreakQualifierRule,
  type StreakRuleInput,
  StreakTransition,
} from '@core/components';
import type { LogPorts } from '@core/ports';
import { StreakPublishSystem } from '@core/systems';
import {
  type PublishStreakDefinitionCommand,
  type PublishStreakDefinitionPorts,
  publishStreakDefinition,
  type WithdrawStreakDefinitionCommand,
  withdrawStreakDefinition,
} from '@core/pipelines';
import type { EdgeError } from '../edge';
import {
  callerActor,
  callerIsAdmin,
  callerUserId,
} from '../lib/booking/caller-roles';
import {
  field,
  isRecord,
  isStoreFailure,
  type Payload,
  type WireRequest,
} from './wire-read';

/**
 * THE STREAK PUBLISH'S WIRE (Phase 4a 4A-4) — flipped with the admin page's
 * gateway over `callableClient`: the request is the call component
 * `StreakPublishCall` (a publish: `{ requestId, streakId, baseVersion,
 * rule, streakTransition, previewHash }`, the rule FLAT) or
 * `StreakPublishCall.Withdraw` (`{ requestId, streakId, version }` — a call
 * that carries no `rule`); the answer `StreakPublishCall.Answer`.
 *
 * - **In:** the caller is judged off the VERIFIED token BEFORE the request is
 *   read (a stranger is told `CALLER_NOT_ADMIN`, never what was wrong with
 *   the asking); then the envelope, refused by name
 *   (`LOYALTY_STREAK_PUBLISH_INVALID_INPUT`, `{ field }`); the rule is read
 *   field by field in the rule's order — a value not of the wire's kind is
 *   the rule's `INVALID` at its flat field — and judged by the pipeline
 *   only after the head is admitted.
 * - **Out:** `{ streakPublishOutcome: 'PUBLISHED', version,
 *   effectiveFromLocalDate, streakRuleDirection }`,
 *   `{ streakPublishOutcome: 'WITHDRAWN', version }` or the ANSWERED refusal
 *   `{ streakPublishOutcome: 'REFUSED', errorCode, fields, earliest,
 *   effectiveFromLocalDate }` (`StreakPublishCall.refused`: the flat fields
 *   at fault, a `TOO_EARLY`'s two days). Nobody signed in is THROWN
 *   `unauthenticated`; a write that fell over is THROWN `internal`
 *   (`LOYALTY_STREAK_PUBLISH_STORE_FAILED`), its cause said in the log line
 *   `'rhythm rule write failed'` where alerting can find it and never in
 *   `details`.
 */

/** What the callable answers. */
export type StreakPublishAnswer = StreakPublishCall.Answer;

/**
 * A refusal or a failure → the answer (`Result.ok`, the page words it) or
 * the fault (`Result.err`, the edge throws it): the five rule refusals and
 * `CALLER_NOT_ADMIN` are ANSWERED (`REFUSED`); `CALLER_UNAUTHENTICATED` and
 * an envelope the callable cannot read are thrown as themselves; ANY
 * `RepositoryError` is logged — the struct's `reason` when it has one (a
 * rejected commit's `String(cause)`), else `errorCode path` (a taken
 * version number's `ALREADY_EXISTS`, F3-1 (c)) — and thrown as
 * `LOYALTY_STREAK_PUBLISH_STORE_FAILED`, the cause never in `details`.
 */
export function publishStreakRefusal(
  failure: StreakPublishError.Failure,
  ports: LogPorts,
): Result<StreakPublishAnswer, EdgeError> {
  if (isStoreFailure(failure)) {
    ports.log('error', 'rhythm rule write failed', {
      error: failure.reason ?? `${failure.errorCode} ${failure.path}`,
    });
    return Result.err(StreakPublishError.storeFailed());
  }
  return StreakPublishError.isAnswered(failure)
    ? Result.ok(StreakPublishCall.refused(failure))
    : Result.err(failure);
}

/** A pipeline's answer, as the wire carries it. */
function settleStreakAnswer<A>(
  result: Result<A, StreakPublishError.Failure>,
  encode: (answer: A) => StreakPublishAnswer,
  ports: LogPorts,
): Result<StreakPublishAnswer, EdgeError> {
  return result.ok
    ? Result.ok(encode(result.value))
    : publishStreakRefusal(result.error, ports);
}

/**
 * The callable, end to end: the request read in order
 * ({@link decodeStreakPublish} — the caller, then the envelope), the act's
 * pipeline run over the callable's ports, its answer or refusal on the
 * wire. `main.ts` hands it the streak ports (built on first use, so a
 * request refused at the door builds none) and the telemetry.
 */
export async function answerStreakPublish(
  request: WireRequest,
  ports: () => PublishStreakDefinitionPorts,
  telemetry: LogPorts,
): Promise<Result<StreakPublishAnswer, EdgeError>> {
  const asked = decodeStreakPublish(request);
  if (!asked.ok) return publishStreakRefusal(asked.error, telemetry);
  const ask = asked.value;
  return ask.streakPublishOp === StreakPublishOp.Withdraw
    ? settleStreakAnswer(
        await withdrawStreakDefinition(ports())(ask.withdraw),
        (receipt) => StreakPublishCall.withdrawn(receipt.version),
        telemetry,
      )
    : settleStreakAnswer(
        await publishStreakDefinition(ports())(ask.publish),
        StreakPublishCall.published,
        telemetry,
      );
}

// ── The caller ────────────────────────────────────────────────────────────

/** Who asks, off the VERIFIED token — the command's three flat root fields. */
export type StreakCaller = {
  readonly callerUserId: UserId | null;
  readonly callerIsAdmin: boolean;
  readonly callerActor: Actor | null;
};

/**
 * The caller: the uid; whether the claim holds one of the pair that manages
 * the shop (`callerIsAdmin` — access); and the actor the audit row names
 * (`callerActor`: `Actor.forCaller` over the token's roles — the owner as
 * `ADMIN`, the vendor's `sysadmin` and every other staff role as `STAFF`,
 * anyone else a `USER`). No uid is nobody.
 */
export function decodeStreakCaller(request: WireRequest): StreakCaller {
  const uid = callerUserId(request);
  return {
    callerUserId: uid,
    // Nobody is admin of nothing: a claim without a uid admits no one.
    callerIsAdmin: uid !== null && callerIsAdmin(request),
    callerActor: callerActor(request),
  };
}

// ── The request ───────────────────────────────────────────────────────────

/** Which act a request asks for — a publish carries a rule, a withdrawal names a version. */
export const StreakPublishOp = {
  Publish: 'PUBLISH',
  Withdraw: 'WITHDRAW',
} as const;
export type StreakPublishOp =
  (typeof StreakPublishOp)[keyof typeof StreakPublishOp];

/** A request read: the act and its pipeline's command. */
export type StreakPublishAsk =
  | {
      readonly streakPublishOp: typeof StreakPublishOp.Publish;
      readonly publish: PublishStreakDefinitionCommand;
    }
  | {
      readonly streakPublishOp: typeof StreakPublishOp.Withdraw;
      readonly withdraw: WithdrawStreakDefinitionCommand;
    };

/** A rule's id is a document id: a bounded, path-safe name. */
const STREAK_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A rule is some six hundred bytes; a list of a shop's every service adds a few thousand. */
const RULE_MAX_BYTES = 16_384;
const PREVIEW_HASH_MAX = 128;

const isWhole = (raw: unknown, min: number): raw is number =>
  typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= min;

function malformed(
  name: string,
): Result<never, StreakPublishError.InvalidInput> {
  return Result.err(StreakPublishError.invalidInput(name));
}

/** A dictionary's member ({@link Tag.has}, the one membership scan), or `null` for anything else. */
function wordOf<D extends Readonly<Record<string, string>>>(
  d: D,
  raw: unknown,
): Tag<D> | null {
  return Tag.has(d, raw) ? raw : null;
}

/**
 * The request in order: the caller first — somebody who may not change the
 * rule is told so (`CALLER_UNAUTHENTICATED` thrown, `CALLER_NOT_ADMIN`
 * answered), never what was wrong with their asking — then the envelope.
 */
export function decodeStreakPublish(
  request: WireRequest,
): Result<StreakPublishAsk, StreakPublishError.Failure> {
  const caller = decodeStreakCaller(request);
  const admitted = StreakPublishSystem.admitCaller(
    caller.callerUserId,
    caller.callerIsAdmin,
  );
  if (!admitted.ok) return admitted;
  return decodeStreakRequest(request.data, caller);
}

/**
 * The ENVELOPE, read and refused by name, field by field: the request,
 * `requestId`, `streakId`, then a withdrawal's `version` (≥ 1) — a call
 * that carries no `rule` — or a publish's `baseVersion` (≥ 0), `rule` (a
 * record of at most 16 384 JSON bytes), `streakTransition`, `previewHash`
 * (`null` is none; else non-empty, ≤ 128). The RULE is not refused here:
 * it is read into the rule's input (its own faults the rule's `INVALID`),
 * and a day that is no text reads as none (`''`), which no calendar holds.
 */
export function decodeStreakRequest(
  raw: unknown,
  caller: StreakCaller,
): Result<StreakPublishAsk, StreakPublishError.InvalidInput> {
  if (!isRecord(raw)) return malformed('request');
  const rawRequestId = field(raw, 'requestId');
  const requestId = ClientOperationId.is(rawRequestId)
    ? PublishRequestId.parse(rawRequestId)
    : null;
  if (requestId === null || !requestId.ok) return malformed('requestId');
  const rawStreakId = field(raw, 'streakId');
  const streakId =
    typeof rawStreakId === 'string' && STREAK_ID.test(rawStreakId)
      ? StreakDefinitionId.parse(rawStreakId)
      : null;
  if (streakId === null || !streakId.ok) return malformed('streakId');

  const rule = field(raw, 'rule');
  if (rule === undefined || rule === null) {
    const version = field(raw, 'version');
    if (!isWhole(version, 1)) return malformed('version');
    return Result.ok({
      streakPublishOp: StreakPublishOp.Withdraw,
      withdraw: {
        ...caller,
        requestId: requestId.value,
        streakId: streakId.value,
        version,
      },
    });
  }

  const baseVersion = field(raw, 'baseVersion');
  if (!isWhole(baseVersion, 0)) return malformed('baseVersion');
  if (!isRecord(rule) || JSON.stringify(rule).length > RULE_MAX_BYTES) {
    return malformed('rule');
  }
  const streakTransition = wordOf(
    StreakTransition,
    field(raw, 'streakTransition'),
  );
  if (streakTransition === null) return malformed('streakTransition');
  const previewHash = field(raw, 'previewHash') ?? null;
  if (
    previewHash !== null &&
    (typeof previewHash !== 'string' ||
      previewHash.length === 0 ||
      previewHash.length > PREVIEW_HASH_MAX)
  ) {
    return malformed('previewHash');
  }
  const asked = field(rule, 'effectiveFromLocalDate');
  const effectiveFrom = typeof asked === 'string' ? asked : '';

  return Result.ok({
    streakPublishOp: StreakPublishOp.Publish,
    publish: {
      ...caller,
      requestId: requestId.value,
      streakId: streakId.value,
      baseVersion,
      draft: decodeRule(rule, effectiveFrom),
      effectiveFrom,
      streakTransition,
      previewHash,
    },
  });
}

// ── The rule ──────────────────────────────────────────────────────────────

/**
 * Reads the FLAT rule in the rule's order and keeps the FIRST field that is
 * not of the wire's kind — its flat name (an entry's index dropped:
 * `excuses[2]` is a fault of `excuses`, the page keys a control, not an
 * entry). Every read after a fault answers a placeholder nobody sees.
 */
type RuleReader = { fault: string | null };

function faultAt(reader: RuleReader, name: string): void {
  reader.fault ??= name;
}

/** A whole number, `0` or more. */
function countAt(reader: RuleReader, rule: Payload, name: string): number {
  const value = field(rule, name);
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  faultAt(reader, name);
  return 0;
}

function switchAt(reader: RuleReader, rule: Payload, name: string): boolean {
  const value = field(rule, name);
  if (typeof value === 'boolean') return value;
  faultAt(reader, name);
  return false;
}

function wordAt<D extends Readonly<Record<string, string>>>(
  reader: RuleReader,
  rule: Payload,
  name: string,
  d: D,
  placeholder: Tag<D>,
): Tag<D> {
  const value = wordOf(d, field(rule, name));
  if (value !== null) return value;
  faultAt(reader, name);
  return placeholder;
}

/** A list of non-blank texts. */
function textsAt(
  reader: RuleReader,
  rule: Payload,
  name: string,
): readonly string[] {
  const value = field(rule, name);
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry: unknown) => typeof entry === 'string' && entry.trim().length > 0,
    )
  ) {
    faultAt(reader, name);
    return [];
  }
  return value as readonly string[];
}

function excusesAt(reader: RuleReader, rule: Payload): readonly StreakExcuse[] {
  const value = field(rule, StreakRuleField.Excuses);
  if (!Array.isArray(value)) {
    faultAt(reader, StreakRuleField.Excuses);
    return [];
  }
  const excuses: StreakExcuse[] = [];
  for (const entry of value as readonly unknown[]) {
    const excuse = wordOf(StreakExcuse, entry);
    if (excuse === null) {
      faultAt(reader, StreakRuleField.Excuses);
      return [];
    }
    excuses.push(excuse);
  }
  return excuses;
}

function qualifierAt(reader: RuleReader, rule: Payload): StreakQualifierRule {
  // A service or category the list names is a reference the rule's own door
  // (`StreakRule.parse`) judges — non-blank and listed once.
  switch (
    wordAt(
      reader,
      rule,
      StreakRuleField.QualifierKind,
      StreakQualifier,
      StreakQualifier.AnyVisit,
    )
  ) {
    case StreakQualifier.Services:
      return StreakQualifierRule.services(
        textsAt(reader, rule, StreakRuleField.QualifierServiceIds).map((id) =>
          ServiceId.of(id),
        ),
      );
    case StreakQualifier.Categories:
      return StreakQualifierRule.categories(
        textsAt(reader, rule, StreakRuleField.QualifierCategoryIds).map((id) =>
          ServiceCategoryId.of(id),
        ),
      );
    case StreakQualifier.AnyVisit:
      return StreakQualifierRule.anyVisit();
  }
}

function intervalAt(reader: RuleReader, rule: Payload): StreakIntervalRule {
  const kind = wordAt(
    reader,
    rule,
    StreakRuleField.IntervalKind,
    StreakInterval,
    StreakInterval.Fixed,
  );
  if (kind === StreakInterval.Fixed) {
    return StreakIntervalRule.fixed(
      countAt(reader, rule, StreakRuleField.IntervalDays),
    );
  }
  return StreakIntervalRule.personal(
    countAt(reader, rule, StreakRuleField.IntervalTolerancePct),
    countAt(reader, rule, StreakRuleField.IntervalMinDays),
    countAt(reader, rule, StreakRuleField.IntervalMaxDays),
    countAt(reader, rule, StreakRuleField.IntervalFallbackDays),
  );
}

/**
 * The flat rule → the rule's input, or `INVALID` at the first field that is
 * not of the wire's kind (a whole number of 0 or more, a boolean, a known
 * dictionary value, a list of non-blank texts or known excuses). The day
 * asked is read first, so a day that is no calendar day is
 * `effectiveFromLocalDate`'s fault before any other field's. Its own
 * `version` is sent and never read (`version: 0` is the placeholder the
 * pipeline numbers, `StreakPublishSystem.proposal`). What is wrong with a
 * rule of the right kinds (a figure out of range, a grace longer than the
 * interval) is `StreakRule.parse`'s to say, every field at once.
 */
export function decodeRule(
  rule: Payload,
  effectiveFrom: string,
): Result<StreakRuleInput, StreakPublishError.Invalid> {
  const reader: RuleReader = { fault: null };
  if (!LocalDate.parse(effectiveFrom).ok) {
    faultAt(reader, StreakRuleField.EffectiveFromLocalDate);
  }
  const enabled = switchAt(reader, rule, 'enabled');
  const qualifier = qualifierAt(reader, rule);
  const minGapDays = countAt(reader, rule, StreakRuleField.MinGapDays);
  const bookingHoldEnabled = switchAt(reader, rule, 'bookingHoldEnabled');
  const bookingHoldMaxDaysPastDue = countAt(
    reader,
    rule,
    StreakRuleField.BookingHoldMaxDaysPastDue,
  );
  const interval = intervalAt(reader, rule);
  const graceDays = countAt(reader, rule, StreakRuleField.GraceDays);
  const riskLeadDays = countAt(reader, rule, StreakRuleField.RiskLeadDays);
  const protectionsEnabled = switchAt(reader, rule, 'protectionsEnabled');
  const protectionsMaxBanked = countAt(
    reader,
    rule,
    StreakRuleField.ProtectionsMaxBanked,
  );
  const protectionsEarnEvery = countAt(
    reader,
    rule,
    StreakRuleField.ProtectionsEarnEvery,
  );
  const protectionsStartWith = countAt(
    reader,
    rule,
    StreakRuleField.ProtectionsStartWith,
  );
  const excuses = excusesAt(reader, rule);
  const clientPauseEnabled = switchAt(reader, rule, 'clientPauseEnabled');
  const clientPauseMaxDaysPerYear = countAt(
    reader,
    rule,
    StreakRuleField.ClientPauseMaxDaysPerYear,
  );
  const repairEnabled = switchAt(reader, rule, 'repairEnabled');
  const repairWindowDays = countAt(
    reader,
    rule,
    StreakRuleField.RepairWindowDays,
  );
  const repairPerYear = countAt(reader, rule, StreakRuleField.RepairPerYear);
  const onBreak = wordAt(
    reader,
    rule,
    StreakRuleField.OnBreak,
    StreakOnBreak,
    StreakOnBreak.Restart,
  );

  if (reader.fault !== null) {
    return Result.err(StreakPublishError.invalid([reader.fault]));
  }
  return Result.ok({
    version: 0,
    effectiveFromLocalDate: effectiveFrom,
    enabled,
    ...qualifier,
    minGapDays,
    bookingHoldEnabled,
    bookingHoldMaxDaysPastDue,
    ...interval,
    graceDays,
    riskLeadDays,
    protectionsEnabled,
    protectionsMaxBanked,
    protectionsEarnEvery,
    protectionsStartWith,
    excuses,
    clientPauseEnabled,
    clientPauseMaxDaysPerYear,
    repairEnabled,
    repairWindowDays,
    repairPerYear,
    onBreak,
  });
}
