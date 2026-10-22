import {
  Actor,
  StreakExcuse,
  StreakInterval,
  StreakIntervalRule,
  StreakOnBreak,
  type StreakPublishCall,
  StreakQualifier,
  StreakQualifierRule,
  StreakRuleDirection,
  type StreakRuleInput,
  StreakTransition,
} from '@core/components';
import {
  LocalDate,
  PublishRequestId,
  type RepositoryError,
  Result,
  ServiceCategoryId,
  ServiceId,
  StreakDefinitionId,
  StreakPublishError,
  StreakPublishErrorCode,
  StreakRuleField,
  UserId,
} from '@core/primitives';
import type { LogPorts } from '@core/ports';
import { StreakPublishSystem } from '@core/systems';
import {
  type PublishStreakDefinitionCommand,
  type PublishStreakDefinitionPorts,
  publishStreakDefinition,
  type StreakWithdrawReceipt,
  type WithdrawStreakDefinitionCommand,
  withdrawStreakDefinition,
} from '@core/pipelines';
import { isClientOperationId } from '@creativo/application/booking';
import { type EdgeError, LegacyWireCode } from '../edge';
import { callerActor, callerIsAdmin } from '../lib/booking/caller-roles';
import type { WireRequest } from './booking.wire';

/**
 * THE STREAK PUBLISH'S WIRE (loyalty flip (3), F3-3) — frozen in both
 * directions until Phase 4 flips it with `callableClient`. The admin page's
 * request and every refusal word stay byte-identical:
 *
 * - **In:** `{ op?: 'publish' | 'withdraw', requestId, streakId,
 *   baseVersion, draft, effectiveFrom, transition, previewHash? }` or
 *   `{ op: 'withdraw', requestId, streakId, version }`. The caller is judged
 *   off the VERIFIED token BEFORE the request is read (a stranger is told
 *   `notAdmin`, never what was wrong with the asking); then the envelope,
 *   refused by name (`loyalty.streak_publish.invalid_input`, `{ field }`);
 *   the draft is today's NESTED legacy rule, read here field by field in the
 *   legacy reader's order — a value not of the wire's kind is the rule's
 *   `invalid` at its dotted locator — and judged by the pipeline only after
 *   the head is admitted.
 * - **Out:** `{ kind: 'published', version, effectiveFrom, direction }`,
 *   `{ kind: 'withdrawn', version }` or the ANSWERED refusal
 *   `{ kind: 'refused', code, fields, earliest? }` in the page's six words,
 *   every field at fault spelt as the legacy rule spells it
 *   (`interval.days`, `scheduled.effectiveFrom`). Nobody signed in is
 *   THROWN `unauthenticated`; a write that fell over is THROWN `internal`
 *   (`loyalty.streak_publish.store_failed`), its cause said in the log line
 *   `'rhythm rule write failed'` where alerting can find it and never in
 *   `details`.
 */

// ── The vocabulary, both ways ─────────────────────────────────────────────

/** A wire word → its dictionary value — the ONE table each vocabulary the draft speaks has. */
function wireTable<K extends string>(
  pairs: readonly (readonly [K, string])[],
): { readonly of: (word: unknown) => K | null } {
  const values = new Map<unknown, K>(
    pairs.map(([value, word]) => [word, value]),
  );
  return { of: (word) => values.get(word) ?? null };
}

const QUALIFIER_KIND = wireTable<StreakQualifier>([
  [StreakQualifier.AnyVisit, 'anyVisit'],
  [StreakQualifier.Services, 'services'],
  [StreakQualifier.Categories, 'categories'],
]);

const INTERVAL_KIND = wireTable<StreakInterval>([
  [StreakInterval.Fixed, 'fixed'],
  [StreakInterval.Personal, 'personal'],
]);

const EXCUSE = wireTable<StreakExcuse>([
  [StreakExcuse.ShopClosure, 'shopClosure'],
  [StreakExcuse.BarberAbsence, 'barberAbsence'],
  [StreakExcuse.StaffCancelled, 'staffCancelled'],
  [StreakExcuse.ClosedDays, 'closedDays'],
]);

