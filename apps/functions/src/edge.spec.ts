import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { type CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import {
  AccountsError,
  BarberId,
  BookingError,
  BookingStatus,
  Callables,
  type CancellationRefusal,
  CancellationRefusalCode,
  CarriedSeatRefusal,
  EndMinute,
  IdentityError,
  type MoveCarriedSeatUnplaceable,
  MinuteCount,
  MoveErrorCode,
  PrimitiveErrorCode,
  Result,
  SchedulingErrorCode,
  SeatId,
  ShopUnavailableReason,
  StaffEditError,
  StaffEditErrorCode,
  StreakPublishError,
  StreakPublishErrorCode,
  type TelemetryPorts,
  LocalDate,
  MinuteOfDay,
  TimeError,
  TimeErrorCode,
  UtcEpochMs,
  WaitlistError,
  WallTime,
  WorkBudgetSystem,
  ZonedTimeSystem,
} from '@creativo/ecs-core';
import {
  EDGE_DICTIONARIES,
  EDGE_WIRE,
  type EdgeError,
  HttpsStatus,
  LEGACY_WIRE_CODE,
  LegacyWireCode,
  errorCodeOf,
  PLATFORM_TIMEOUT_SECONDS,
  WIRE_ZONE,
  WireShape,
  callableEdge,
  isAnswered,
  legacyCallable,
  retryingTrigger,
  toHttpsError,
  wallIso,
  wireDetails,
  wireParamsOf,
  wireRuleOf,
  workBudget,
} from './edge';

/** A literal instant as the brand — specs only. */
function utc(ms: number): UtcEpochMs {
  const instant = UtcEpochMs.of(ms);
  if (!instant.ok) throw new Error(`a broken fixture: ${ms}`);
  return instant.value;
}

/** A branded literal — a bad one is a broken fixture. */
function sure<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false },
): T {
  if (!result.ok) throw new Error('a broken fixture');
  return result.value;
}
const day = (raw: string): LocalDate => sure(LocalDate.parse(raw));
const at = (minute: number): MinuteOfDay => sure(MinuteOfDay.of(minute));
const until = (minute: number): EndMinute => sure(EndMinute.of(minute));
const IVAN = BarberId.of('b_ivan');

const SRC = resolve(__dirname);
const ECS_CORE = resolve(__dirname, '../../../libs/ecs-core/src');

const ALL_CODES: readonly string[] = Object.values(EDGE_DICTIONARIES).flatMap(
  (dictionary) => Object.values(dictionary),
);

/**
 * The rule a WIRE code leaves by — today's handlers name the dotted wire
 * code, the table is keyed by the ecs-core `errorCode` (F-10).
 */
const RULE_BY_WIRE_CODE = new Map(
  Object.values(EDGE_WIRE).map((rule) => [rule.wireCode, rule] as const),
);

/** The answer `toHttpsError` gives, as plain data. */
function wire(error: EdgeError) {
  const thrown = toHttpsError(error);
  return {
    status: thrown.code,
    message: thrown.message,
    details: thrown.details,
  };
}

// ── Today's handlers, read from their source ──────────────────────────────

function tsFiles(dir: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- this workspace's own sources, found by listing them.
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this workspace's own sources, found by listing them.
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}

function isHttpsErrorNew(node: ts.Node): node is ts.NewExpression {
  return ts.isNewExpression(node) && node.expression.getText() === 'HttpsError';
}

function literalStatus(node: ts.NewExpression): string | null {
  const first = node.arguments?.[0];
  return first !== undefined && ts.isStringLiteral(first) ? first.text : null;
}

function literalDetailsCode(node: ts.NewExpression): string | null {
  const details = node.arguments?.[2];
  if (details === undefined || !ts.isObjectLiteralExpression(details)) {
    return null;
  }
  for (const property of details.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      property.name.getText() === 'code' &&
      ts.isStringLiteral(property.initializer)
    ) {
      return property.initializer.text;
    }
  }
  return null;
}

function firstHttpsError(node: ts.Node): ts.NewExpression | null {
  if (isHttpsErrorNew(node)) return node;
  return ts.forEachChild(node, firstHttpsError) ?? null;
}

type ThrowSite = {
  readonly code: string;
  readonly status: string;
  readonly at: string;
};

/**
 * Every (code, status) pair today's handlers put on the wire: the inline
 * `new HttpsError('status', …, { code: '…' })` throws, the `switch
 * (error.code)` mappers (case labels falling through to one `new
 * HttpsError`) and the `if (error.code === '…')` mapper.
 */
