import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { type CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import {
  AppointmentId,
  BarberId,
  BookingStatus,
  CourseId,
  EndMinute,
  EventId,
  InvitationId,
  LocalDate,
  LocationId,
  MinuteCount,
  MinuteOfDay,
  PositionId,
  PrimitiveErrorCode,
  Result,
  SeatId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  AccountsError,
  BookingError,
  BookingErrorCode,
  CancellationRefusal,
  CarriedSeatRefusal,
  CatalogError,
  CompleteRegistrationRefusalCode,
  EngagementError,
  EngagementErrorCode,
  GovernanceError,
  HttpsStatus,
  IdentityError,
  IdentityErrorCode,
  type MoveCarriedSeatUnplaceable,
  MoveErrorCode,
  PhoneError,
  PhoneInvalidReason,
  RepositoryError,
  SchedulingErrorCode,
  ShopUnavailableReason,
  StaffEditError,
  StaffEditErrorCode,
  StreakPublishError,
  StreakPublishErrorCode,
  TimeError,
  TimeErrorCode,
  WaitlistError,
  WIRE_PARAM_ALLOWLIST,
} from '@core/errors';
import { AttemptOutcome, ResizeEdge } from '@core/components';
import { Callables, type TelemetryPorts } from '@core/ports';
import {
  type AttemptLine,
  WorkBudgetSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  attemptLineFields,
  EDGE_DICTIONARIES,
  EDGE_WIRE,
  type EdgeError,
  NamedField,
  PLATFORM_TIMEOUT_SECONDS,
  WireShape,
  callableEdge,
  isAnswered,
  projected,
  retryingTrigger,
  toHttpsError,
  wireDetails,
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
const FIXTURE_APPOINTMENT = AppointmentId.of('apt-1');

const SRC = resolve(__dirname);
const ECS_CORE = resolve(__dirname, '../../../libs/ecs-core/src');

/** The shared allowlist, read by code — no dynamic index. */
const ALLOWLIST = new Map<string, readonly string[]>(
  Object.entries(WIRE_PARAM_ALLOWLIST),
);

const ALL_CODES: readonly string[] = Object.values(EDGE_DICTIONARIES).flatMap(
  (dictionary) => Object.values(dictionary),
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
  // A handler directory a flip deleted whole (`use-cases/`, flip 3) holds nothing.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- this workspace's own sources, found by listing them.
  if (!existsSync(dir)) return [];
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

/**
 * The error dictionaries ecs-core declares (`…ErrorCode` / `…RefusalCode`),
 * read from their two homes: the `@core/errors` tier (`src/errors`) and the
 * one dictionary below it, `src/primitives/primitive.error.ts`.
 * `creativo/error-dictionary-home` keeps a dictionary out of every other file.
 */
function ecsErrorDictionaryNames(): readonly string[] {
  const names = new Set<string>();
  for (const file of [
    ...tsFiles(join(ECS_CORE, 'errors')),
    ...tsFiles(join(ECS_CORE, 'primitives')),
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

/**
 * Codes the callables RETURN — never thrown: the streak publish's rule
 * refusals and its caller who is no admin, read from their ONE spelling
 * (`StreakPublishError.ANSWERED_CODES`, `@core/errors`). A caller without a
 * session is THROWN `unauthenticated` (`CallerUnauthenticated` is not there).
 */
const ANSWERED: ReadonlySet<string> = new Set(
  StreakPublishError.ANSWERED_CODES,
);

/** What must stay on the server unless a code's own allowlist names it (R14). */
const SERVER_ONLY = ['detail', 'reason', 'path', 'violations', 'junk'] as const;

/**
 * A struct of `code` holding EVERY field a row could name and every field
 * that must never leave — what the projection is proved against.
 */
function everything(code: string): EdgeError {
  const fields = new Map<string, unknown>([
    ['errorCode', code],
    ['field', 'f'],
    ['refusal', 'r'],
    ['detail', 'account:u-2'],
    ['reason', 'internal-reason'],
    ['path', 'appointments/a1'],
    ['violations', [{ errorCode: 'x' }]],
    ['junk', 1],
  ]);
  for (const name of ALLOWLIST.get(code) ?? []) {
    if (!fields.has(name) || name === 'reason') fields.set(name, `v:${name}`);
  }
  return Object.fromEntries(fields) as EdgeError;
}

const THROWN_CODES = Object.entries(EDGE_WIRE)
  .filter(([, rule]) => rule.wireShape === WireShape.Fields)
  .map(([code]) => code)
  .sort();

describe('edge — the wire table', () => {
  describe('totality', () => {
    it('maps every code of every covered dictionary to a rule an HttpsError can be built from', () => {
      expect(ALL_CODES.length).toBeGreaterThan(250);
      for (const code of ALL_CODES) {
        expect(Object.hasOwn(EDGE_WIRE, code), code).toBe(true);
        const rule = wireRuleOf(code);
        if (rule.wireShape === WireShape.Answered) continue;
        expect(Object.values(HttpsStatus), code).toContain(rule.httpsStatus);
        expect(() =>
          toHttpsError({ errorCode: code } as EdgeError),
        ).not.toThrow();
      }
    });

    it('holds exactly one rule per code — no code is spelled by two dictionaries', () => {
      expect(new Set(ALL_CODES).size).toBe(ALL_CODES.length);
      expect(Object.keys(EDGE_WIRE).sort()).toEqual([...ALL_CODES].sort());
    });

    it('covers every error dictionary ecs-core declares — and no legacy one', () => {
      const declared = ecsErrorDictionaryNames();
      expect(declared.length).toBeGreaterThanOrEqual(19);
      expect(Object.keys(EDGE_DICTIONARIES).sort()).toEqual([...declared]);
      for (const code of ALL_CODES) {
        // Every code on the wire is SCREAMING (Phase 4a 4A-4: the legacy
        // dotted and undotted codes are gone with `LegacyWireCode`).
        expect(code).toMatch(/^[A-Z][A-Z0-9_]+$/);
      }
    });

    it('answers — never throws — exactly the streak publish’s refusals', () => {
      expect(Object.keys(EDGE_WIRE).filter(isAnswered).sort()).toEqual(
        [...ANSWERED].sort(),
      );
    });

    it('lists, per code, exactly its row’s named fields and its allowlist — the ONE table the web reads too', () => {
      for (const [code, rule] of Object.entries(EDGE_WIRE)) {
        if (rule.wireShape === WireShape.Answered) continue;
        const named = rule.wireFields.filter(
          (name) => name === NamedField.Field || name === NamedField.Refusal,
        );
        expect(rule.wireFields, code).toEqual([
          ...named,
          ...(ALLOWLIST.get(code) ?? []),
        ]);
      }
      // `field` and `refusal` leave exactly where the legacy rows named them.
      const namedBy = (name: string) =>
        Object.entries(EDGE_WIRE)
          .filter(
            ([, rule]) =>
              rule.wireShape !== WireShape.Answered &&
              rule.wireFields.includes(name),
          )
          .map(([code]) => code)
          .sort();
      expect(namedBy(NamedField.Field)).toEqual(
        [
          BookingErrorCode.InvalidInput,
          StaffEditErrorCode.InvalidCommand,
          'BOOKING_WAITLIST_INVALID_REQUEST',
          StreakPublishErrorCode.InvalidInput,
          IdentityErrorCode.RegistrationFieldMissing,
        ].sort(),
      );
      expect(namedBy(NamedField.Refusal)).toEqual([
        MoveErrorCode.CarriedSeatUnplaceable,
      ]);
    });
  });

  describe('today’s statuses, read from today’s handlers', () => {
    // 0 since flip 3 — every callable answers through its wire. A handler
    // that throws its own HttpsError again fails here.
    it('finds no handler that throws its own HttpsError — every callable answers through its wire', () => {
      expect(todaysThrowSites()).toEqual([]);
    });

    it('finds no use-case error class — every refusal is an ecs-core struct', () => {
      expect(todaysErrorClassCodes()).toEqual([]);
    });
  });

  describe('details — the projected struct (Phase 4a 4A-4)', () => {
    // One case per code (R14): with every field a struct could hold present,
    // exactly `errorCode` and the code's listed fields leave — never a person
    // key, an internal reason, a repository path or a violation list unless
    // the code's own allowlist names it.
    it.each(THROWN_CODES)(
      '%s leaves as its errorCode and its listed fields alone',
      (code) => {
        const rule = wireRuleOf(code);
        if (rule.wireShape === WireShape.Answered) return;
        const details = wireDetails(everything(code));
        expect(Object.keys(details).sort()).toEqual(
          ['errorCode', ...rule.wireFields].sort(),
        );
        for (const name of SERVER_ONLY) {
          if (!rule.wireFields.includes(name)) {
            expect(details, `${code} leaked ${name}`).not.toHaveProperty(name);
          }
        }
        const thrown = toHttpsError(everything(code));
        expect(thrown.code).toBe(rule.httpsStatus);
        expect(thrown.message).toBe(code);
      },
    );

    it('carries the struct’s figures as it holds them — no stringified params', () => {
      expect(wire(BookingError.tooSoon(sure(MinuteCount.of(30))))).toEqual({
        status: 'failed-precondition',
        message: 'BOOKING_TOO_SOON',
        details: { errorCode: 'BOOKING_TOO_SOON', minLeadMinutes: 30 },
      });
      expect(wireDetails(BookingError.partyTooLarge(4))).toEqual({
        errorCode: 'BOOKING_PARTY_TOO_LARGE',
        maxPartySize: 4,
      });
      expect(wire(WaitlistError.tooManyDays(7)).details).toEqual({
        errorCode: 'BOOKING_WAITLIST_TOO_MANY_DAYS',
        max: 7,
      });
    });

    it('a refusal with nothing to say leaves as its code alone', () => {
      expect(wire(BookingError.unauthenticated())).toEqual({
        status: 'unauthenticated',
        message: 'BOOKING_UNAUTHENTICATED',
        details: { errorCode: 'BOOKING_UNAUTHENTICATED' },
      });
      expect(wire(WaitlistError.alreadyWatching())).toEqual({
        status: 'already-exists',
        message: 'BOOKING_WAITLIST_ALREADY_WATCHING',
        details: { errorCode: 'BOOKING_WAITLIST_ALREADY_WATCHING' },
      });
    });

    it('keeps what must stay on the server off the wire — a person key, a shop’s reason, the violations, a repository cause', () => {
      expect(
        wireDetails(BookingError.personDoubleBooked('account:u-2')),
      ).toEqual({
        errorCode: 'BOOKING_INVALID_INPUT',
        field: 'person_overlap',
      });
      expect(
        wireDetails(
          BookingError.shopUnavailable('loc-1', ShopUnavailableReason.Unlisted),
        ),
      ).toEqual({ errorCode: 'BOOKING_INVALID_INPUT', field: 'locationId' });
      expect(
        wire(BookingError.invariantViolated([{ errorCode: 'x' } as never])),
      ).toEqual({
        status: 'invalid-argument',
        message: 'BOOKING_INVARIANT_VIOLATED',
        details: { errorCode: 'BOOKING_INVARIANT_VIOLATED' },
      });
      expect(
        wire(RepositoryError.writeFailed('appointments/a1', 'deadline')),
      ).toEqual({
        status: 'internal',
        message: 'REPOSITORY_WRITE_FAILED',
        details: { errorCode: 'REPOSITORY_WRITE_FAILED' },
      });
    });

    it('a lost race is `aborted`, its wall clock as the struct holds it — `localDate` + `startMinutes`, no rendered instant', () => {
      expect(
        wire(BookingError.slotUnavailable(IVAN, day('2026-10-07'), at(600), 1)),
      ).toEqual({
        status: 'aborted',
        message: 'BOOKING_SLOT_UNAVAILABLE',
        details: {
          errorCode: 'BOOKING_SLOT_UNAVAILABLE',
          barberId: 'b_ivan',
          localDate: '2026-10-07',
          startMinutes: 600,
        },
      });
      // A barber not on the roster names its day by the struct's own name.
      expect(
        wireDetails(BookingError.barberNotRostered(IVAN, day('2026-10-07'))),
      ).toEqual({
        errorCode: 'BOOKING_BARBER_NOT_ROSTERED',
        barberId: 'b_ivan',
        localDate: '2026-10-07',
      });
    });

    it('a refused time and a refused primitive leave as themselves — a gap is the owner-locked `DST_GAP_INVALID_TIME`, naming its wall clock and zone', () => {
      const zone = ZonedTimeSystem.checkZone('Europe/Sofia');
      const gapDay = LocalDate.parse('2026-03-29');
      const minute = MinuteOfDay.of(210);
      if (!zone.ok || !gapDay.ok || !minute.ok) throw new Error('fixture');
      // The copy names the erased wall clock and the shop's zone — both leave.
      expect(
        wire(TimeError.dstGap(gapDay.value, minute.value, zone.value)),
      ).toEqual({
        status: 'invalid-argument',
        message: TimeErrorCode.DstGap,
        details: {
          errorCode: TimeErrorCode.DstGap,
          localDate: '2026-03-29',
          minute: 210,
          timeZone: 'Europe/Sofia',
        },
      });
      expect(wire(TimeError.invalidTimeZone('Not/AZone'))).toEqual({
        status: 'internal',
        message: TimeErrorCode.InvalidTimeZone,
        details: { errorCode: TimeErrorCode.InvalidTimeZone },
      });
      expect(
        wire({
          errorCode: PrimitiveErrorCode.IdEmpty,
          raw: '',
          brand: 'AppointmentId',
        }),
      ).toEqual({
        status: 'invalid-argument',
        message: 'PRIMITIVE_ID_EMPTY',
        details: { errorCode: 'PRIMITIVE_ID_EMPTY' },
      });
    });

    it('the identity callables’ own faults keep the legacy statuses — internal, the reason for an invalid input', () => {
      expect(wire(IdentityError.tokenMintingFailure())).toEqual({
        status: 'internal',
        message: 'IDENTITY_TOKEN_MINTING_FAILURE',
        details: { errorCode: 'IDENTITY_TOKEN_MINTING_FAILURE' },
      });
      expect(wire(IdentityError.claimsPromotionFailure()).status).toBe(
        'internal',
      );
      expect(wire(IdentityError.invalidInput('challengeId')).details).toEqual({
        errorCode: 'IDENTITY_INVALID_INPUT',
        reason: 'challengeId',
      });
    });

    it('the OTP codes keep their statuses — the lockout is `resource-exhausted`, a forbidden registration never `permission-denied`', () => {
      expect(wire(IdentityError.otpExpired())).toEqual({
        status: 'deadline-exceeded',
        message: 'IDENTITY_OTP_EXPIRED',
        details: { errorCode: 'IDENTITY_OTP_EXPIRED' },
      });
      expect(wire(IdentityError.otpLockedOut()).status).toBe(
        'resource-exhausted',
      );
      expect(wire(IdentityError.registrationForbidden()).status).toBe(
        'failed-precondition',
      );
    });

    it('both waitlist doors answer the shared WaitlistError shape', () => {
      expect(wire(WaitlistError.unauthenticated())).toEqual({
        status: 'unauthenticated',
        message: 'BOOKING_WAITLIST_UNAUTHENTICATED',
        details: { errorCode: 'BOOKING_WAITLIST_UNAUTHENTICATED' },
      });
      expect(wire(WaitlistError.invalidRequest('requestId'))).toEqual({
        status: 'invalid-argument',
        message: 'BOOKING_WAITLIST_INVALID_REQUEST',
        details: {
          errorCode: 'BOOKING_WAITLIST_INVALID_REQUEST',
          field: 'requestId',
        },
      });
      // A `field` names the payload field, or the refusal one level down, as
      // the struct holds it — no legacy rename, no dotted code.
      expect(
        wireDetails(
          WaitlistError.invalidRequest(SchedulingErrorCode.WaitlistNoDays),
        ),
      ).toEqual({
        errorCode: 'BOOKING_WAITLIST_INVALID_REQUEST',
        field: SchedulingErrorCode.WaitlistNoDays,
      });
    });

    it('the cancel callable’s refusals: a window carries its hours, its deadline stays on the server', () => {
      expect(
        wire(CancellationRefusal.notCancellable(BookingStatus.Completed)),
      ).toEqual({
        status: 'failed-precondition',
        message: 'BOOKING_CANCEL_NOT_CANCELLABLE',
        details: { errorCode: 'BOOKING_CANCEL_NOT_CANCELLABLE' },
      });
      expect(wire(CancellationRefusal.policyUnavailable()).status).toBe(
        'unavailable',
      );
      expect(wireDetails(CancellationRefusal.windowClosed(24, utc(1)))).toEqual(
        { errorCode: 'BOOKING_CANCEL_WINDOW_CLOSED', windowHours: 24 },
      );
      expect(wire(CancellationRefusal.notFound(FIXTURE_APPOINTMENT))).toEqual({
        status: 'not-found',
        message: 'BOOKING_CANCEL_NOT_FOUND',
        details: { errorCode: 'BOOKING_CANCEL_NOT_FOUND' },
      });
    });

    it('the booking callables’ own refusals keep the legacy statuses, the lifecycle’s two states SCREAMING', () => {
      expect(wire(BookingError.bare(BookingErrorCode.CommitForbidden))).toEqual(
        {
          status: 'permission-denied',
          message: 'BOOKING_COMMIT_FORBIDDEN',
          details: { errorCode: 'BOOKING_COMMIT_FORBIDDEN' },
        },
      );
      expect(
        wire(BookingError.bare(BookingErrorCode.ArrivedForbidden)).status,
      ).toBe('permission-denied');
      expect(
        wire(
          BookingError.statusMove(
            BookingErrorCode.TransitionNotAllowed,
            BookingStatus.Completed,
            BookingStatus.Cancelled,
          ),
        ),
      ).toEqual({
        status: 'failed-precondition',
        message: 'BOOKING_TRANSITION_NOT_ALLOWED',
        details: {
          errorCode: 'BOOKING_TRANSITION_NOT_ALLOWED',
          fromBookingStatus: 'COMPLETED',
          toBookingStatus: 'CANCELLED',
        },
      });
      expect(
        wireDetails(
          BookingError.callNotFound(
            BookingErrorCode.TipNotFound,
            FIXTURE_APPOINTMENT,
          ),
        ),
      ).toEqual({ errorCode: 'BOOKING_TIP_NOT_FOUND' });
      expect(
        wire({ errorCode: 'OPS_BACKFILL_INVALID_INPUT' } as EdgeError),
      ).toMatchObject({ status: 'invalid-argument' });
    });

    it('a move and a staff edit say what they said: seat ids as a list, wall clocks as the struct holds them', () => {
      const carried: MoveCarriedSeatUnplaceable = {
        errorCode: MoveErrorCode.CarriedSeatUnplaceable,
        refusal: CarriedSeatRefusal.BarberUnavailable,
        seatIds: [SeatId.of('s1'), SeatId.of('s2')],
      };
      expect(wire(carried)).toEqual({
        status: 'failed-precondition',
        message: MoveErrorCode.CarriedSeatUnplaceable,
        details: {
          errorCode: MoveErrorCode.CarriedSeatUnplaceable,
          refusal: CarriedSeatRefusal.BarberUnavailable,
          seatIds: ['s1', 's2'],
        },
      });
      expect(
        wireDetails(
          StaffEditError.overlaps(IVAN, day('2026-10-07'), at(660), null),
        ),
      ).toEqual({
        errorCode: StaffEditErrorCode.Overlaps,
        barberId: 'b_ivan',
        localDate: '2026-10-07',
        startMinutes: 660,
        resizeEdge: null,
      });
      expect(
        wireDetails(
          StaffEditError.overlaps(
            IVAN,
            day('2026-10-07'),
            at(660),
            ResizeEdge.End,
          ),
        ),
      ).toMatchObject({ resizeEdge: 'END' });
      expect(
        wireDetails(
          StaffEditError.beforeArrival(
            day('2026-10-07'),
            until(720),
            day('2026-10-07'),
            at(780),
          ),
        ),
      ).toEqual({
        errorCode: StaffEditErrorCode.BeforeArrival,
        localDate: '2026-10-07',
        finishMinutes: 720,
        arrivalLocalDate: '2026-10-07',
        arrivalMinutes: 780,
      });
      expect(wire(StaffEditError.stale(3, 4))).toMatchObject({
        status: 'failed-precondition',
        details: { expected: 3, actual: 4 },
      });
      expect(wire(StaffEditError.forbidden()).status).toBe('permission-denied');
    });

    it('the programs refusals no callable returns yet (flip 4, D9(b)) leave by their kind — a missing program `not-found`, an event no zone places `failed-precondition`', () => {
      expect(
        wire(
          EngagementError.programNotFound(
            EngagementErrorCode.PositionNotFound,
            PositionId.of('p-1'),
          ),
        ),
      ).toEqual({
        status: 'not-found',
        message: 'ENGAGEMENT_POSITION_NOT_FOUND',
        details: { errorCode: 'ENGAGEMENT_POSITION_NOT_FOUND' },
      });
      expect(
        wire(
          EngagementError.programNotFound(
            EngagementErrorCode.CourseNotFound,
            CourseId.of('c-1'),
          ),
        ).status,
      ).toBe('not-found');
      expect(
        wire(
          EngagementError.programNotFound(
            EngagementErrorCode.ShopEventNotFound,
            EventId.of('e-1'),
          ),
        ).status,
      ).toBe('not-found');
      expect(
        wire(EngagementError.shopEventZoneUnknown(LocationId.of('loc-center')))
          .status,
      ).toBe('failed-precondition');
      expect(
        wire(CatalogError.locationZoneUnknown(LocationId.of('loc-center')))
          .status,
      ).toBe('failed-precondition');
    });

    it('the new callables’ refusals (Phase 4a 4A-3): the impersonation gate and the invitation’s', () => {
      expect(wire(GovernanceError.impersonationUnauthenticated())).toEqual({
        status: 'unauthenticated',
        message: 'GOVERNANCE_IMPERSONATION_UNAUTHENTICATED',
        details: { errorCode: 'GOVERNANCE_IMPERSONATION_UNAUTHENTICATED' },
      });
      // The caller's uid stays on the server.
      expect(
        wire(GovernanceError.impersonationForbidden(UserId.of('u-1'))),
      ).toEqual({
        status: 'permission-denied',
        message: 'GOVERNANCE_IMPERSONATION_FORBIDDEN',
        details: { errorCode: 'GOVERNANCE_IMPERSONATION_FORBIDDEN' },
      });
      const invitation = InvitationId.of('inv-1');
      expect(wire(EngagementError.invitationNotFound(invitation)).status).toBe(
        'not-found',
      );
      expect(
        wire(EngagementError.invitationAlreadyRedeemed(invitation)).status,
      ).toBe('already-exists');
      expect(wire(EngagementError.invitationUnauthenticated()).status).toBe(
        'unauthenticated',
      );
      expect(wire(EngagementError.invitationSelfRedemption()).status).toBe(
        'failed-precondition',
      );
    });

    it('`{ errors: [...] }` for an aggregate — no top-level code, each nested refusal projected by its own row', () => {
      expect(
        wire({
          errorCode: CompleteRegistrationRefusalCode.ProfileInvalid,
          errors: [
            AccountsError.firstNameTooShort('A', 2),
            PhoneError.invalid('12', PhoneInvalidReason.TooShort),
          ],
        }),
      ).toEqual({
        status: 'invalid-argument',
        message: CompleteRegistrationRefusalCode.ProfileInvalid,
        details: {
          errors: [
            {
              errorCode: 'ACCOUNTS_FIRST_NAME_TOO_SHORT',
              attempted: 'A',
              minLength: 2,
            },
            {
              errorCode: 'PHONE_INVALID',
              attempted: '12',
              reason: 'too-short',
            },
          ],
        },
      });
    });

    it('`{ errorCode, errors }` for a wrapper and its cause', () => {
      expect(
        wireDetails(
          IdentityError.registrationBirthDateInvalid([
            IdentityError.birthDateTooYoung(14, 16),
          ]),
        ),
      ).toEqual({
        errorCode: 'IDENTITY_REGISTRATION_BIRTH_DATE_INVALID',
        errors: [
          { errorCode: 'IDENTITY_BIRTH_DATE_TOO_YOUNG', age: 14, minAge: 16 },
        ],
      });
    });

    it('an answered refusal that reaches the throw path is `internal`, never a status to act on', () => {
      expect(wire(StreakPublishError.previewStale())).toEqual({
        status: 'internal',
        message: 'LOYALTY_STREAK_PUBLISH_PREVIEW_STALE',
        details: { errorCode: 'LOYALTY_STREAK_PUBLISH_PREVIEW_STALE' },
      });
    });

    it('a code the table does not know is `internal`, its code alone', () => {
      expect(wireRuleOf('NOT_A_CODE')).toMatchObject({
        httpsStatus: 'internal',
        wireFields: [],
      });
      expect(
        wire({ errorCode: 'NOT_A_CODE', detail: 'x' } as unknown as EdgeError),
      ).toEqual({
        status: 'internal',
        message: 'NOT_A_CODE',
        details: { errorCode: 'NOT_A_CODE' },
      });
    });

    it('projects a struct to a list — present fields as held, `null` kept, `undefined` left out', () => {
      expect(
        projected(
          {
            errorCode: StaffEditErrorCode.Overlaps,
            barberId: 'b_ivan',
            resizeEdge: null,
          } as EdgeError,
          ['barberId', 'resizeEdge', 'startMinutes'],
        ),
      ).toEqual({
        errorCode: StaffEditErrorCode.Overlaps,
        barberId: 'b_ivan',
        resizeEdge: null,
      });
    });
  });
});

describe('edge — the attempt line (Phase 4a 4A-2 (c))', () => {
  it('speaks the flipped vocabulary: the SCREAMING outcome, the failure’s code as `errorCode`', () => {
    const line: AttemptLine = {
      fn: 'dispatchClientProjections',
      eventId: 'evt-1' as AttemptLine['eventId'],
      attemptOutcome: AttemptOutcome.Transient,
      failureCode: 'unavailable',
      ageMs: 1_500,
    };
    expect(attemptLineFields(line)).toEqual({
      fn: 'dispatchClientProjections',
      eventId: 'evt-1',
      outcome: 'TRANSIENT',
      errorCode: 'unavailable',
      ageMs: 1_500,
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
  describe('callableEdge', () => {
    const spec = {
      callable: Callables.CommitBooking,
      failureCode: BookingErrorCode.CommitStoreFailed,
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
        errorCode: 'BOOKING_TOO_SOON',
        minLeadMinutes: 30,
      });
      expect(tracked).toEqual([]);
    });

    it('answers an ANSWERED refusal through the callable’s own answer', async () => {
      const { ports } = edgePorts();
      const handler = callableEdge(
        {
          callable: Callables.PublishStreakDefinition,
          failureCode: StreakPublishErrorCode.StoreFailed,
          timeoutSeconds: null,
          answer: (refusal) => ({
            streakPublishOutcome: 'REFUSED',
            errorCode: refusal.errorCode,
          }),
        },
        ports,
        async () => Result.err(StreakPublishError.stale(2, 3)),
      );
      await expect(handler(request({}))).resolves.toEqual({
        streakPublishOutcome: 'REFUSED',
        errorCode: 'LOYALTY_STREAK_PUBLISH_STALE',
      });
    });

    it('passes a decoder’s own HttpsError through untouched, untracked', async () => {
      const { ports, tracked } = edgePorts();
      const own = new HttpsError('permission-denied', 'Sysadmin only', {
        errorCode: 'OPS_BACKFILL_FORBIDDEN',
      });
      const handler = callableEdge(spec, ports, async () => {
        throw own;
      });
      expect(await rejection(handler(request({})))).toBe(own);
      expect(tracked).toEqual([]);
    });

    it('answers an infrastructure throw with the callable’s coded failure, tracked once', async () => {
      const { ports, tracked } = edgePorts();
      const boom = Object.assign(new Error('deadline'), { code: 4 });
      const handler = callableEdge(spec, ports, async () => {
        throw boom;
      });
      const thrown = await rejection(handler(request({})));
      expect(thrown.code).toBe('internal');
      expect(thrown.message).toBe('BOOKING_COMMIT_STORE_FAILED');
      expect(thrown.details).toEqual({
        errorCode: 'BOOKING_COMMIT_STORE_FAILED',
      });
      expect(tracked).toEqual([
        { error: boom, context: { callable: 'commitBooking' } },
      ]);
    });

    it('answers it with the platform’s bare INTERNAL when the callable names no failure code', async () => {
      const { ports, tracked } = edgePorts();
      const boom = new Error('boom');
      const handler = callableEdge(
        { ...spec, failureCode: null },
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
            outcome: 'TRANSIENT',
            errorCode: 'unavailable',
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
        outcome: 'PERMANENT',
        errorCode: 'invalid-argument',
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
    expect(budget).toMatchObject({ startedAtUtcMs: 10, limitMs: 100 });
    now = 109;
    expect(budget.spent()).toBe(false);
    now = 110;
    expect(budget.spent()).toBe(true);
  });
});