const ON_BREAK = wireTable<StreakOnBreak>([
  [StreakOnBreak.Restart, 'restart'],
  [StreakOnBreak.Hold, 'hold'],
]);

const TRANSITION = wireTable<StreakTransition>([
  [StreakTransition.Grandfather, 'grandfather'],
  [StreakTransition.Recompute, 'recompute'],
]);

/** Whom a change favours, in the words the answer has always carried. */
const WIRE_DIRECTION = {
  [StreakRuleDirection.Looser]: 'looser',
  [StreakRuleDirection.Stricter]: 'stricter',
  [StreakRuleDirection.Mixed]: 'mixed',
  [StreakRuleDirection.Neutral]: 'neutral',
  [StreakRuleDirection.Switch]: 'switch',
} as const satisfies Record<StreakRuleDirection, string>;

/**
 * A field at fault as the callable has always spelt it: the legacy rule's
 * dotted locator (`interval.days`, `scheduled.effectiveFrom`), never the
 * flat field the system names (`intervalDays`,
 * `scheduledEffectiveFromLocalDate`).
 */
const LEGACY_FIELD = {
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

const LEGACY_FIELD_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(LEGACY_FIELD),
);

// ── The answers ───────────────────────────────────────────────────────────

/** The six words of the page's refusals. */
export type StreakWireRefusal =
  | 'notAdmin'
  | 'invalid'
  | 'stale'
  | 'tooEarly'
  | 'recomputeNeedsEngine'
  | 'previewStale';

/** What the callable answers, key for key (F3-3). */
export type StreakPublishAnswer =
  | {
      readonly kind: 'published';
      readonly version: number;
      readonly effectiveFrom: string;
      readonly direction: (typeof WIRE_DIRECTION)[StreakRuleDirection];
    }
  | { readonly kind: 'withdrawn'; readonly version: number }
  | {
      readonly kind: 'refused';
      readonly code: StreakWireRefusal;
      readonly fields: readonly string[];
      /** Only a day too early names the first day the change may start. */
      readonly earliest?: string;
    };

export function encodeStreakPublishAnswer(
  receipt: StreakPublishCall.Receipt,
): StreakPublishAnswer {
  return {
    kind: 'published',
    version: receipt.version,
    effectiveFrom: receipt.effectiveFromLocalDate,
    direction: WIRE_DIRECTION[receipt.streakRuleDirection],
  };
}

export function encodeStreakWithdrawAnswer(
  receipt: StreakWithdrawReceipt,
): StreakPublishAnswer {
  return { kind: 'withdrawn', version: receipt.version };
}

/** A part of the ENVELOPE that is missing or of the wrong kind — thrown, never answered. */
export type StreakEnvelopeRefusal = {
  readonly code: typeof LegacyWireCode.StreakPublishInvalidInput;
  readonly field: string;
};

/** Every way a request is not written. */
export type StreakPublishFailure =
  StreakPublishError | RepositoryError | StreakEnvelopeRefusal;

function refused(
  code: StreakWireRefusal,
  fields: readonly string[],
): StreakPublishAnswer {
  return { kind: 'refused', code, fields };
}

/** The flat fields at fault → today's locators, each once (a field the table does not know kept as written). */
function legacyFields(fields: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const field of fields) {
    const locator = LEGACY_FIELD_OF.get(field) ?? field;
    if (!out.includes(locator)) out.push(locator);
  }
  return out;
}

/**
 * A refusal or a failure → today's answer (`Result.ok`, the page words it)
 * or today's fault (`Result.err`, the edge throws it), by F3-3's table:
 * the five rule refusals and `CALLER_NOT_ADMIN` are ANSWERED (a day too
 * early with `fields: ['effectiveFrom']` and its `earliest`, the others
 * with their fields or none); `CALLER_UNAUTHENTICATED` is today's thrown
 * `loyalty.streak_publish.unauthenticated`; an envelope refusal is thrown
 * as it is; ANY `RepositoryError` is logged — the struct's `reason` when it
 * has one (a rejected commit's `String(cause)`), else `errorCode path` (a
 * taken version number's `ALREADY_EXISTS`, F3-1 (c)) — and thrown as
 * `loyalty.streak_publish.store_failed`, the cause never in `details`.
 */