function todaysThrowSites(): readonly ThrowSite[] {
  const sites: ThrowSite[] = [];
  for (const file of [
    ...tsFiles(join(SRC, 'lib')),
    ...tsFiles(join(SRC, 'use-cases')),
  ]) {
    const source = parse(file);
    const at = (node: ts.Node): string =>
      `${relative(SRC, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const add = (code: string, thrown: ts.NewExpression): void => {
      const status = literalStatus(thrown);
      if (status !== null) sites.push({ code, status, at: at(thrown) });
    };
    const visit = (node: ts.Node): void => {
      if (isHttpsErrorNew(node)) {
        const code = literalDetailsCode(node);
        if (code !== null) add(code, node);
      }
      if (
        ts.isSwitchStatement(node) &&
        node.expression.getText().endsWith('.code')
      ) {
        let labels: string[] = [];
        for (const clause of node.caseBlock.clauses) {
          if (ts.isDefaultClause(clause)) {
            labels = [];
            continue;
          }
          if (ts.isStringLiteral(clause.expression)) {
            labels.push(clause.expression.text);
          }
          if (clause.statements.length === 0) continue;
          const thrown = firstHttpsError(clause);
          if (thrown !== null) for (const code of labels) add(code, thrown);
          labels = [];
        }
      }
      if (
        ts.isIfStatement(node) &&
        ts.isBinaryExpression(node.expression) &&
        node.expression.operatorToken.kind ===
          ts.SyntaxKind.EqualsEqualsEqualsToken &&
        node.expression.left.getText().endsWith('.code') &&
        ts.isStringLiteral(node.expression.right)
      ) {
        const thrown = firstHttpsError(node.thenStatement);
        if (thrown !== null) add(node.expression.right.text, thrown);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sites;
}

/** Every `readonly code = '…' as const` of the use-case error classes the handlers throw. */
function todaysErrorClassCodes(): readonly {
  readonly code: string;
  readonly at: string;
}[] {
  const codes: { code: string; at: string }[] = [];
  for (const file of tsFiles(join(SRC, 'use-cases')).filter((f) =>
    f.endsWith('.errors.ts'),
  )) {
    const source = parse(file);
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyDeclaration(node) &&
        node.name.getText() === 'code' &&
        node.initializer !== undefined
      ) {
        const init = ts.isAsExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer;
        if (ts.isStringLiteral(init)) {
          codes.push({ code: init.text, at: relative(SRC, file) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return codes;
}

/** The error dictionaries ecs-core declares (`…ErrorCode` / `…RefusalCode`). */
function ecsErrorDictionaryNames(): readonly string[] {
  const names = new Set<string>();
  for (const file of [
    ...tsFiles(join(ECS_CORE, 'components')),
    ...tsFiles(join(ECS_CORE, 'primitives')),
    ...tsFiles(join(ECS_CORE, 'systems')),
  ]) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ecs-core's own sources, found by listing them.
    for (const match of readFileSync(file, 'utf8').matchAll(
      /export const (\w+(?:ErrorCode|RefusalCode)) = \{/g,
    )) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return [...names].sort();
}

/** Codes the callables RETURN today (`{ kind: 'refused', … }`) — never thrown. */
const ANSWERED_TODAY: ReadonlySet<string> = new Set([
  ...Object.values(StreakPublishErrorCode),
  LegacyWireCode.StreakPublishNotAdmin,
]);

/** The same, as the WIRE codes today's error classes carry. */
const ANSWERED_TODAY_ON_THE_WIRE: ReadonlySet<string> = new Set(
  [...ANSWERED_TODAY].map((code) => wireRuleOf(code).wireCode),
);

describe('edge — the wire table', () => {
  describe('totality', () => {
    it('maps every code of every covered dictionary to a rule an HttpsError can be built from', () => {
      expect(ALL_CODES.length).toBeGreaterThan(250);
      for (const code of ALL_CODES) {
        expect(Object.hasOwn(EDGE_WIRE, code), code).toBe(true);
        const rule = wireRuleOf(code);
        if (rule.wireShape === WireShape.Answered) continue;
        expect(Object.values(HttpsStatus), code).toContain(rule.httpsStatus);
        expect(() => toHttpsError({ code } as EdgeError)).not.toThrow();
      }
    });

    it('holds exactly one rule per code — no code is spelled by two dictionaries, no wire code by two rules', () => {
      expect(new Set(ALL_CODES).size).toBe(ALL_CODES.length);
      expect(Object.keys(EDGE_WIRE).sort()).toEqual([...ALL_CODES].sort());
      expect(RULE_BY_WIRE_CODE.size).toBe(ALL_CODES.length);
    });

    it('covers every error dictionary ecs-core declares', () => {
      const declared = ecsErrorDictionaryNames();
      expect(declared.length).toBeGreaterThanOrEqual(19);
      expect(Object.keys(EDGE_DICTIONARIES)).toEqual(
        expect.arrayContaining([...declared]),
      );
    });

    it('answers — never throws — exactly the streak publish’s refusals', () => {
      expect(Object.keys(EDGE_WIRE).filter(isAnswered).sort()).toEqual(
        [...ANSWERED_TODAY].sort(),
      );
    });
  });

  describe('today’s statuses, read from today’s handlers', () => {
    it('gives every code a handler throws the status that handler throws it with', () => {
      const sites = todaysThrowSites();
      // The scanner itself must see the handlers — 80 sites on 2026-10-10
      // (the inline throws with literal details, and every mapper case) —
      // so a broken scan can never pass by finding nothing. Each 3b flip
      // deletes handlers and lowers this floor in the same commit.
      expect(sites.length).toBeGreaterThanOrEqual(80);
      for (const site of sites) {
        const rule = RULE_BY_WIRE_CODE.get(site.code);
        expect(rule, site.at).toBeDefined();
        if (rule === undefined) continue;
        expect(rule.wireShape, `${site.code} at ${site.at}`).not.toBe(
          WireShape.Answered,
        );
        if (rule.wireShape !== WireShape.Answered) {
          expect(rule.httpsStatus, `${site.code} at ${site.at}`).toBe(
            site.status,
          );
        }
      }
    });

    it('maps every use-case error class code; one no mapper names keeps its mapper’s `default:` internal', () => {
      const named = new Set(todaysThrowSites().map((site) => site.code));
      const classes = todaysErrorClassCodes();
      expect(classes.length).toBeGreaterThan(50);
      // `toHttpsError` in lib/otp/request-otp.ts answers the aggregate by
      // `instanceof`, before its switch.
      const outsideASwitch = new Map<string, string>([
        [LegacyWireCode.OtpValidationFailed, HttpsStatus.InvalidArgument],
      ]);
      for (const { code, at } of classes) {
        const rule = RULE_BY_WIRE_CODE.get(code);
        expect(rule, `${code} (${at})`).toBeDefined();
        if (rule === undefined || named.has(code)) continue;
        if (ANSWERED_TODAY_ON_THE_WIRE.has(code)) {
          expect(rule.wireShape, code).toBe(WireShape.Answered);
          continue;
        }
        expect(
          rule.wireShape === WireShape.Answered ? null : rule.httpsStatus,
          code,
        ).toBe(outsideASwitch.get(code) ?? HttpsStatus.Internal);
      }
    });
  });

  describe('details — today’s exact shapes', () => {
    it('`{ code, params }` with today’s stringified figures', () => {
      expect(wire(BookingError.tooSoon(sure(MinuteCount.of(30))))).toEqual({
        status: 'failed-precondition',
        message: 'booking.commit.too_soon',
        details: {
          code: 'booking.commit.too_soon',
          params: { minLeadMinutes: '30' },
        },
      });
      expect(wireDetails(BookingError.partyTooLarge(4))).toEqual({
        code: 'booking.commit.party_too_large',
        params: { maxPartySize: '4' },
      });
      expect(wire(WaitlistError.tooManyDays(7)).details).toEqual({
        code: 'booking.waitlist.too_many_days',
        params: { max: '7' },
      });
    });

    it('`params: {}` for a refusal with nothing to say, as a DomainError sends it', () => {
      expect(wire(BookingError.unauthenticated())).toEqual({
        status: 'unauthenticated',
        message: 'booking.commit.unauthenticated',
        details: { code: 'booking.commit.unauthenticated', params: {} },
      });
      expect(wire(WaitlistError.alreadyWatching())).toMatchObject({
        status: 'already-exists',
        details: { code: 'booking.waitlist.already_watching', params: {} },
      });
    });

    it('keeps what must stay on the server off the wire', () => {
      // A person key, a shop's reason, the violations, the seat index.
      expect(
        wireDetails(BookingError.personDoubleBooked('account:u-2')),
      ).toEqual({
        code: 'booking.commit.invalid_input',
        params: { field: 'person_overlap' },
      });
      expect(
        wireDetails(
          BookingError.shopUnavailable('loc-1', ShopUnavailableReason.Unlisted),
        ),
      ).toEqual({
        code: 'booking.commit.invalid_input',
        params: { field: 'locationId' },
      });
      expect(
        wire(BookingError.invariantViolated([{ errorCode: 'x' } as never])),
      ).toMatchObject({
        status: 'invalid-argument',
        details: { code: 'booking.commit.invariant_violated', params: {} },
      });
    });

    it('a lost race is `aborted`, its wall clock as today’s shop-clock ISO param', () => {
      // 10:00 on the shop's clock = 07:00Z, Sofia summer.
      expect(
        wire(BookingError.slotUnavailable(IVAN, day('2026-10-07'), at(600), 1)),
      ).toEqual({
        status: 'aborted',
        message: 'booking.commit.slot_unavailable',
        details: {
          code: 'booking.commit.slot_unavailable',
          params: {
            barberId: 'b_ivan',
            // 07:00Z on the shop’s clock — Sofia summer, as ZonedDateTime.toISO() spelled it.
            startIso: '2026-10-07T10:00:00.000+03:00',
          },
        },
      });
    });

    it('spells every `*Iso` param on the shop’s clock with its offset — winter too, never UTC', () => {
      expect(WIRE_ZONE).toBe('Europe/Sofia');
      // 10:30 on 2026-12-01 — EET, +02:00.
      expect(
        wireDetails(
          BookingError.slotUnavailable(IVAN, day('2026-12-01'), at(630), 1),
        ),
      ).toEqual({
        code: 'booking.commit.slot_unavailable',
        params: {
          barberId: 'b_ivan',
          startIso: '2026-12-01T10:30:00.000+02:00',
        },
      });
      // Not a shop day: left out, as an absent optional param is.
      expect(
        wireDetails({
          errorCode: StaffEditErrorCode.Overlaps,
          barberId: 'b_ivan',
          localDate: '2026-02-30',
          startMinutes: 600,
          edge: null,
        }),
      ).toEqual({
        code: 'booking.staffEdit.overlaps',
        params: { barberId: 'b_ivan' },
      });
    });

    it('keys the table by errorCode and leaves as the LEGACY wire code — the wire is frozen (F-10)', () => {
      const zone = ZonedTimeSystem.checkZone('Europe/Sofia');
      const day = LocalDate.parse('2026-03-29');
      const minute = MinuteOfDay.of(210);
      if (!zone.ok || !day.ok || !minute.ok) throw new Error('fixture');
      // A flattened struct names `errorCode`; it leaves as today's dotted code.
      expect(
        wire(TimeError.dstGap(day.value, minute.value, zone.value)),
      ).toEqual({
        status: 'invalid-argument',
        message: 'time.nonexistent_local_time',
        details: { code: 'time.nonexistent_local_time', params: {} },
      });
      expect(wire(TimeError.invalidTimeZone('Not/AZone'))).toEqual({
        status: 'internal',
        message: 'time.invalid_time_zone',
        details: { code: 'time.invalid_time_zone', params: {} },
      });
      // Every flattened time code has a legacy wire code; every rule has one.
      const legacy = new Map(Object.entries(LEGACY_WIRE_CODE));
      for (const code of Object.values(TimeErrorCode)) {
        expect(legacy.get(code), code).toMatch(/^time\./);
        expect(wireRuleOf(code).wireCode).toBe(legacy.get(code));
      }
      for (const [code, rule] of Object.entries(EDGE_WIRE)) {
        expect(rule.wireCode, code).toBe(legacy.get(code) ?? code);
      }
      // Every SCREAMING code but a primitive's has its legacy dotted (or
      // undotted lowercase) wire code — so no SCREAMING code reaches a client.
      for (const [name, dictionary] of Object.entries(EDGE_DICTIONARIES)) {
        if (name === 'PrimitiveErrorCode' || name === 'LegacyWireCode') {
          continue;
        }
        for (const code of Object.values(dictionary)) {
          expect(code, name).toMatch(/^[A-Z][A-Z0-9_]+$/);
          expect(legacy.get(code), code).toMatch(/^[a-z][a-zA-Z0-9_.]+$/);
        }
      }
    });

    it('a refused primitive leaves as invalid-argument under its own code (no legacy one)', () => {
      expect(
        wire({
          errorCode: PrimitiveErrorCode.IdEmpty,
          raw: '',
          brand: 'AppointmentId',
        }),
      ).toEqual({
        status: 'invalid-argument',
        message: 'PRIMITIVE_ID_EMPTY',
        details: { code: 'PRIMITIVE_ID_EMPTY', params: {} },
      });
    });

    it('a local-coordinate param renders the same shop-clock ISO through toUtc; a gap is left out', () => {
      const param = wallIso('startIso', 'localDate', 'startMinutes');
      expect(param).toEqual({
        wireName: 'startIso',
        field: 'localDate',
        paramFormat: 'ZONED_WALL_ISO',
        minuteField: 'startMinutes',
      });
      const render = (localDate: unknown, startMinutes: unknown) =>
        wireParamsOf(
          {
            code: StaffEditErrorCode.Overlaps,
            localDate,
            startMinutes,
          },
          [param],
        );
      expect(render('2026-10-07', 600)).toEqual({
        startIso: '2026-10-07T10:00:00.000+03:00',
      });
      // The fall-back repeat takes the earlier offset (locked 2026-10-10).
      expect(render('2026-10-25', 210)).toEqual({
        startIso: '2026-10-25T03:30:00.000+03:00',
      });
      // An exclusive end of 1440 is the next day's first instant.
      expect(render('2026-10-07', 1440)).toEqual({
        startIso: '2026-10-08T00:00:00.000+03:00',
      });
      // A gap time, a non-day and a non-minute are left out, as absent params are.
      expect(render('2026-03-29', 210)).toEqual({});
      expect(render('2026-02-30', 600)).toEqual({});
      expect(render('2026-10-07', 1441)).toEqual({});
      expect(render('2026-10-07', null)).toEqual({});
    });

    it('an Admin-Auth step’s failure keeps today’s coded internal — never the raw pipeline code', () => {
      // verifyOtp: a mint / provision / find failure (the pipeline names it).
      expect(wire({ code: LegacyWireCode.TokenMintingFailure })).toEqual({
        status: 'internal',
        message: 'token_minting_failure',
        details: { code: 'token_minting_failure', params: {} },
      });
      // completeRegistration: a setClaims failure.
      expect(wire({ code: LegacyWireCode.ClaimsPromotionFailure })).toEqual({
        status: 'internal',
        message: 'claims_promotion_failure',
        details: { code: 'claims_promotion_failure', params: {} },
      });
    });

    it('cancelWaitlist: today `{ code }` alone; its 3b flip answers the shared WaitlistError shape — the accepted change', () => {
      // Today (main.spec pins it): cancel-waitlist.ts throws `{ code }` with
      // no params for both codes, while requestWaitlist sends `{ code, params }`.
      // One code has one rule, so when cancelWaitlist flips onto WaitlistError
      // its details GAIN `params` — `{}` and `{ field: 'requestId' }` — and
      // that flip updates main.spec's expectation. The web reads only
      // `details.code` for these two, so the added params change no screen.
      expect(wire(WaitlistError.unauthenticated())).toEqual({
        status: 'unauthenticated',
        message: 'booking.waitlist.unauthenticated',
        details: { code: 'booking.waitlist.unauthenticated', params: {} },
      });
      expect(wire(WaitlistError.invalidRequest('requestId'))).toEqual({
        status: 'invalid-argument',
        message: 'booking.waitlist.invalid_request',
        details: {
          code: 'booking.waitlist.invalid_request',
          params: { field: 'requestId' },
        },
      });
    });

    it('a `field` param leaves as the wire has always spelt it: a renamed field by its old name, a refusal by its legacy code', () => {
      expect(wireDetails(WaitlistError.invalidRequest('localDate'))).toEqual({
        code: 'booking.waitlist.invalid_request',
        params: { field: 'dayKey' },
      });
      expect(
        wireDetails(
          WaitlistError.invalidRequest(SchedulingErrorCode.WaitlistNoDays),
        ),
      ).toEqual({
        code: 'booking.waitlist.invalid_request',
        params: { field: 'scheduling.waitlist.no_days' },
      });
      expect(
        wireDetails(
          WaitlistError.invalidRequest(SchedulingErrorCode.WaitlistEmptyCart),
        ),
      ).toEqual({
        code: 'booking.waitlist.invalid_request',
        params: { field: 'scheduling.waitlist.empty_cart' },
      });
      // A barber not on the roster names its day as today's `dayKey`.
      expect(
        wireDetails(BookingError.barberNotRostered(IVAN, day('2026-10-07'))),
      ).toEqual({
        code: 'booking.commit.barber_not_rostered',
        params: { barberId: 'b_ivan', dayKey: '2026-10-07' },
      });
    });

    it('`{ code }` alone where today’s handlers throw inline', () => {
      const notCancellable: CancellationRefusal = {
        errorCode: CancellationRefusalCode.NotCancellable,
        bookingStatus: BookingStatus.Completed,
      };
      expect(wire(notCancellable)).toEqual({
        status: 'failed-precondition',
        message: 'booking.cancel.not_cancellable',
        details: { code: 'booking.cancel.not_cancellable' },
      });
      expect(
        wire({ errorCode: CancellationRefusalCode.PolicyUnavailable }),
      ).toMatchObject({
        status: 'unavailable',
        details: { code: 'booking.cancel.policy_unavailable' },
      });
      expect(wire({ code: LegacyWireCode.ArrivedForbidden })).toMatchObject({
        status: 'permission-denied',
        details: { code: 'booking.arrived.forbidden' },
      });
      expect(wire({ code: LegacyWireCode.CommitForbidden }).details).toEqual({
        code: 'booking.commit.forbidden',
      });
      expect(wire({ code: LegacyWireCode.BackfillInvalidInput })).toMatchObject(
        {
          status: 'invalid-argument',
          details: { code: 'ops.backfill.invalid_input' },
        },
      );
    });

    it('the cancel window and the transition graph carry today’s params', () => {
      const windowClosed: CancellationRefusal = {
        errorCode: CancellationRefusalCode.WindowClosed,
        windowHours: 24,
        deadlineUtcMs: utc(1),
      };
      expect(wireDetails(windowClosed)).toEqual({
        code: 'booking.cancel.window_closed',
        params: { windowHours: '24' },
      });
      expect(
        wire({
          code: LegacyWireCode.TransitionNotAllowed,
          from: 'completed',
          to: 'cancelled',
        }),
      ).toMatchObject({
        status: 'failed-precondition',
        details: {
          code: 'booking.transition.not_allowed',
          params: { from: 'completed', to: 'cancelled' },
        },
      });
    });

    it('a move and a staff edit say what they said: seat ids joined, instants as ISO, absent fields left out', () => {
      const carried: MoveCarriedSeatUnplaceable = {
        errorCode: MoveErrorCode.CarriedSeatUnplaceable,
        refusal: CarriedSeatRefusal.BarberUnavailable,
        seatIds: [SeatId.of('s1'), SeatId.of('s2')],
      };
      expect(wire(carried)).toMatchObject({
        status: 'failed-precondition',
        details: {
          code: 'booking.reschedule.carried_seat_unplaceable',
          params: { refusal: 'barber_unavailable', seatIds: 's1,s2' },
        },
      });
      expect(
        wireDetails({
          errorCode: StaffEditErrorCode.Overlaps,
          barberId: 'b_ivan',
          localDate: '2026-10-07',
          startMinutes: 660,
          edge: null,
        }),
      ).toEqual({
        code: 'booking.staffEdit.overlaps',
        params: {
          barberId: 'b_ivan',
          startIso: '2026-10-07T11:00:00.000+03:00',
        },
      });
      expect(
        wireDetails(
          StaffEditError.beforeArrival(
            day('2026-10-07'),
            until(720),
            WallTime.of(day('2026-10-07'), at(780)),
          ),
        ),
      ).toEqual({
        code: 'booking.staffEdit.before_arrival',
        params: {
          endIso: '2026-10-07T12:00:00.000+03:00',
          arrivedAtIso: '2026-10-07T13:00:00.000+03:00',
        },
      });
      expect(wire(StaffEditError.stale(3, 4))).toMatchObject({
        status: 'failed-precondition',
        details: { params: { expected: '3', actual: '4' } },
      });
      expect(wire(StaffEditError.forbidden()).status).toBe('permission-denied');
    });

    it('the OTP codes keep their statuses — the lockout is `resource-exhausted`, a mismatch never `permission-denied`', () => {
      expect(wire({ code: LegacyWireCode.OtpExpired })).toEqual({
        status: 'deadline-exceeded',
        message: 'otp_expired',
        details: { code: 'otp_expired', params: {} },
      });
      expect(wire(IdentityError.otpLockedOut()).status).toBe(
        'resource-exhausted',
      );
      expect(wire(IdentityError.otpExpired()).status).toBe('deadline-exceeded');
      expect(wire({ code: LegacyWireCode.RegistrationForbidden }).status).toBe(
        'failed-precondition',
      );
      expect(
        wire({ code: LegacyWireCode.InvalidInput, reason: 'challengeId' })
          .details,
      ).toEqual({ code: 'invalid_input', params: { reason: 'challengeId' } });
    });

    it('`{ errors: [...] }` for an aggregate, each nested refusal by its own rule', () => {
      expect(
        wire({
          code: LegacyWireCode.OtpValidationFailed,
          errors: [
            { code: LegacyWireCode.OtpDestinationEmpty },
            { code: LegacyWireCode.InvalidOtpMaxAttempts, rawValue: 0 },
          ],
        }),
      ).toEqual({
        status: 'invalid-argument',
        message: 'otp_validation_failed',
        details: {
          errors: [
            { code: 'otp_destination_empty', params: {} },
            { code: 'invalid_otp_max_attempts', params: { rawValue: 0 } },
          ],
        },
      });
      expect(
        wireDetails({
          code: LegacyWireCode.UserValidationFailed,
          errors: [AccountsError.firstNameTooShort('A', 2)],
        }),
      ).toEqual({
        errors: [
          {
            code: 'accounts.first_name.too_short',
            params: { attempted: 'A', minLength: 2 },
          },
        ],
      });
    });

    it('`{ code, errors }` for a wrapper and its cause', () => {
      expect(
        wireDetails({
          code: LegacyWireCode.RegistrationBirthDateInvalid,
          errors: [IdentityError.birthDateTooYoung(14, 16)],
        }),
      ).toEqual({
        code: 'registration_birth_date_invalid',
        errors: [
          {
            code: 'identity.birth_date.too_young',
            params: { age: 14, minAge: 16 },
          },
        ],
      });
    });

    it('an answered refusal that reaches the throw path is `internal`, never a status to act on', () => {
      expect(wire(StreakPublishError.previewStale())).toEqual({
        status: 'internal',
        message: 'loyalty.streak_publish.preview_stale',
        details: { code: 'loyalty.streak_publish.preview_stale' },
      });
    });

    it('a code the table does not know is `internal`', () => {
      expect(wireRuleOf('not.a.code')).toMatchObject({
        httpsStatus: 'internal',
      });
      expect(wire({ code: 'not.a.code' } as unknown as EdgeError).status).toBe(
        'internal',
      );
    });
  });
});

// ── The wrappers ───────────────────────────────────────────────────────────

type Tracked = { readonly error: unknown; readonly context: unknown };
type Logged = {
  readonly level: string;
  readonly msg: string;
  readonly fields: unknown;
};

function edgePorts(start = 1_000) {
  let now = start;
  const tracked: Tracked[] = [];
  const logged: Logged[] = [];
  const telemetry: TelemetryPorts = {
    log: (level, msg, fields) => logged.push({ level, msg, fields }),
    trackError: (error, context) => tracked.push({ error, context }),
  };
  return {
    ports: { ...telemetry, nowUtcMs: () => utc(now) },
    tracked,
    logged,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const request = (data: unknown): CallableRequest<unknown> =>
  ({
    data,
    rawRequest: {},
    acceptsStreaming: false,
  }) as unknown as CallableRequest<unknown>;

async function rejection(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpsError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('edge — the wrappers', () => {
  describe('legacyCallable (Phase 3a)', () => {
    it('answers what today’s handler answers', async () => {
      const { ports, tracked } = edgePorts();
      const handler = legacyCallable(
        Callables.CancelWaitlist,
        ports,
        async () => ({
          requestId: 'r1',
        }),
      );
      await expect(handler(request({}))).resolves.toEqual({ requestId: 'r1' });
      expect(tracked).toEqual([]);
    });

    it('passes the handler’s own HttpsError through untouched, untracked', async () => {
      const { ports, tracked } = edgePorts();
      const own = new HttpsError('not-found', 'No such waitlist request', {
        code: 'booking.waitlist.not_found',
      });
      const handler = legacyCallable(Callables.CancelWaitlist, ports, () => {
        throw own;
      });
      expect(await rejection(handler(request({})))).toBe(own);
      expect(tracked).toEqual([]);
    });

    it('tracks an unexpected throw and answers it as the platform does today', async () => {
      const { ports, tracked } = edgePorts();
      const boom = new Error('firestore unreachable');
      const handler = legacyCallable(
        Callables.CommitBooking,
        ports,
        async () => {
          throw boom;
        },
      );
      const thrown = await rejection(handler(request({})));
      expect(thrown.toJSON()).toEqual({
        message: 'INTERNAL',
        status: 'INTERNAL',
      });
      expect(tracked).toEqual([
        { error: boom, context: { callable: 'commitBooking' } },
      ]);
    });
  });

  describe('callableEdge', () => {
    const spec = {
      callable: Callables.CommitBooking,
      failureCode: LegacyWireCode.CommitStoreFailed,
      timeoutSeconds: null,
      answer: null,
    } as const;

    it('answers Result.ok with its value', async () => {
      const { ports } = edgePorts();
      const handler = callableEdge(spec, ports, async () =>
        Result.ok({ appointmentId: 'a1' }),
      );
      await expect(handler(request({}))).resolves.toEqual({
        appointmentId: 'a1',
      });
    });

    it('throws Result.err exactly as the table says', async () => {
      const { ports, tracked } = edgePorts();
      const handler = callableEdge(spec, ports, async () =>
        Result.err(BookingError.tooSoon(sure(MinuteCount.of(30)))),
      );
      const thrown = await rejection(handler(request({})));
      expect(thrown.code).toBe('failed-precondition');
      expect(thrown.details).toEqual({
        code: 'booking.commit.too_soon',
        params: { minLeadMinutes: '30' },
      });
      expect(tracked).toEqual([]);
    });

    it('answers an ANSWERED refusal through the callable’s own answer', async () => {
      const { ports } = edgePorts();
      const handler = callableEdge(
        {
          callable: Callables.PublishStreakDefinition,
          failureCode: LegacyWireCode.StreakPublishStoreFailed,
          timeoutSeconds: null,
          // Today's answer names the refusal by its wire code.
          answer: (refusal) => ({
            kind: 'refused',
            code: wireRuleOf(errorCodeOf(refusal)).wireCode,
          }),
        },
        ports,
        async () => Result.err(StreakPublishError.stale(2, 3)),
      );
      await expect(handler(request({}))).resolves.toEqual({
        kind: 'refused',
        code: 'loyalty.streak_publish.stale',
      });
    });

    it('answers an infrastructure throw with the callable’s coded failure, tracked once', async () => {
      const { ports, tracked } = edgePorts();
      const boom = Object.assign(new Error('deadline'), { code: 4 });
      const handler = callableEdge(spec, ports, async () => {
        throw boom;
      });
      const thrown = await rejection(handler(request({})));
      expect(thrown.code).toBe('internal');
      expect(thrown.details).toEqual({
        code: 'booking.commit.store_failed',
        params: {},
      });
      expect(tracked).toEqual([
        { error: boom, context: { callable: 'commitBooking' } },
      ]);
    });

    it('answers it with the platform’s bare INTERNAL when the callable names no failure code', async () => {
      const { ports } = edgePorts();
      const handler = callableEdge(
        { ...spec, failureCode: null },
        ports,
        async () => {
          throw new Error('boom');
        },
      );
      const thrown = await rejection(handler(request({})));
      expect(thrown.toJSON()).toEqual({
        message: 'INTERNAL',
        status: 'INTERNAL',
      });
    });

    it('hands the handler a budget: a share of the platform timeout or the client’s wait, whichever is shorter', async () => {
      const { ports, advance } = edgePorts();
      const seen: {
        limitMs: number;
        spentAtStart: boolean;
        spentLater: boolean;
      }[] = [];
      const handler = callableEdge(
        { ...spec, timeoutSeconds: 540 },
        ports,
        async (_request, budget) => {
          const spentAtStart = budget.spent();
          advance(budget.limitMs);
          seen.push({
            limitMs: budget.limitMs,
            spentAtStart,
            spentLater: budget.spent(),
          });
          return Result.ok(null);
        },
      );
      await handler(request({}));
      expect(seen).toEqual([
        {
          limitMs: WorkBudgetSystem.callableBudgetMs(540),
          spentAtStart: false,
          spentLater: true,
        },
      ]);
      expect(WorkBudgetSystem.callableBudgetMs(540)).toBe(49_000);
    });
  });

  describe('retryingTrigger', () => {
    const event = { id: 'evt-1', time: new Date(500).toISOString() };

    it('logs nothing when the attempt succeeds', async () => {
      const { ports, logged } = edgePorts();
      await retryingTrigger(
        { fn: 'dispatchClientProjections', timeoutSeconds: null },
        ports,
        async () => undefined,
      )(event);
      expect(logged).toEqual([]);
    });

    it('logs the one attempt line and rethrows what a redelivery could fix', async () => {
      const { ports, logged } = edgePorts(2_000);
      const transient = Object.assign(new Error('unavailable'), { code: 14 });
      const trigger = retryingTrigger(
        { fn: 'dispatchClientProjections', timeoutSeconds: null },
        ports,
        async () => {
          throw transient;
        },
      );
      await expect(trigger(event)).rejects.toBe(transient);
      expect(logged).toEqual([
        {
          level: 'error',
          msg: 'trigger attempt failed',
          fields: {
            fn: 'dispatchClientProjections',
            eventId: 'evt-1',
            outcome: 'transient',
            code: 'unavailable',
            ageMs: 1_500,
          },
        },
      ]);
    });

    it('logs and drops what would fail the same way for the whole window', async () => {
      const { ports, logged } = edgePorts();
      const trigger = retryingTrigger(
        { fn: 'auditProfileChanges', timeoutSeconds: null },
        ports,
        async () => {
          throw Object.assign(new Error('bad'), { code: 3 });
        },
      );
      await expect(
        trigger({ id: 'evt-2', time: 'not a time' }),
      ).resolves.toBeUndefined();
      expect(logged[0]?.fields).toMatchObject({
        outcome: 'permanent',
        code: 'invalid-argument',
        ageMs: null,
      });
    });

    it('budgets a share of the definition’s timeout', async () => {
      const { ports } = edgePorts();
      const limits: number[] = [];
      await retryingTrigger(
        { fn: 'continueClientStatsPolicyRecompute', timeoutSeconds: 540 },
        ports,
        async (_event, budget) => {
          limits.push(budget.limitMs);
        },
      )(event);
      await retryingTrigger(
        { fn: 'rebuildBusyOnAppointmentChange', timeoutSeconds: null },
        ports,
        async (_event, budget) => {
          limits.push(budget.limitMs);
        },
      )(event);
      expect(limits).toEqual([
        WorkBudgetSystem.budgetMsFor(540),
        WorkBudgetSystem.budgetMsFor(PLATFORM_TIMEOUT_SECONDS),
      ]);
    });
  });

  it('workBudget starts on the clock it is given and is spent at its limit', () => {
    let now = 10;
    const budget = workBudget(() => utc(now), 100);
    expect(budget).toMatchObject({ startedMs: 10, limitMs: 100 });
    now = 109;
    expect(budget.spent()).toBe(false);
    now = 110;
    expect(budget.spent()).toBe(true);
  });
});
