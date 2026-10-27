import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ClientIssue, ClientIssueKind, Role } from '@core/components';
import { ClientIssueBatchRefusedReason } from '@core/errors';
import { ClientOperationId } from '@core/primitives';
import { deepFreeze, unwrapErr, unwrapOk } from '@core/testing';
import {
  type ClientIssueInput,
  type ClientIssueReporter,
  ClientIssueSystem,
  type TransportIssueInput,
} from './client-issue.system';

/*
 * The first-party client issue sink's rules (OR-34): the device scrubs and
 * shapes (`scrub`, `frame`, `compose`) and packs (`pack`), the callable's
 * edge admits (`admitBatch` — at most 10 issues and 4 KB, length caps,
 * `collection/id` paths), and each admitted issue is one log line
 * (`logLine`: `warn` for the conditions, `error` typed `ReportedErrorEvent`
 * for the error kinds). Privacy by shape: e-mails, digit runs of four or
 * more and long tokens never leave the device, and the server admits only
 * what is already scrubbed.
 */

const { scrub, frame } = ClientIssueSystem;

/** The three keys WS-5 added — on the wire an old web leaves them out (RU-30). */
const WS5_KEYS: readonly string[] = [
  'operationId',
  'callableName',
  'callableErrorCode',
];

/** An issue as an old web sends it: the nine OR-34 keys alone (RU-30). */
const nineKeys = (one: ClientIssue): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(one).filter(([key]) => !WS5_KEYS.includes(key)),
  );

const OPERATION_ID = unwrapOk(
  ClientOperationId.parse('attempt-0123456789abcdef'),
);

/** A call that never answered as a callable, as the web's callable client reports it. */
const transport = (): ClientIssue =>
  issue({
    clientIssueKind: ClientIssueKind.CallableTransportFailed,
    errorName: 'TypeError',
    operationId: OPERATION_ID,
    callableName: 'commitBooking',
    callableErrorCode: 'functions/internal',
  });

/** An issue with every text absent — a spec overrides what it is about. */
const issue = (fields: Partial<ClientIssue> = {}): ClientIssue => ({
  clientIssueKind: ClientIssueKind.DataDocumentDropped,
  errorName: null,
  documentPath: null,
  fieldName: null,
  routePattern: null,
  topFrame: null,
  scrubbedMessage: null,
  release: null,
  occurrences: 1,
  operationId: null,
  callableName: null,
  callableErrorCode: null,
  ...fields,
});

/** A data refusal as the read guard reports it. */
const dropped = (): ClientIssue =>
  issue({
    errorName: 'REPOSITORY_MALFORMED',
    documentPath: 'appointments/appt-1',
    fieldName: 'seats[1].startMinutes',
    routePattern: '/staff/schedule',
    release: '2026.10.26+1322b78',
    occurrences: 3,
  });

/** An uncaught error with its frame. */
const uncaught = (): ClientIssue =>
  issue({
    clientIssueKind: ClientIssueKind.UncaughtError,
    errorName: 'TypeError',
    routePattern: '/account',
    topFrame:
      'AccountPage.ngOnInit (https://creativo.app/main-5XKQ3RZB.js:1:23456)',
    scrubbedMessage: "Cannot read properties of undefined (reading 'seats')",
    release: '2026.10.26+1322b78',
  });

/** An issue at every cap — what the byte budget is about. */
const heaviest = (): ClientIssue =>
  issue({
    clientIssueKind: ClientIssueKind.UnhandledRejection,
    errorName: 'E'.repeat(64),
    documentPath: `appointments/${'a'.repeat(147)}`,
    fieldName: 'f'.repeat(64),
    routePattern: `/${'a'.repeat(127)}`,
    topFrame: 'x'.repeat(200),
    scrubbedMessage: 'm'.repeat(160),
    release: 'r'.repeat(64),
    occurrences: Number.MAX_SAFE_INTEGER,
  });

const REPORTER: ClientIssueReporter = {
  reporterRoles: [Role.Barber, Role.Admin],
  reporterAuthed: true,
};

const refusal = (
  reason: ClientIssueBatchRefusedReason,
  issueIndex: number | null,
  issueField: string | null,
) => ({
  errorCode: 'CLIENT_ISSUE_BATCH_REFUSED',
  clientIssueBatchRefusedReason: reason,
  issueIndex,
  issueField,
});

/** The refusal of a one-issue batch whose issue carries `fields`. */
const refusedWith = (fields: Record<string, unknown>) =>
  unwrapErr(ClientIssueSystem.admitBatch([{ ...dropped(), ...fields }]));

/** Interesting characters for the masks — letters, digits, separators, `@`, unicode, whitespace. */
const TRICKY = fc.constantFrom(
  'a',
  'Z',
  'k',
  '0',
  '4',
  '9',
  '@',
  '.',
  '-',
  '_',
  '+',
  ' ',
  '\n',
  ' ',
  '(',
  ')',
  '/',
  ':',
  '?',
  '#',
  'N',
  'G',
  't',
  'щ',
  '😀',
  '…',
);
const trickyText = (maxLength: number) =>
  fc.string({ unit: TRICKY, maxLength });