export function publishStreakRefusal(
  failure: StreakPublishFailure,
  ports: LogPorts,
): Result<StreakPublishAnswer, EdgeError> {
  if ('code' in failure) return Result.err(failure);
  if ('path' in failure) {
    ports.log('error', 'rhythm rule write failed', {
      error: failure.reason ?? `${failure.errorCode} ${failure.path}`,
    });
    return Result.err({ code: LegacyWireCode.StreakPublishStoreFailed });
  }
  switch (failure.errorCode) {
    case StreakPublishErrorCode.CallerUnauthenticated:
      return Result.err({ code: LegacyWireCode.StreakPublishUnauthenticated });
    case StreakPublishErrorCode.CallerNotAdmin:
      return Result.ok(refused('notAdmin', []));
    case StreakPublishErrorCode.Invalid:
      return Result.ok(refused('invalid', legacyFields(failure.fields)));
    case StreakPublishErrorCode.TooEarly:
      return Result.ok({
        kind: 'refused',
        code: 'tooEarly',
        fields: ['effectiveFrom'],
        earliest: failure.earliest,
      });
    case StreakPublishErrorCode.Stale:
      return Result.ok(refused('stale', []));
    case StreakPublishErrorCode.RecomputeNeedsEngine:
      return Result.ok(refused('recomputeNeedsEngine', []));
    case StreakPublishErrorCode.PreviewStale:
      return Result.ok(refused('previewStale', []));
  }
}

/** A pipeline's answer, as the wire carries it. */
function settleStreakAnswer<A>(
  result: Result<A, StreakPublishFailure>,
  encode: (answer: A) => StreakPublishAnswer,
  ports: LogPorts,
): Result<StreakPublishAnswer, EdgeError> {
  return result.ok
    ? Result.ok(encode(result.value))
    : publishStreakRefusal(result.error, ports);
}

/**
 * The callable, end to end: the request read in today's order
 * ({@link decodeStreakPublish} — the caller, then the envelope), the act's
 * pipeline run over the callable's ports, its answer or refusal in today's
 * words. `main.ts` hands it the streak ports (built on first use, so a
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
        encodeStreakWithdrawAnswer,
        telemetry,
      )
    : settleStreakAnswer(
        await publishStreakDefinition(ports())(ask.publish),
        encodeStreakPublishAnswer,
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

const NOBODY: StreakCaller = {
  callerUserId: null,
  callerIsAdmin: false,
  callerActor: null,
};

/**
 * The caller as today's handler read it (`toCaller` + the use case's
 * `auditActorOf`): the uid; whether the claim holds one of the pair that
 * manages the shop (`callerIsAdmin` — access); and the actor the audit row
 * names — the legacy actor's kind (`callerActor`) as claims for
 * `Actor.forCaller`: the owner as `ADMIN`, the vendor's `sysadmin` and
 * every other staff role as `STAFF` with that snapshot, anyone else a
 * `USER`. No uid (or one no actor names) is nobody.
 */
export function decodeStreakCaller(request: WireRequest): StreakCaller {
  const token = request.auth ?? null;
  const verified = token === null ? {} : { auth: token };
  const uid = UserId.parse(token?.uid ?? '');
  const legacy = callerActor(verified);
  if (!uid.ok || legacy === null) return NOBODY;
  const claims =
    legacy.kind === 'admin'
      ? ['admin']
      : legacy.kind === 'staff'
        ? legacy.roles
        : [];
  return {
    callerUserId: uid.value,
    callerIsAdmin: callerIsAdmin(verified),
    callerActor: Actor.forCaller(uid.value, claims),
  };
}

// ── The request ───────────────────────────────────────────────────────────

/** Which act a request asks for — the wire's `op`. */
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

type Payload = Readonly<Record<string, unknown>>;

/** A rule's id is a document id: a bounded, path-safe name. */
const STREAK_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A rule is some six hundred bytes; a list of a shop's every service adds a few thousand. */
const DRAFT_MAX_BYTES = 16_384;
const PREVIEW_HASH_MAX = 128;

function isRecord(raw: unknown): raw is Payload {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
}

/** A field of an untrusted object by name — no dynamic index. */
function fieldOf(source: unknown, name: string): unknown {
  return isRecord(source)
    ? Object.getOwnPropertyDescriptor(source, name)?.value
    : undefined;
}

const isWhole = (raw: unknown, min: number): raw is number =>
  typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= min;

function malformed(field: string): Result<never, StreakEnvelopeRefusal> {
  return Result.err({ code: LegacyWireCode.StreakPublishInvalidInput, field });
}

/**
 * The request in today's order: the caller first — somebody who may not
 * change the rule is told so (`CALLER_UNAUTHENTICATED` thrown,
 * `CALLER_NOT_ADMIN` answered), never what was wrong with their asking —
 * then the envelope.
 */
export function decodeStreakPublish(
  request: WireRequest,
): Result<StreakPublishAsk, StreakPublishFailure> {
  const caller = decodeStreakCaller(request);
  const admitted = StreakPublishSystem.admitCaller(
    caller.callerUserId,
    caller.callerIsAdmin,
  );
  if (!admitted.ok) return admitted;
  return decodeStreakRequest(request.data, caller);
}

/**
 * The ENVELOPE, read and refused by name (today's `toRequest`, field by
 * field): `request`, `op` (absent or `null` is a publish), `requestId`,
 * `streakId`, then a withdrawal's `version` (≥ 1) or a publish's
 * `baseVersion` (≥ 0), `draft` (a record of at most 16 384 JSON bytes),
 * `transition`, `previewHash` (absent is none; else non-empty, ≤ 128). The
 * RULE is not refused here: the draft is read into the rule's input (its
 * own faults the rule's `invalid`), and a day that is no text reads as
 * none (`''`), which no calendar holds.
 */