describe('ClientIssueSystem.scrub — what a message may say', () => {
  it('masks an e-mail, a sentence’s closing period left out', () => {
    expect(scrub('No account for maria.ivanova+test@example.co.uk here')).toBe(
      'No account for [email] here',
    );
    expect(scrub('Write to ivan@creativo.bg.')).toBe('Write to [email].');
  });

  it('masks a +359 phone, written any way a phone is written', () => {
    expect(scrub('Call +359 88 812 3456 now')).toBe('Call [digits] now');
    expect(scrub('Call +359888123456 now')).toBe('Call [digits] now');
    expect(scrub('or 0888 123 456')).toBe('or [digits]');
    expect(scrub('or (088) 812-34-56')).toBe('or ([digits]');
  });

  it('masks an OTP-length digit run — and any run of four or more digits', () => {
    expect(scrub('Your code is 482913')).toBe('Your code is [digits]');
    expect(scrub('code 1234')).toBe('code [digits]');
    expect(scrub('from 10.0.0.12')).toBe('from [digits]');
    // A run counts its digits, however it is written…
    expect(scrub('slots 12 - 34')).toBe('slots [digits]');
    // …and three digits are not data: a status, a count.
    expect(scrub('HTTP 404 after 3 tries')).toBe('HTTP 404 after 3 tries');
    expect(scrub('steps 1-2-3 (of 9)')).toBe('steps 1-2-3 (of 9)');
  });

  it('masks a JWT-like token, segment by segment, and a uid', () => {
    expect(
      scrub(
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c expired',
      ),
    ).toBe('Bearer [token].[token].[token] expired');
    expect(scrub('uid kX9fQ2mZ7pL1rT4vB8nC3dE6 missing')).toBe(
      'uid [token] missing',
    );
  });

  it('keeps a long word and an Angular error code — code, not data', () => {
    expect(scrub('NG0100: ExpressionChangedAfterItHasBeenCheckedError')).toBe(
      'NG0100: ExpressionChangedAfterItHasBeenCheckedError',
    );
    expect(scrub('NG04002: Cannot match any routes')).toBe(
      'NG04002: Cannot match any routes',
    );
    expect(scrub('Error: NG0200 (circular)')).toBe('Error: NG0200 (circular)');
    // A longer run after NG0 is no Angular code, nor is one inside a word.
    expect(scrub('NG012345 and xNG0100')).toBe('NG[digits] and xNG[digits]');
  });

  it('collapses whitespace to single spaces, trimmed', () => {
    expect(scrub('  Loading\n\tchunk   failed  ')).toBe('Loading chunk failed');
    expect(scrub('   ')).toBe('');
  });

  it('caps the message at 160 characters, a cut one ending in …', () => {
    const scrubbed = scrub('word '.repeat(60));
    expect(scrubbed).toHaveLength(160);
    expect(scrubbed.endsWith('…')).toBe(true);
    expect(scrubbed).not.toMatch(/\s…$/);
    expect(scrub('m'.repeat(160))).toBe('m'.repeat(160));
    expect(scrub('m'.repeat(161))).toBe(`${'m'.repeat(159)}…`);
  });

  it('never cuts between the halves of a surrogate pair', () => {
    const scrubbed = scrub('😀'.repeat(100));
    expect(scrubbed).toBe(`${'😀'.repeat(79)}…`);
  });

  it('reads a long text only to its window, its last partial word dropped — half an e-mail never escapes', () => {
    // Ten long tokens shrink to ten marks, so the text at the window's edge
    // would reach the output: the e-mail the window cuts in half must not.
    const tokens = `${'a1'.repeat(50)} `.repeat(10);
    const scrubbed = scrub(`${tokens}maria.ivanova@example.com and more`);
    expect(scrubbed).toBe(`${'[token] '.repeat(10).trimEnd()}…`);
    expect(scrubbed).not.toContain('maria');
    expect(scrub(`${'a '.repeat(3000)}maria@example.com`)).not.toContain('@');
  });

  it('is idempotent, capped, and leaves no e-mail and no digit run behind', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          trickyText(400),
          trickyText(3000),
          fc.string({ unit: 'binary', maxLength: 400 }),
        ),
        (text) => {
          const once = scrub(text);
          expect(scrub(once)).toBe(once);
          expect(once.length).toBeLessThanOrEqual(160);
          expect(once.replace(/NG0\d{3,4}/g, '')).not.toMatch(/\d{4}/);
          expect(once).not.toMatch(
            /[A-Za-z0-9._%+-]@[A-Za-z0-9-]+\.[A-Za-z0-9-]/,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('ClientIssueSystem.frame — what a stack frame may say', () => {
  it('keeps the location, digits included, and drops the leading `at `', () => {
    expect(
      frame('    at Foo.bar (https://creativo.app/main-ABC123.js:1:23456)'),
    ).toBe('Foo.bar (https://creativo.app/main-ABC123.js:1:23456)');
    expect(
      frame('handleClick@https://creativo.app/chunk-5XKQ3RZB.js:1:2345'),
    ).toBe('handleClick@https://creativo.app/chunk-5XKQ3RZB.js:1:2345');
    expect(frame('at at  foo')).toBe('foo');
  });

  it('drops a URL’s query and fragment, and masks e-mails and long tokens', () => {
    expect(frame('at f (https://creativo.app/a.js?token=abc #x:1:2)')).toBe(
      'f (https://creativo.app/a.js :1:2)',
    );
    expect(frame('at g (https://creativo.app/a.js?v=1#x:1:2)')).toBe(
      'g (https://creativo.app/a.js:1:2)',
    );
    expect(frame('at x (https://a.bg/u/maria@example.com/x.js:1:2)')).toBe(
      'x (https://a.bg/u/[email]/x.js:1:2)',
    );
    expect(
      frame(
        'at y (blob:https://creativo.app/0f8fad5b-d9cb-469f-a165-70867728950e:1:2)',
      ),
    ).toBe('y (blob:https://creativo.app/[token]:1:2)');
  });

  it('caps the frame at 200 characters', () => {
    expect(frame('x'.repeat(200))).toBe('x'.repeat(200));
    expect(frame('x'.repeat(201))).toBe(`${'x'.repeat(199)}…`);
    expect(frame(`${'f '.repeat(2000)}tail`)).toHaveLength(200);
  });

  it('is idempotent and capped', () => {
    fc.assert(
      fc.property(fc.oneof(trickyText(400), trickyText(3000)), (text) => {
        const once = frame(text);
        expect(frame(once)).toBe(once);
        expect(once.length).toBeLessThanOrEqual(200);
        expect(once).not.toMatch(/[?#]/);
      }),
      { numRuns: 300 },
    );
  });
});

describe('ClientIssueSystem.fingerprint — one issue, one key', () => {
  it('is 8 hex digits, the same every time and on every device', () => {
    const key = ClientIssueSystem.fingerprint(dropped());
    expect(key).toMatch(/^[0-9a-f]{8}$/);
    expect(ClientIssueSystem.fingerprint(dropped())).toBe(key);
    // Pinned: the web's reporter and the server must agree on it.
    expect(key).toBe(FINGERPRINT_OF_DROPPED);
  });

  it('ignores the count and the build — the same fault seen again is the same issue', () => {
    const key = ClientIssueSystem.fingerprint(dropped());
    expect(
      ClientIssueSystem.fingerprint({
        ...dropped(),
        occurrences: 99,
        release: 'next',
      }),
    ).toBe(key);
  });

  it('tells every identity field apart, and a field boundary', () => {
    const keys = new Set(
      [
        issue(),
        issue({ clientIssueKind: ClientIssueKind.DataDocumentRefused }),
        issue({ errorName: 'Error' }),
        issue({ errorName: '' }),
        issue({ documentPath: 'appointments/appt-1' }),
        issue({ fieldName: 'seats' }),
        issue({ routePattern: '/book' }),
        issue({ topFrame: 'f (a.js:1:2)' }),
        issue({ scrubbedMessage: 'boom' }),
        issue({ errorName: 'ab', documentPath: 'c' }),
        issue({ errorName: 'a', documentPath: 'bc' }),
      ].map(ClientIssueSystem.fingerprint),
    );
    expect(keys.size).toBe(11);
  });

  // RU-30: the callable and its code join the identity only where they
  // exist — every OR-34 issue keeps its key (FINGERPRINT_OF_DROPPED above);
  // the operation id never does (one per attempt: it would defeat the dedupe).
  it('mixes the callable and its code only when either is set, and never the operation id', () => {
    const plain = ClientIssueSystem.fingerprint(issue());
    expect(
      ClientIssueSystem.fingerprint(issue({ operationId: OPERATION_ID })),
    ).toBe(plain);
    const keys = new Set(
      [
        issue(),
        issue({ callableName: 'commitBooking' }),
        issue({ callableErrorCode: 'commitBooking' }),
        issue({ callableName: 'commitBooking', callableErrorCode: 'x' }),
        issue({ callableName: 'commitBookin', callableErrorCode: 'gx' }),
      ].map(ClientIssueSystem.fingerprint),
    );
    expect(keys.size).toBe(5);
    expect(
      ClientIssueSystem.fingerprint({ ...transport(), operationId: null }),
    ).toBe(ClientIssueSystem.fingerprint(transport()));
  });
});

describe('ClientIssueSystem.compose — the issue a device sends', () => {
  const input = (fields: Partial<ClientIssueInput> = {}): ClientIssueInput => ({
    clientIssueKind: ClientIssueKind.UncaughtError,
    errorName: 'TypeError',
    documentPath: null,
    fieldName: null,
    routePattern: '/account',
    topFrame:
      '    at AccountPage.ngOnInit (https://creativo.app/main-5XKQ3RZB.js?v=2:1:23456)',
    message: "Cannot read properties of undefined (reading 'seats')",
    release: '2026.10.26+1322b78',
    ...fields,
  });

  it('scrubs the message, frames the frame, keeps the shaped parts, seen once', () => {
    expect(ClientIssueSystem.compose(input())).toEqual(uncaught());
    expect(
      ClientIssueSystem.compose(
        input({
          clientIssueKind: ClientIssueKind.DataDocumentRefused,
          errorName: 'REPOSITORY_MALFORMED',
          documentPath: 'clientStats/c-1/restricted/money',
          fieldName: 'seats[1].startMinutes',
          topFrame: null,
          message: 'Refused for maria@example.com, code 482913',
        }),
      ),
    ).toEqual(
      issue({
        clientIssueKind: ClientIssueKind.DataDocumentRefused,
        errorName: 'REPOSITORY_MALFORMED',
        documentPath: 'clientStats/c-1/restricted/money',
        fieldName: 'seats[1].startMinutes',
        routePattern: '/account',
        scrubbedMessage: 'Refused for [email], code [digits]',
        release: '2026.10.26+1322b78',
      }),
    );
  });

  it('drops a part of the wrong shape to null — never refuses', () => {
    expect(
      ClientIssueSystem.compose(
        input({
          errorName: 'not a name!',
          documentPath: 'nope/x',
          fieldName: '1bad',
          routePattern: 'https://creativo.app/account?phone=0888123456',
          topFrame: '   ',
          message: ' \n ',
          release: 'v 1',
        }),
      ),
    ).toEqual(issue({ clientIssueKind: ClientIssueKind.UncaughtError }));
    expect(
      ClientIssueSystem.compose(input({ errorName: 'E'.repeat(65) })).errorName,
    ).toBeNull();
  });

  it('builds only what admission admits', () => {
    const text = fc.option(fc.oneof(trickyText(300), fc.string()), {
      nil: null,
    });
    fc.assert(
      fc.property(
        fc.record({
          clientIssueKind: fc.constantFrom(...Object.values(ClientIssueKind)),
          errorName: text,
          documentPath: text,
          fieldName: text,
          routePattern: text,
          topFrame: text,
          message: text,
          release: text,
        }),
        (parts) => {
          const composed = ClientIssueSystem.compose(parts);
          expect(ClientIssueSystem.admitBatch([composed])).toEqual({
            ok: true,
            value: [composed],
          });
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('ClientIssueSystem.composeTransport — a call that never answered as a callable', () => {
  const input = (
    fields: Partial<TransportIssueInput> = {},
  ): TransportIssueInput => ({
    callableName: 'commitBooking',
    errorName: 'TypeError',
    callableErrorCode: 'functions/internal',
    operationId: OPERATION_ID,
    release: null,
    ...fields,
  });

  it('names the callable, the thrown name and code and the operation id — no text, no frame, no route, seen once', () => {
    expect(ClientIssueSystem.composeTransport(input())).toEqual(transport());
    expect(
      ClientIssueSystem.composeTransport(
        input({ errorName: null, callableErrorCode: null, operationId: null }),
      ),
    ).toEqual(
      issue({
        clientIssueKind: ClientIssueKind.CallableTransportFailed,
        callableName: 'commitBooking',
      }),
    );
  });

  it('drops a part of the wrong shape or past its cap to null — never refuses', () => {
    expect(
      ClientIssueSystem.composeTransport(
        input({
          callableName: 'Commit Booking',
          errorName: 'not a name!',
          callableErrorCode: 'functions internal',
          release: 'v 1',
        }),
      ),
    ).toEqual(
      issue({
        clientIssueKind: ClientIssueKind.CallableTransportFailed,
        operationId: OPERATION_ID,
      }),
    );
    const capped = ClientIssueSystem.composeTransport(
      input({
        callableName: `c${'a'.repeat(64)}`,
        callableErrorCode: `e${'a'.repeat(64)}`,
      }),
    );
    expect([capped.callableName, capped.callableErrorCode]).toEqual([
      null,
      null,
    ]);
  });

  it('is a condition, never an Error Reporting group', () => {
    const line = ClientIssueSystem.logLine(transport(), REPORTER);
    expect(line).toEqual({
      level: 'warn',
      msg: 'client issue CALLABLE_TRANSPORT_FAILED',
      fields: {
        ...transport(),
        clientIssueFingerprint: ClientIssueSystem.fingerprint(transport()),
        reporterRoles: ['barber', 'admin'],
        reporterAuthed: true,
      },
    });
  });

  it('builds only what admission admits', () => {
    const text = fc.option(fc.oneof(trickyText(80), fc.string()), {
      nil: null,
    });
    fc.assert(
      fc.property(
        fc.record({
          callableName: fc.oneof(
            fc.constantFrom('commitBooking', 'reportClientIssues'),
            fc.string(),
          ),
          errorName: text,
          callableErrorCode: text,
          operationId: fc.constantFrom(null, OPERATION_ID),
          release: text,
        }),
        (parts) => {
          const composed = ClientIssueSystem.composeTransport(parts);
          expect(ClientIssueSystem.admitBatch([composed])).toEqual({
            ok: true,
            value: [composed],
          });
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('ClientIssueSystem.admitBatch — the callable’s edge guard', () => {
  it('admits a closed batch as THE SAME array (zero mapping)', () => {
    const batch = [dropped(), uncaught(), heaviest()];
    expect(unwrapOk(ClientIssueSystem.admitBatch(batch))).toBe(batch);
  });

  it('refuses what is not a non-empty array — SHAPE, the batch’s own', () => {
    for (const raw of [{}, null, 'issues', 42, []]) {
      expect(unwrapErr(ClientIssueSystem.admitBatch(raw))).toEqual(
        refusal(ClientIssueBatchRefusedReason.Shape, null, null),
      );
    }
  });

  it('takes at most 10 issues — TOO_MANY past them', () => {
    expect(
      ClientIssueSystem.admitBatch(Array.from({ length: 10 }, dropped)).ok,
    ).toBe(true);
    expect(
      unwrapErr(
        ClientIssueSystem.admitBatch(Array.from({ length: 11 }, dropped)),
      ),
    ).toEqual(refusal(ClientIssueBatchRefusedReason.TooMany, null, null));
  });

  it('weighs at most 4 KB of JSON, in UTF-8 bytes — TOO_LARGE past them', () => {
    expect(ClientIssueSystem.admitBatch([heaviest(), heaviest()]).ok).toBe(
      true,
    );
    expect(
      unwrapErr(
        ClientIssueSystem.admitBatch(Array.from({ length: 5 }, heaviest)),
      ),
    ).toEqual(refusal(ClientIssueBatchRefusedReason.TooLarge, null, null));
    // Ten Cyrillic messages: under 4096 code units, over 4096 bytes — sent
    // as an old web's nine-key issues, so the batch keeps its OR-34 weight
    // (the weight is the payload's as sent, RU-30).
    const cyrillic = Array.from({ length: 10 }, () =>
      nineKeys(issue({ scrubbedMessage: 'щ'.repeat(160) })),
    );
    expect(JSON.stringify(cyrillic).length).toBeLessThan(4096);
    expect(unwrapErr(ClientIssueSystem.admitBatch(cyrillic))).toEqual(
      refusal(ClientIssueBatchRefusedReason.TooLarge, null, null),
    );
    // Four bytes for each astral character.
    const astral = Array.from({ length: 10 }, () =>
      nineKeys(issue({ scrubbedMessage: '😀'.repeat(80) })),
    );
    expect(JSON.stringify(astral).length).toBeLessThan(4096);
    expect(ClientIssueSystem.admitBatch(astral).ok).toBe(false);
  });

  it('refuses an issue that is no record, naming its index', () => {
    expect(
      unwrapErr(ClientIssueSystem.admitBatch([dropped(), 'boom'])),
    ).toEqual(refusal(ClientIssueBatchRefusedReason.Shape, 1, null));
    expect(unwrapErr(ClientIssueSystem.admitBatch([[]]))).toEqual(
      refusal(ClientIssueBatchRefusedReason.Shape, 0, null),
    );
  });

  it('holds every issue to exactly the struct’s keys', () => {
    const missing = Object.fromEntries(
      Object.entries(dropped()).filter(([key]) => key !== 'release'),
    );
    expect(unwrapErr(ClientIssueSystem.admitBatch([missing]))).toEqual(
      refusal(ClientIssueBatchRefusedReason.Shape, 0, 'release'),
    );
    // One key more is refused without echoing the caller's key.
    expect(refusedWith({ uid: 'u-client' })).toEqual(
      refusal(ClientIssueBatchRefusedReason.Shape, 0, null),
    );
  });

  // RU-30: on the wire the three WS-5 keys are optional, so an old web's
  // nine-key batch still lands after the functions deploy.
  it('admits an old web’s nine-key issue, each absent WS-5 key read as null — a copy, the payload untouched', () => {
    const old = deepFreeze([nineKeys(dropped()), nineKeys(uncaught())]);
    const admitted = unwrapOk(ClientIssueSystem.admitBatch(old));
    expect(admitted).toEqual([dropped(), uncaught()]);
    expect(admitted).not.toBe(old);
    for (const one of admitted) {
      expect(Object.keys(one)).toEqual([...ClientIssue.FIELDS]);
    }
    expect(Object.keys(old[0] as object)).toHaveLength(9);
  });

  it('admits the nine keys and any subset of the WS-5 three, the rest read as null', () => {
    const full = transport();
    const subsets: readonly (readonly string[])[] = [
      ['operationId'],
      ['callableName'],
      ['callableErrorCode'],
      ['operationId', 'callableName'],
      ['callableName', 'callableErrorCode'],
      ['operationId', 'callableErrorCode'],
    ];
    for (const kept of subsets) {
      const raw = Object.fromEntries(
        Object.entries(full).filter(
          ([key]) => !WS5_KEYS.includes(key) || kept.includes(key),
        ),
      );
      const admitted = unwrapOk(ClientIssueSystem.admitBatch([raw]));
      expect(admitted).toEqual([
        {
          ...full,
          operationId: kept.includes('operationId') ? full.operationId : null,
          callableName: kept.includes('callableName')
            ? full.callableName
            : null,
          callableErrorCode: kept.includes('callableErrorCode')
            ? full.callableErrorCode
            : null,
        },
      ]);
    }
    // A batch mixing old and new issues is admitted whole, each as the struct.
    expect(
      unwrapOk(ClientIssueSystem.admitBatch([full, nineKeys(dropped())])),
    ).toEqual([full, dropped()]);
  });

  it('refuses a present WS-5 key of the wrong type, shape or length, naming it', () => {
    const cases: readonly (readonly [
      string,
      unknown,
      ClientIssueBatchRefusedReason,
    ])[] = [
      ['operationId', 42, ClientIssueBatchRefusedReason.Shape],
      ['operationId', 'short', ClientIssueBatchRefusedReason.Shape],
      ['operationId', 'a b'.repeat(8), ClientIssueBatchRefusedReason.Shape],
      ['operationId', '', ClientIssueBatchRefusedReason.Shape],
      ['operationId', 'a'.repeat(65), ClientIssueBatchRefusedReason.TooLarge],
      ['callableName', false, ClientIssueBatchRefusedReason.Shape],
      ['callableName', 'CommitBooking', ClientIssueBatchRefusedReason.Shape],
      ['callableName', 'commit-booking', ClientIssueBatchRefusedReason.Shape],
      ['callableName', 'c'.repeat(65), ClientIssueBatchRefusedReason.TooLarge],
      ['callableErrorCode', {}, ClientIssueBatchRefusedReason.Shape],
      ['callableErrorCode', '/x', ClientIssueBatchRefusedReason.Shape],
      [
        'callableErrorCode',
        'e'.repeat(65),
        ClientIssueBatchRefusedReason.TooLarge,
      ],
    ];
    for (const [field, value, reason] of cases) {
      // Present on a full issue…
      expect(refusedWith({ [field]: value })).toEqual(
        refusal(reason, 0, field),
      );
      // …and alone beside an old web's nine keys.
      expect(
        unwrapErr(
          ClientIssueSystem.admitBatch([
            { ...nineKeys(dropped()), [field]: value },
          ]),
        ),
      ).toEqual(refusal(reason, 0, field));
    }
  });

  it('still refuses a missing OR-34 key and an unknown key on a nine-key issue', () => {
    const missing = Object.fromEntries(
      Object.entries(nineKeys(dropped())).filter(([key]) => key !== 'topFrame'),
    );
    expect(unwrapErr(ClientIssueSystem.admitBatch([missing]))).toEqual(
      refusal(ClientIssueBatchRefusedReason.Shape, 0, 'topFrame'),
    );
    expect(
      unwrapErr(
        ClientIssueSystem.admitBatch([
          { ...nineKeys(dropped()), uid: 'u-client' },
        ]),
      ),
    ).toEqual(refusal(ClientIssueBatchRefusedReason.Shape, 0, null));
  });

  it('refuses an unknown kind and a value of the wrong type', () => {
    expect(refusedWith({ clientIssueKind: 'SOMETHING' })).toEqual(
      refusal(ClientIssueBatchRefusedReason.Shape, 0, 'clientIssueKind'),
    );
    expect(refusedWith({ errorName: 5 })).toEqual(
      refusal(ClientIssueBatchRefusedReason.Shape, 0, 'errorName'),
    );
    expect(refusedWith({ release: '' })).toEqual(
      refusal(ClientIssueBatchRefusedReason.Shape, 0, 'release'),
    );
  });

  it('caps every text — TOO_LARGE, checked before its shape', () => {
    const caps = ClientIssueSystem.CAPS;
    expect(caps).toEqual({
      errorName: 64,
      documentPath: 160,
      fieldName: 64,
      routePattern: 128,
      topFrame: 200,
      scrubbedMessage: 160,
      release: 64,
      callableName: 64,
      callableErrorCode: 64,
    });
    for (const [field, cap] of Object.entries(caps)) {
      expect(refusedWith({ [field]: '!'.repeat(cap + 1) })).toEqual(
        refusal(ClientIssueBatchRefusedReason.TooLarge, 0, field),
      );
    }
  });

  it('admits a document path as `collection/id`, or a subcollection’s', () => {
    for (const documentPath of [
      'appointments/appt-1',
      'barberBusy/b-ivan__2026-10-26',
      'clientStats/c-1/restricted/money',
      'users/u-1/notifications/n-1',
    ]) {
      expect(ClientIssueSystem.admitBatch([issue({ documentPath })]).ok).toBe(
        true,
      );
    }
    for (const documentPath of [
      'appointments',
      'appointments/a/b',
      'unknown/x',
      'appointments/appt-1/notes/n-1',
      'appointments/.',
      'appointments/..',
      'appointments/__x__',
      'appointments/a b',
      'appointments/щ',
      'appointments/',
    ]) {
      expect(refusedWith({ documentPath })).toEqual(
        refusal(ClientIssueBatchRefusedReason.Shape, 0, 'documentPath'),
      );
    }
  });

  it('admits a field path, a route pattern and a build of their shapes only', () => {
    const shapes: readonly (readonly [string, string, string])[] = [
      ['errorName', 'script-src-elem', 'Type Error'],
      ['fieldName', 'seats[12].startMinutes', 'seats['],
      ['routePattern', '/', 'staff'],
      ['routePattern', '/account/visits/:visitId', '/book?phone=1'],
      ['routePattern', '/**', '/Account/Ab12Cd'],
      ['release', '1.0.0-rc.1+abc', 'v 1'],
    ];
    for (const [field, good, bad] of shapes) {
      expect(ClientIssueSystem.admitBatch([issue({ [field]: good })]).ok).toBe(
        true,
      );
      expect(refusedWith({ [field]: bad })).toEqual(
        refusal(ClientIssueBatchRefusedReason.Shape, 0, field),
      );
    }
  });

  it('refuses a message that is not scrubbed and a frame that is not framed', () => {
    expect(refusedWith({ scrubbedMessage: 'call 0888123456' })).toEqual(
      refusal(ClientIssueBatchRefusedReason.Shape, 0, 'scrubbedMessage'),
    );
    expect(refusedWith({ scrubbedMessage: 'two  spaces' })).toEqual(
      refusal(ClientIssueBatchRefusedReason.Shape, 0, 'scrubbedMessage'),
    );
    expect(refusedWith({ topFrame: 'at f (a.js:1:2)' })).toEqual(
      refusal(ClientIssueBatchRefusedReason.Shape, 0, 'topFrame'),
    );
    expect(refusedWith({ topFrame: 'f (a.js?token=x:1:2)' })).toEqual(
      refusal(ClientIssueBatchRefusedReason.Shape, 0, 'topFrame'),
    );
  });

  it('counts occurrences as a positive whole number', () => {
    for (const occurrences of [0, -1, 1.5, '1', null, Number.NaN, 2 ** 53]) {
      expect(refusedWith({ occurrences })).toEqual(
        refusal(ClientIssueBatchRefusedReason.Shape, 0, 'occurrences'),
      );
    }
  });

  it('reports the FIRST fault, in batch then struct order', () => {
    expect(
      unwrapErr(
        ClientIssueSystem.admitBatch([
          dropped(),
          { ...dropped(), fieldName: '1bad', release: 'v 1' },
          'boom',
        ]),
      ),
    ).toEqual(refusal(ClientIssueBatchRefusedReason.Shape, 1, 'fieldName'));
  });
});

describe('ClientIssueSystem.pack — the reporter’s batches', () => {
  it('packs in order, at most 10 to a batch', () => {
    const issues = Array.from({ length: 25 }, (_, i) =>
      issue({ occurrences: i + 1 }),
    );
    const batches = ClientIssueSystem.pack(issues);
    expect(batches.map((batch) => batch.length)).toEqual([10, 10, 5]);
    expect(batches.flat()).toEqual(issues);
    expect(ClientIssueSystem.pack([])).toEqual([]);
  });

  it('begins a batch before the 4 KB budget runs out', () => {
    // An issue at every cap weighs over a kilobyte: three to a batch.
    expect(JSON.stringify(heaviest()).length).toBeGreaterThan(1024);
    const batches = ClientIssueSystem.pack(Array.from({ length: 7 }, heaviest));
    expect(batches.map((batch) => batch.length)).toEqual([3, 3, 1]);
    for (const batch of batches) {
      expect(ClientIssueSystem.admitBatch(batch).ok).toBe(true);
    }
  });

  it('packs only batches admission admits, losing nothing', () => {
    const text = fc.option(trickyText(300), { nil: null });
    const anyInput = fc.record({
      clientIssueKind: fc.constantFrom(...Object.values(ClientIssueKind)),
      errorName: fc.option(fc.constantFrom('TypeError', 'E'.repeat(64)), {
        nil: null,
      }),
      documentPath: text,
      fieldName: text,
      routePattern: text,
      topFrame: text,
      message: text,
      release: fc.option(fc.constantFrom('1.0.0', 'r'.repeat(64)), {
        nil: null,
      }),
    });
    fc.assert(
      fc.property(fc.array(anyInput, { maxLength: 40 }), (inputs) => {
        const issues = inputs.map(ClientIssueSystem.compose);
        const batches = ClientIssueSystem.pack(issues);
        expect(batches.flat()).toEqual(issues);
        for (const batch of batches) {
          expect(ClientIssueSystem.admitBatch(batch).ok).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('ClientIssueSystem.logLine — one Cloud Logging line', () => {
  it('logs a condition at warn, its fields at the root beside its fingerprint and reporter', () => {
    const line = ClientIssueSystem.logLine(dropped(), REPORTER);
    expect(line).toEqual({
      level: 'warn',
      msg: 'client issue DATA_DOCUMENT_DROPPED',
      fields: {
        ...dropped(),
        clientIssueFingerprint: FINGERPRINT_OF_DROPPED,
        reporterRoles: ['barber', 'admin'],
        reporterAuthed: true,
      },
    });
    for (const clientIssueKind of [
      ClientIssueKind.DataDocumentRefused,
      ClientIssueKind.ChunkLoadFailed,
      ClientIssueKind.CspViolation,
    ]) {
      const condition = ClientIssueSystem.logLine(
        issue({ clientIssueKind }),
        REPORTER,
      );
      expect(condition.level).toBe('warn');
      expect(condition.fields).not.toHaveProperty('@type');
    }
  });

  it('logs an error kind at error, typed for Error Reporting, its message a one-frame stack', () => {
    const line = ClientIssueSystem.logLine(uncaught(), {
      reporterRoles: [],
      reporterAuthed: false,
    });
    expect(line).toEqual({
      level: 'error',
      msg: "TypeError: Cannot read properties of undefined (reading 'seats')\n    at AccountPage.ngOnInit (https://creativo.app/main-5XKQ3RZB.js:1:23456)",
      fields: {
        ...uncaught(),
        clientIssueFingerprint: ClientIssueSystem.fingerprint(uncaught()),
        reporterRoles: [],
        reporterAuthed: false,
        '@type':
          'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
        serviceContext: { service: 'web', version: '2026.10.26+1322b78' },
      },
    });
    expect(ClientIssueSystem.REPORTED_ERROR_EVENT).toBe(line.fields['@type']);
  });

  it('gives a frameless error a report location (its route and kind, line unknown) and an unknown build', () => {
    const bare = issue({ clientIssueKind: ClientIssueKind.UnhandledRejection });
    const line = ClientIssueSystem.logLine(bare, REPORTER);
    expect(line.level).toBe('error');
    expect(line.msg).toBe('Error: UNHANDLED_REJECTION');
    expect(line.fields['serviceContext']).toEqual({
      service: 'web',
      version: 'unknown',
    });
    expect(line.fields['context']).toEqual({
      reportLocation: {
        filePath: '/',
        lineNumber: 0,
        functionName: 'UNHANDLED_REJECTION',
      },
    });
    const routed = ClientIssueSystem.logLine(
      { ...bare, routePattern: '/book', scrubbedMessage: 'boom' },
      REPORTER,
    );
    expect(routed.msg).toBe('Error: boom');
    expect(routed.fields['context']).toEqual({
      reportLocation: {
        filePath: '/book',
        lineNumber: 0,
        functionName: 'UNHANDLED_REJECTION',
      },
    });
  });
});

describe('ClientIssueSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const batch = deepFreeze([dropped(), uncaught(), heaviest()]);
    const reporter = deepFreeze({
      reporterRoles: [Role.Barber],
      reporterAuthed: true,
    });
    const input = deepFreeze({
      clientIssueKind: ClientIssueKind.UncaughtError,
      errorName: 'TypeError',
      documentPath: null,
      fieldName: null,
      routePattern: '/book',
      topFrame: 'at f (a.js:1:2)',
      message: 'boom 1234',
      release: null,
    });
    const transportInput = deepFreeze({
      callableName: 'commitBooking',
      errorName: 'TypeError',
      callableErrorCode: 'functions/internal',
      operationId: OPERATION_ID,
      release: null,
    });
    const old = deepFreeze([nineKeys(dropped()), nineKeys(transport())]);
    const run = () => ({
      scrub: scrub('mail maria@example.com 0888123456'),
      frame: frame('at f (a.js?x=1:1:2)'),
      fingerprint: ClientIssueSystem.fingerprint(batch[1] as ClientIssue),
      compose: ClientIssueSystem.compose(input),
      composeTransport: ClientIssueSystem.composeTransport(transportInput),
      admitted: ClientIssueSystem.admitBatch(batch),
      admittedOld: ClientIssueSystem.admitBatch(old),
      packed: ClientIssueSystem.pack(batch),
      lines: batch.map((one) => ClientIssueSystem.logLine(one, reporter)),
    });
    const once = run();
    expect(run()).toEqual(once);
  });
});

/** `fingerprint(dropped())` — pinned so the device and the server can never drift apart. */
const FINGERPRINT_OF_DROPPED = '97594ab2';