export function decodeStreakRequest(
  raw: unknown,
  caller: StreakCaller,
): Result<StreakPublishAsk, StreakEnvelopeRefusal> {
  if (!isRecord(raw)) return malformed('request');
  const op = fieldOf(raw, 'op') ?? 'publish';
  if (op !== 'publish' && op !== 'withdraw') return malformed('op');
  const rawRequestId = fieldOf(raw, 'requestId');
  const requestId = isClientOperationId(rawRequestId)
    ? PublishRequestId.parse(rawRequestId)
    : null;
  if (requestId === null || !requestId.ok) return malformed('requestId');
  const rawStreakId = fieldOf(raw, 'streakId');
  const streakId =
    typeof rawStreakId === 'string' && STREAK_ID.test(rawStreakId)
      ? StreakDefinitionId.parse(rawStreakId)
      : null;
  if (streakId === null || !streakId.ok) return malformed('streakId');

  if (op === 'withdraw') {
    const version = fieldOf(raw, 'version');
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

  const baseVersion = fieldOf(raw, 'baseVersion');
  if (!isWhole(baseVersion, 0)) return malformed('baseVersion');
  const draft = fieldOf(raw, 'draft');
  if (!isRecord(draft) || JSON.stringify(draft).length > DRAFT_MAX_BYTES) {
    return malformed('draft');
  }
  const streakTransition = TRANSITION.of(fieldOf(raw, 'transition'));
  if (streakTransition === null) return malformed('transition');
  const previewHash = fieldOf(raw, 'previewHash') ?? null;
  if (
    previewHash !== null &&
    (typeof previewHash !== 'string' ||
      previewHash.length === 0 ||
      previewHash.length > PREVIEW_HASH_MAX)
  ) {
    return malformed('previewHash');
  }
  const asked = fieldOf(raw, 'effectiveFrom');
  const effectiveFrom = typeof asked === 'string' ? asked : '';

  return Result.ok({
    streakPublishOp: StreakPublishOp.Publish,
    publish: {
      ...caller,
      requestId: requestId.value,
      streakId: streakId.value,
      baseVersion,
      draft: decodeDraft(draft, effectiveFrom),
      effectiveFrom,
      streakTransition,
      previewHash,
    },
  });
}

// ── The draft ─────────────────────────────────────────────────────────────

/**
 * Reads the nested legacy draft in the legacy reader's order (the deleted
 * head reader over `{ ...draft, version, effectiveFrom }`)
 * and keeps the FIRST field that is not of the wire's kind — its dotted
 * locator, an entry's index dropped (`excuses[2]` is a fault of `excuses`:
 * the page keys a control, not an entry). Every read after a fault answers
 * a placeholder nobody sees.
 */
type DraftReader = { fault: string | null };

function faultAt(reader: DraftReader, path: string): void {
  reader.fault ??= path;
}

/** A part of the rule: an object, else the part's own fault. */
function partAt(reader: DraftReader, source: unknown, key: string): Payload {
  const part = fieldOf(source, key);
  if (isRecord(part)) return part;
  faultAt(reader, key);
  return {};
}

/** A whole number, `0` or more. */
function countAt(
  reader: DraftReader,
  source: unknown,
  key: string,
  path: string,
): number {
  const value = fieldOf(source, key);
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  faultAt(reader, path);
  return 0;
}

function switchAt(
  reader: DraftReader,
  source: unknown,
  key: string,
  path: string,
): boolean {
  const value = fieldOf(source, key);
  if (typeof value === 'boolean') return value;
  faultAt(reader, path);
  return false;
}

function wordAt<K extends string>(
  reader: DraftReader,
  source: unknown,
  key: string,
  path: string,
  table: { readonly of: (word: unknown) => K | null },
  placeholder: K,
): K {
  const value = table.of(fieldOf(source, key));
  if (value !== null) return value;
  faultAt(reader, path);
  return placeholder;
}

/** A list of non-blank texts. */
function textsAt(
  reader: DraftReader,
  source: unknown,
  key: string,
  path: string,
): readonly string[] {
  const value = fieldOf(source, key);
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry: unknown) => typeof entry === 'string' && entry.trim().length > 0,
    )
  ) {
    faultAt(reader, path);
    return [];
  }
  return value as readonly string[];
}

function excusesAt(
  reader: DraftReader,
  source: unknown,
): readonly StreakExcuse[] {
  const value = fieldOf(source, 'excuses');
  const excuses: StreakExcuse[] = [];
  if (!Array.isArray(value)) {
    faultAt(reader, 'excuses');
    return excuses;
  }
  for (const entry of value as readonly unknown[]) {
    const excuse = EXCUSE.of(entry);
    if (excuse === null) {
      faultAt(reader, 'excuses');
      return [];
    }
    excuses.push(excuse);
  }
  return excuses;
}

function qualifierAt(reader: DraftReader, draft: Payload): StreakQualifierRule {
  const part = partAt(reader, draft, 'qualifier');
  // A service or category the list names is a reference the rule's own door
  // (`StreakRule.parse`) judges — non-blank and listed once, as today.
  switch (
    wordAt(
      reader,
      part,
      'kind',
      'qualifier.kind',
      QUALIFIER_KIND,
      StreakQualifier.AnyVisit,
    )
  ) {
    case StreakQualifier.Services:
      return StreakQualifierRule.services(
        textsAt(reader, part, 'serviceIds', 'qualifier.serviceIds').map((id) =>
          ServiceId.of(id),
        ),
      );
    case StreakQualifier.Categories:
      return StreakQualifierRule.categories(
        textsAt(reader, part, 'categoryIds', 'qualifier.categoryIds').map(
          (id) => ServiceCategoryId.of(id),
        ),
      );
    case StreakQualifier.AnyVisit:
      return StreakQualifierRule.anyVisit();
  }
}

function intervalAt(reader: DraftReader, draft: Payload): StreakIntervalRule {
  const part = partAt(reader, draft, 'interval');
  const kind = wordAt(
    reader,
    part,
    'kind',
    'interval.kind',
    INTERVAL_KIND,
    StreakInterval.Fixed,
  );
  if (kind === StreakInterval.Fixed) {
    return StreakIntervalRule.fixed(
      countAt(reader, part, 'days', 'interval.days'),
    );
  }
  return StreakIntervalRule.personal(
    countAt(reader, part, 'tolerancePct', 'interval.tolerancePct'),
    countAt(reader, part, 'minDays', 'interval.minDays'),
    countAt(reader, part, 'maxDays', 'interval.maxDays'),
    countAt(reader, part, 'fallbackDays', 'interval.fallbackDays'),
  );
}

/**
 * The nested legacy draft → the flat rule input, or `INVALID` at the first
 * field that is not of the wire's kind (the legacy reader's type checks:
 * a whole number of 0 or more, a boolean, a known word, an object for a
 * part, a list of non-blank texts or known excuses). The day asked is read
 * where the legacy reader read it — second, after the version the writer
 * numbers — so a day that is no calendar day is `effectiveFrom`'s fault
 * before any part of the draft is. Its own `version` and `effectiveFrom`
 * are sent and never read; `version: 0` is the placeholder the pipeline
 * numbers (`StreakPublishSystem.proposal`). What is wrong with a rule of
 * the right kinds (a figure out of range, a grace longer than the interval)
 * is `StreakRule.parse`'s to say, every field at once.
 */
export function decodeDraft(
  draft: Payload,
  effectiveFrom: string,
): Result<StreakRuleInput, StreakPublishError.Invalid> {
  const reader: DraftReader = { fault: null };
  if (!LocalDate.parse(effectiveFrom).ok) faultAt(reader, 'effectiveFrom');
  const enabled = switchAt(reader, draft, 'enabled', 'enabled');
  const qualifier = qualifierAt(reader, draft);
  const minGapDays = countAt(reader, draft, 'minGapDays', 'minGapDays');
  const hold = partAt(reader, draft, 'bookingHold');
  const bookingHoldEnabled = switchAt(
    reader,
    hold,
    'enabled',
    'bookingHold.enabled',
  );
  const bookingHoldMaxDaysPastDue = countAt(
    reader,
    hold,
    'maxDaysPastDue',
    'bookingHold.maxDaysPastDue',
  );
  const interval = intervalAt(reader, draft);
  const graceDays = countAt(reader, draft, 'graceDays', 'graceDays');
  const riskLeadDays = countAt(reader, draft, 'riskLeadDays', 'riskLeadDays');
  const reserve = partAt(reader, draft, 'protections');
  const protectionsEnabled = switchAt(
    reader,
    reserve,
    'enabled',
    'protections.enabled',
  );
  const protectionsMaxBanked = countAt(
    reader,
    reserve,
    'maxBanked',
    'protections.maxBanked',
  );
  const protectionsEarnEvery = countAt(
    reader,
    reserve,
    'earnEvery',
    'protections.earnEvery',
  );
  const protectionsStartWith = countAt(
    reader,
    reserve,
    'startWith',
    'protections.startWith',
  );
  const excuses = excusesAt(reader, draft);
  const pause = partAt(reader, draft, 'clientPause');
  const clientPauseEnabled = switchAt(
    reader,
    pause,
    'enabled',
    'clientPause.enabled',
  );
  const clientPauseMaxDaysPerYear = countAt(
    reader,
    pause,
    'maxDaysPerYear',
    'clientPause.maxDaysPerYear',
  );
  const repair = partAt(reader, draft, 'repair');
  const repairEnabled = switchAt(reader, repair, 'enabled', 'repair.enabled');
  const repairWindowDays = countAt(
    reader,
    repair,
    'windowDays',
    'repair.windowDays',
  );
  const repairPerYear = countAt(reader, repair, 'perYear', 'repair.perYear');
  const onBreak = wordAt(
    reader,
    draft,
    'onBreak',
    'onBreak',
    ON_BREAK,
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
