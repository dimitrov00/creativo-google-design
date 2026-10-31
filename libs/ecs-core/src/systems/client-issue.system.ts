import { ClientIssue, ClientIssueKind, type Roles } from '@core/components';
import { Collections, Subcollections } from '@core/entities';
import { ClientIssueBatchRefusedReason, ClientIssueError } from '@core/errors';
import { ClientOperationId, Result, StoredFields, Tag } from '@core/primitives';
import { CanonicalJsonSystem } from './canonical-json.system';

/**
 * What the web knows of an issue before it is shaped — every text raw, any
 * length, `null` when the issue has none ({@link ClientIssueSystem.compose}
 * shapes it). `message` is the RAW message; it leaves the device only
 * scrubbed.
 */
export type ClientIssueInput = {
  readonly clientIssueKind: ClientIssueKind;
  readonly errorName: string | null;
  readonly documentPath: string | null;
  readonly fieldName: string | null;
  readonly routePattern: string | null;
  readonly topFrame: string | null;
  readonly message: string | null;
  readonly release: string | null;
};

/**
 * What the web's callable client knows of a call that never answered as a
 * callable (audit-hardening WS-5): the callable it dialled, what was thrown
 * (its name; the `code` it carried, if any — `callableErrorCode`), the
 * operation id the call went out with and the build. No message and no
 * stack: a transport failure's text is the browser's, not ours to send
 * ({@link ClientIssueSystem.composeTransport} shapes it).
 */
export type TransportIssueInput = {
  readonly callableName: string;
  readonly errorName: string | null;
  readonly callableErrorCode: string | null;
  readonly operationId: ClientOperationId | null;
  readonly release: string | null;
};

/**
 * Who reported a batch, as the callable's edge reads it off the call's auth
 * context — never off the payload, and never the uid (OR-34, privacy by
 * shape): the caller's known roles and whether the call was signed in at all.
 */
export type ClientIssueReporter = {
  /** The token's known roles (`Roles.known` over its claim) — empty for a client or a signed-out caller. */
  readonly reporterRoles: Roles;
  /** Whether the call carried a Firebase Auth token. */
  readonly reporterAuthed: boolean;
};

/**
 * One Cloud Logging line for one issue — the three arguments of the `Log`
 * port, in order. `fields` is the entry's `jsonPayload`: the issue's own
 * fields at its root, and, for the error kinds, Error Reporting's typed
 * `ReportedErrorEvent` keys beside them (a third-party payload, nested as
 * Error Reporting reads it).
 */
export type ClientIssueLogLine = {
  readonly level: 'warn' | 'error';
  readonly msg: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

/** A free text field of the issue — the nine that hold a string or `null`, each under its own cap. */
type TextFieldName = Exclude<
  keyof ClientIssue,
  'clientIssueKind' | 'occurrences' | 'operationId'
>;

/** A text field's admission rule: its cap in UTF-16 code units, and its shape. */
type TextRule = {
  readonly issueField: TextFieldName | 'operationId';
  readonly cap: number;
  readonly isShaped: (text: string) => boolean;
};

/** The most issues one call takes (OR-34). */
const MAX_ISSUES = 10;
/** The most bytes one call's batch may weigh — its JSON, in UTF-8 (OR-34). */
const MAX_BYTES = 4 * 1024;

/**
 * Each text field's cap, in UTF-16 code units. `scrubbedMessage` is the
 * ruling's 160; the others hold what their shapes need with room to spare —
 * and ten issues at every cap weigh more than {@link MAX_BYTES}, which is
 * why the reporter packs by bytes ({@link ClientIssueSystem.pack}).
 */
const CAPS = {
  errorName: 64,
  documentPath: 160,
  fieldName: 64,
  routePattern: 128,
  topFrame: 200,
  scrubbedMessage: 160,
  release: 64,
  callableName: 64,
  callableErrorCode: 64,
} as const satisfies Readonly<Record<TextFieldName, number>>;

/** The longest operation id — the `ClientOperationId` key's own bound. */
const OPERATION_ID_CAP = 64;

/**
 * The keys an issue on the WIRE may leave out (RU-30): the three WS-5 added.
 * An old web's issue carries the nine OR-34 keys alone and is admitted with
 * these `null`; the struct itself always holds all twelve.
 */
const WIRE_OPTIONAL_FIELDS = [
  'operationId',
  'callableName',
  'callableErrorCode',
] as const satisfies readonly (keyof ClientIssue)[];

/**
 * How much of a raw text {@link scrub} and {@link frame} read — the e-mail
 * pattern backtracks, so it never sees more than this, and a megabyte of
 * message costs what a kilobyte does. A cut text loses its last, partial
 * word, so the cut never leaves half an e-mail or half a token behind to
 * escape the masks.
 */
const READ_WINDOW = 1024;

/** The mark a cut text ends with — inside its cap. */
const ELLIPSIS = '…';

/** Error Reporting's typed log entry (`ReportedErrorEvent`) — the `@type` of the error kinds' lines. */
const REPORTED_ERROR_EVENT =
  'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent';
/** The Error Reporting service every client issue is grouped under. */
const SERVICE = 'web';
/** `serviceContext.version` when the issue names no build. */
const UNKNOWN_RELEASE = 'unknown';

/*
 * The masks — module constants, so compiled once. `replace` resets a global
 * pattern's `lastIndex` itself, and the patterns tested with `test` carry no
 * `g` flag, so no call leaves state behind for the next.
 */

/** Every run of whitespace (the set `trim` strips) — collapsed to one space. */
const WHITESPACE = /\s+/g;
/** The last whitespace and the word after it — where a windowed text is cut. */
const LAST_WORD = /\s\S*$/;
/** An e-mail address: a local part, `@`, a dotted domain (a sentence's closing period left out). */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[A-Za-z0-9-]/g;
/** A run of 20 or more base64url characters — masked when it mixes letters and digits. */
const TOKEN_RUN = /[A-Za-z0-9_-]{20,}/g;
const HAS_DIGIT = /\d/;
const HAS_LETTER = /[A-Za-z]/;
/**
 * An Angular runtime error code (`NG0100`, `NG04002`) — or a run of digits
 * and the separators a phone is written with (`+359 88 123 4567`,
 * `(088) 812-34-56`, a six-digit code, `10.0.0.12`), masked when it holds
 * four digits or more ({@link maskDigits}). Flat on purpose: no quantifier
 * nests inside another, so no input makes it backtrack; and no lookbehind,
 * which an engine without it would refuse to parse, taking the whole tier
 * down with it.
 */
const DIGITS = /NG0\d{3,4}(?!\d)|\+?\d[\d ()./-]*\d/g;
/** The `at ` a V8 frame line starts with — {@link ClientIssueSystem.logLine} writes its own. */
const LEADING_AT = /^(?:at )+/;
/** A URL's query or fragment inside a frame — up to the `:line:col` or the `)`. */
const QUERY = /[?#][^\s:()]*/g;

const EMAIL_MARK = '[email]';
const TOKEN_MARK = '[token]';
const DIGITS_MARK = '[digits]';

/** The thrown value's name, or a CSP report's directive: an identifier, dots and dashes allowed. */
const ERROR_NAME = /^[A-Za-z_$][\w$.-]*$/;
/** One step of a read guard's field path — a name (`startMinutes`)… */
const FIELD_STEP = /^[A-Za-z_$][\w$]*$/;
/** …or a name and an index (`seats[1]`). */
const INDEXED_FIELD_STEP = /^[A-Za-z_$][\w$]*\[\d+\]$/;
/** One segment of a route pattern: lowercase, a `:param` or `**` — never a raw id with capitals. */
const ROUTE_SEGMENT = /^(?:[a-z0-9][a-z0-9-]*|:[A-Za-z][A-Za-z0-9]*|\*\*)$/;
/** A build name: a version, a commit, a build id. */
const RELEASE = /^[\w.+-]+$/;
/** A callable's export name, as `Callables` spells it (`commitBooking`). */
const CALLABLE_NAME = /^[a-z][A-Za-z0-9]*$/;
/** The code a failed call carried (`functions/internal`) — an identifier, `_ . / -` allowed. */
const CALLABLE_ERROR_CODE = /^[A-Za-z][A-Za-z0-9_./-]*$/;
/** A document id as this app writes them: printable ASCII, no `/`. */
const DOC_ID = /^[!-.0-~]+$/;

/** A UTF-16 lead surrogate — a cut is never made right after one. */
function isLeadSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * The text cut to fit `cap` with the {@link ELLIPSIS} as its last
 * character: never between the halves of a surrogate pair, never ending in
 * a space before the mark.
 */
function clip(text: string, cap: number): string {
  let end = Math.min(text.length, cap - ELLIPSIS.length);
  if (end > 0 && isLeadSurrogate(text.charCodeAt(end - 1))) end--;
  return text.slice(0, end).trimEnd() + ELLIPSIS;
}

/**
 * The first {@link READ_WINDOW} code units of a long text, its last
 * partial word dropped (a window with no whitespace stays whole: a single
 * run that long is a token the masks catch).
 */
function windowOf(text: string): string {
  const head = text.slice(0, READ_WINDOW);
  const at = head.search(LAST_WORD);
  return at === -1 ? head : head.slice(0, at);
}

/** A base64url run masked when it mixes letters and digits; a long word or a long number is not a token. */
function maskToken(run: string): string {
  return HAS_DIGIT.test(run) && HAS_LETTER.test(run) ? TOKEN_MARK : run;
}

/**
 * A run of four digits or more masked — a shorter one (a status, a count)
 * kept, and an Angular error code kept when it stands alone (`NG0100`; the
 * tail of a word, `xNG0100`, is digits like any others).
 */
function maskDigits(run: string, offset: number, text: string): string {
  if (run.startsWith('NG')) {
    return offset > 0 && HAS_LETTER.test(text.charAt(offset - 1))
      ? `NG${DIGITS_MARK}`
      : run;
  }
  let digits = 0;
  for (let i = 0; i < run.length; i++) {
    const code = run.charCodeAt(i);
    if (code >= 0x30 && code <= 0x39 && ++digits === 4) return DIGITS_MARK;
  }
  return run;
}

/** The e-mails and the long tokens masked — the masks a message and a frame share. */
function maskEmailsAndTokens(text: string): string {
  const masked = text.includes('@') ? text.replace(EMAIL, EMAIL_MARK) : text;
  return masked.replace(TOKEN_RUN, maskToken);
}

function scrub(text: string): string {
  const cut = text.length > READ_WINDOW;
  const collapsed = (cut ? windowOf(text) : text)
    .replace(WHITESPACE, ' ')
    .trim();
  const masked = maskEmailsAndTokens(collapsed).replace(DIGITS, maskDigits);
  return cut || masked.length > CAPS.scrubbedMessage
    ? clip(masked, CAPS.scrubbedMessage)
    : masked;
}

function frame(text: string): string {
  const cut = text.length > READ_WINDOW;
  // The query goes first, so the collapse after it closes the gap it leaves.
  const collapsed = (cut ? windowOf(text) : text)
    .replace(QUERY, '')
    .replace(WHITESPACE, ' ')
    .trim()
    .replace(LEADING_AT, '');
  const masked = maskEmailsAndTokens(collapsed);
  return cut || masked.length > CAPS.topFrame
    ? clip(masked, CAPS.topFrame)
    : masked;
}

/** A document id Firestore would take: not `.` or `..`, not wrapped in `__…__` (OR-44). */
function isDocId(id: string | undefined): boolean {
  if (id === undefined || !DOC_ID.test(id) || id === '.' || id === '..') {
    return false;
  }
  return !(id.length >= 4 && id.startsWith('__') && id.endsWith('__'));
}

/** A read guard's field path, step by step: `seats[1].startMinutes`. */
function isFieldPath(path: string): boolean {
  for (const step of path.split('.')) {
    if (!FIELD_STEP.test(step) && !INDEXED_FIELD_STEP.test(step)) return false;
  }
  return true;
}

/** A route pattern: `/`, or `/` and segments — never a query, never a URL. */
function isRoutePattern(pattern: string): boolean {
  if (pattern === '/') return true;
  if (!pattern.startsWith('/')) return false;
  for (const segment of pattern.slice(1).split('/')) {
    if (!ROUTE_SEGMENT.test(segment)) return false;
  }
  return true;
}

/**
 * `collection/id` — a top-level collection of the registry and an id — or a
 * subcollection's `collection/id/name/id`, its name from the registry too.
 */
function isDocumentPath(path: string): boolean {
  const segments = path.split('/');
  if (segments.length === 2) {
    return Tag.has(Collections, segments[0]) && isDocId(segments[1]);
  }
  return (
    segments.length === 4 &&
    Tag.has(Collections, segments[0]) &&
    isDocId(segments[1]) &&
    Tag.has(Subcollections, segments[2]) &&
    isDocId(segments[3])
  );
}

const ERROR_NAME_RULE: TextRule = {
  issueField: 'errorName',
  cap: CAPS.errorName,
  isShaped: (text) => ERROR_NAME.test(text),
};
const DOCUMENT_PATH_RULE: TextRule = {
  issueField: 'documentPath',
  cap: CAPS.documentPath,
  isShaped: isDocumentPath,
};
const FIELD_NAME_RULE: TextRule = {
  issueField: 'fieldName',
  cap: CAPS.fieldName,
  isShaped: isFieldPath,
};
const ROUTE_PATTERN_RULE: TextRule = {
  issueField: 'routePattern',
  cap: CAPS.routePattern,
  isShaped: isRoutePattern,
};
/*
 * A frame and a message are admitted only as their own normal form: shaping
 * them again changes nothing (both are idempotent), so a device that skipped
 * the masks is refused, and nothing unscrubbed is ever logged.
 */
const TOP_FRAME_RULE: TextRule = {
  issueField: 'topFrame',
  cap: CAPS.topFrame,
  isShaped: (text) => frame(text) === text,
};
const SCRUBBED_MESSAGE_RULE: TextRule = {
  issueField: 'scrubbedMessage',
  cap: CAPS.scrubbedMessage,
  isShaped: (text) => scrub(text) === text,
};
const RELEASE_RULE: TextRule = {
  issueField: 'release',
  cap: CAPS.release,
  isShaped: (text) => RELEASE.test(text),
};

const OPERATION_ID_RULE: TextRule = {
  issueField: 'operationId',
  cap: OPERATION_ID_CAP,
  isShaped: ClientOperationId.is,
};
const CALLABLE_NAME_RULE: TextRule = {
  issueField: 'callableName',
  cap: CAPS.callableName,
  isShaped: (text) => CALLABLE_NAME.test(text),
};
const CALLABLE_ERROR_CODE_RULE: TextRule = {
  issueField: 'callableErrorCode',
  cap: CAPS.callableErrorCode,
  isShaped: (text) => CALLABLE_ERROR_CODE.test(text),
};

/** The OR-34 text fields' rules, in the struct's order — admission reports the first field at fault. */
const TEXT_RULES: readonly TextRule[] = [
  ERROR_NAME_RULE,
  DOCUMENT_PATH_RULE,
  FIELD_NAME_RULE,
  ROUTE_PATTERN_RULE,
  TOP_FRAME_RULE,
  SCRUBBED_MESSAGE_RULE,
  RELEASE_RULE,
];

/** The WS-5 fields' rules, in the struct's order — each checked only when the issue carries its key (RU-30). */
const WIRE_OPTIONAL_RULES: readonly TextRule[] = [
  OPERATION_ID_RULE,
  CALLABLE_NAME_RULE,
  CALLABLE_ERROR_CODE_RULE,
];

/** Whether `field` is one an issue on the wire may leave out. */
function isWireOptional(field: keyof ClientIssue): boolean {
  return (WIRE_OPTIONAL_FIELDS as readonly string[]).includes(field);
}

/** Whether a record carries every key an issue may leave out — then it IS the struct, nothing to fill. */
function hasEveryWireOptional(raw: Readonly<Record<string, unknown>>): boolean {
  for (let i = 0; i < WIRE_OPTIONAL_FIELDS.length; i++) {
    if (!Object.hasOwn(raw, WIRE_OPTIONAL_FIELDS[i] as string)) return false;
  }
  return true;
}

/**
 * An admitted issue that left a WS-5 key out, as the struct: each absent
 * key read as `null` (RU-30) — a new record, the payload untouched.
 */
function filled(raw: Readonly<Record<string, unknown>>): ClientIssue {
  // Admitted key by key: the nine OR-34 keys, and each WS-5 key it carries.
  const issue = raw as ClientIssue;
  return {
    ...issue,
    operationId: Object.hasOwn(raw, 'operationId') ? issue.operationId : null,
    callableName: Object.hasOwn(raw, 'callableName')
      ? issue.callableName
      : null,
    callableErrorCode: Object.hasOwn(raw, 'callableErrorCode')
      ? issue.callableErrorCode
      : null,
  };
}

/** Why a text field is refused — its cap first (so no pattern reads an oversized text), then its shape; `null` admits it. */
function textFault(
  rule: TextRule,
  value: unknown,
): ClientIssueBatchRefusedReason | null {
  if (value === null) return null;
  if (typeof value !== 'string') return ClientIssueBatchRefusedReason.Shape;
  if (value.length > rule.cap) return ClientIssueBatchRefusedReason.TooLarge;
  return value.length > 0 && rule.isShaped(value)
    ? null
    : ClientIssueBatchRefusedReason.Shape;
}

/** `text` when its rule admits it, else `null` — how `compose` keeps a part. */
function kept(rule: TextRule, text: string | null): string | null {
  return text !== null && textFault(rule, text) === null ? text : null;
}

/**
 * The issue at `index` refused, or `null`: the nine OR-34 keys and any of
 * the three WS-5 keys (RU-30) — nothing else — each value of its type,
 * shape and cap.
 */
function issueFault(raw: unknown, index: number): ClientIssueError | null {
  const refuse = (
    reason: ClientIssueBatchRefusedReason,
    issueField: string | null,
  ): ClientIssueError =>
    ClientIssueError.batchRefused(reason, index, issueField);
  if (!StoredFields.isRecord(raw)) {
    return refuse(ClientIssueBatchRefusedReason.Shape, null);
  }
  const fields = ClientIssue.FIELDS;
  let expected = 0;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] as (typeof fields)[number];
    if (Object.hasOwn(raw, field)) expected++;
    else if (!isWireOptional(field)) {
      return refuse(ClientIssueBatchRefusedReason.Shape, field);
    }
  }
  // Every required field is there; one key more is a key the struct does
  // not have — never echoed (its name is the caller's text).
  let keys = 0;
  for (const key in raw) {
    if (Object.hasOwn(raw, key)) keys++;
  }
  if (keys !== expected) {
    return refuse(ClientIssueBatchRefusedReason.Shape, null);
  }
  if (!Tag.has(ClientIssueKind, raw['clientIssueKind'])) {
    return refuse(ClientIssueBatchRefusedReason.Shape, 'clientIssueKind');
  }
  for (let i = 0; i < TEXT_RULES.length; i++) {
    const rule = TEXT_RULES[i] as TextRule;
    const reason = textFault(rule, raw[rule.issueField]);
    if (reason !== null) return refuse(reason, rule.issueField);
  }
  const occurrences = raw['occurrences'];
  if (
    typeof occurrences !== 'number' ||
    !Number.isSafeInteger(occurrences) ||
    occurrences < 1
  ) {
    return refuse(ClientIssueBatchRefusedReason.Shape, 'occurrences');
  }
  for (let i = 0; i < WIRE_OPTIONAL_RULES.length; i++) {
    const rule = WIRE_OPTIONAL_RULES[i] as TextRule;
    if (!Object.hasOwn(raw, rule.issueField)) continue;
    const reason = textFault(rule, raw[rule.issueField]);
    if (reason !== null) return refuse(reason, rule.issueField);
  }
  return null;
}

/**
 * What a value weighs on the wire: its JSON, in UTF-8 bytes
 * (`CanonicalJsonSystem.utf8Bytes`, the one counter — P3-RU-27).
 */
function jsonBytes(value: unknown): number {
  return CanonicalJsonSystem.utf8Bytes(JSON.stringify(value));
}

/** FNV-1a's 32-bit offset basis and prime. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
/** The unit separator closing each field, so `ab|c` and `a|bc` differ. */
const FIELD_END = 0x1f;

/** One field mixed into the hash: its code units (none for `null`, which mixes a 0 instead), then the separator. */
function mix(hash: number, text: string | null): number {
  let h = hash;
  if (text === null) h = Math.imul(h, FNV_PRIME);
  else {
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), FNV_PRIME);
    }
  }
  return Math.imul(h ^ FIELD_END, FNV_PRIME);
}

function fingerprint(issue: ClientIssue): string {
  let h = mix(FNV_OFFSET, issue.clientIssueKind);
  h = mix(h, issue.errorName);
  h = mix(h, issue.documentPath);
  h = mix(h, issue.fieldName);
  h = mix(h, issue.routePattern);
  h = mix(h, issue.topFrame);
  h = mix(h, issue.scrubbedMessage);
  // The callable and its code are identity only where they exist, so every
  // issue without them keeps the key it always had; the operation id never
  // is (one per attempt: it would defeat the dedupe).
  if (issue.callableName !== null || issue.callableErrorCode !== null) {
    h = mix(h, issue.callableName);
    h = mix(h, issue.callableErrorCode);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * The error line's message, written as a one-frame JavaScript stack
 * (`TypeError: … \n    at …`) so Error Reporting reads its type, its
 * text and its location.
 */
function reportedMessage(issue: ClientIssue): string {
  const head = `${issue.errorName ?? 'Error'}: ${issue.scrubbedMessage ?? issue.clientIssueKind}`;
  return issue.topFrame === null ? head : `${head}\n    at ${issue.topFrame}`;
}

/**
 * ClientIssueSystem — THE FIRST-PARTY CLIENT ISSUE SINK'S RULES (OR-34),
 * shared by the device and the callable so the two can never drift: the
 * web's reporter {@link compose}s and {@link pack}s, the callable's edge
 * {@link admitBatch}es, and `reportClientIssues` writes one
 * {@link logLine} per issue. Privacy by shape: a message leaves the device
 * only {@link scrub}bed, a frame only {@link frame}d, a route only as its
 * pattern, and the server admits nothing that is not already in that form.
 * Pure: no I/O, no clock, no mutation of an argument.
 */
export const ClientIssueSystem = {
  MAX_ISSUES,
  MAX_BYTES,
  CAPS,
  REPORTED_ERROR_EVENT,

  /**
   * A message made safe to leave the device: whitespace collapsed, then
   * every e-mail (`[email]`), every run of 20 or more base64url characters
   * that mixes letters and digits — a JWT segment, an API key, a uid
   * (`[token]`) — and every run of four or more digits, phone separators
   * between them allowed (`[digits]`: a phone, an OTP, an IP address)
   * masked; at most 160 characters, a cut one ending in `…`. An Angular
   * runtime error code (`NG0100`) is code, not data, and stays. A long text
   * is read only to its first {@link READ_WINDOW} code units.
   *
   * Idempotent — `scrub(scrub(x)) === scrub(x)` — which is how the callable
   * proves a message was scrubbed: it admits only a message equal to its
   * own scrub.
   */
  scrub,

  /**
   * A stack frame made safe to leave the device: one line, its leading
   * `at ` dropped (the error line writes its own), every URL's query and
   * fragment dropped, e-mails and long tokens masked as {@link scrub} masks
   * them — but its digits KEPT, since `:line:col` is the point of a frame —
   * at most 200 characters. Idempotent, like {@link scrub}.
   */
  frame,

  /**
   * The issue's identity — 8 hex digits of FNV-1a over its kind, name,
   * path, field, route, frame and message, then — only when either is set —
   * its callable and that callable's error code (UTF-16 code units, each
   * field closed by a separator, `null` distinct from any text): the
   * reporter's dedupe key and the log line's grouping key. The count, the
   * build and the operation id are not identity — the same fault seen
   * again, in the next build or on the next attempt, is the same issue.
   */
  fingerprint,

  /**
   * The issue a device sends, shaped from what it knows: the message
   * {@link scrub}bed, the frame {@link frame}d, every other text kept only
   * when it is within its cap and of its shape (a name that is no
   * identifier, a URL where a route pattern belongs, a path that is no
   * `collection/id` — each becomes `null`, never a refusal), seen once.
   * Whatever it builds, {@link admitBatch} admits.
   */
  compose(input: ClientIssueInput): ClientIssue {
    const topFrame = input.topFrame === null ? '' : frame(input.topFrame);
    const message = input.message === null ? '' : scrub(input.message);
    return {
      clientIssueKind: input.clientIssueKind,
      errorName: kept(ERROR_NAME_RULE, input.errorName),
      documentPath: kept(DOCUMENT_PATH_RULE, input.documentPath),
      fieldName: kept(FIELD_NAME_RULE, input.fieldName),
      routePattern: kept(ROUTE_PATTERN_RULE, input.routePattern),
      topFrame: topFrame === '' ? null : topFrame,
      scrubbedMessage: message === '' ? null : message,
      release: kept(RELEASE_RULE, input.release),
      occurrences: 1,
      operationId: null,
      callableName: null,
      callableErrorCode: null,
    };
  },

  /**
   * The issue a callable that never answered as a callable leaves
   * (`CALLABLE_TRANSPORT_FAILED`, audit-hardening WS-5): the callable's
   * name, the thrown value's name and code and the build kept only when
   * each is within its cap and of its shape (else `null`, never a
   * refusal), the operation id as the call sent it, seen once. No message,
   * no frame, no route, no document — a transport failure says which call
   * and which attempt, nothing the browser wrote. Whatever it builds,
   * {@link admitBatch} admits.
   */
  composeTransport(input: TransportIssueInput): ClientIssue {
    return {
      clientIssueKind: ClientIssueKind.CallableTransportFailed,
      errorName: kept(ERROR_NAME_RULE, input.errorName),
      documentPath: null,
      fieldName: null,
      routePattern: null,
      topFrame: null,
      scrubbedMessage: null,
      release: kept(RELEASE_RULE, input.release),
      occurrences: 1,
      operationId: input.operationId,
      callableName: kept(CALLABLE_NAME_RULE, input.callableName),
      callableErrorCode: kept(
        CALLABLE_ERROR_CODE_RULE,
        input.callableErrorCode,
      ),
    };
  },

  /**
   * The callable's edge guard: the payload as received, admitted as the
   * batch it is — THE SAME ARRAY, typed (zero mapping), when every issue
   * carries all twelve keys; else a copy whose issues read each WS-5 key
   * they left out as `null` (an old web's nine-key issue, RU-30) — or
   * refused whole (`CLIENT_ISSUE_BATCH_REFUSED`): `SHAPE` when it is not an
   * array of one or more closed issue structs (a missing OR-34 key or an
   * unknown key, a value of the wrong type, an unknown kind, a name, path,
   * field, route, build, callable, code or operation id of the wrong shape,
   * a frame or a message not in its normal form, a count that is not a
   * positive whole number); `TOO_MANY` past {@link MAX_ISSUES};
   * `TOO_LARGE` for a text past its cap, or a batch whose JSON weighs more
   * than {@link MAX_BYTES} UTF-8 bytes — the payload as sent. Caps are
   * checked before shapes and the issues before the weight, so no pattern
   * and no measure ever reads an unbounded text.
   */
  admitBatch(raw: unknown): Result<readonly ClientIssue[], ClientIssueError> {
    if (!Array.isArray(raw) || raw.length === 0) {
      return Result.err(
        ClientIssueError.batchRefused(
          ClientIssueBatchRefusedReason.Shape,
          null,
          null,
        ),
      );
    }
    if (raw.length > MAX_ISSUES) {
      return Result.err(
        ClientIssueError.batchRefused(
          ClientIssueBatchRefusedReason.TooMany,
          null,
          null,
        ),
      );
    }
    let complete = true;
    for (let i = 0; i < raw.length; i++) {
      const fault = issueFault(raw[i], i);
      if (fault !== null) return Result.err(fault);
      complete &&= hasEveryWireOptional(raw[i] as Record<string, unknown>);
    }
    if (jsonBytes(raw) > MAX_BYTES) {
      return Result.err(
        ClientIssueError.batchRefused(
          ClientIssueBatchRefusedReason.TooLarge,
          null,
          null,
        ),
      );
    }
    // Checked key by key above — the payload IS the batch, or (an old web's
    // issues among it) the batch with their absent WS-5 keys read as `null`.
    return Result.ok(
      complete
        ? (raw as readonly ClientIssue[])
        : (raw as readonly Record<string, unknown>[]).map(filled),
    );
  },

  /**
   * The reporter's batches: the issues in order, a new batch begun whenever
   * the next would pass {@link MAX_ISSUES} or {@link MAX_BYTES} — weighed as
   * {@link admitBatch} weighs them, so every batch it packs is admitted.
   */
  pack(issues: readonly ClientIssue[]): readonly (readonly ClientIssue[])[] {
    const batches: ClientIssue[][] = [];
    let batch: ClientIssue[] = [];
    // `[` and `]`, then each issue and the comma before every one but the first.
    let bytes = 2;
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i] as ClientIssue;
      const weight = jsonBytes(issue);
      if (
        batch.length === MAX_ISSUES ||
        (batch.length > 0 && bytes + 1 + weight > MAX_BYTES)
      ) {
        batches.push(batch);
        batch = [];
        bytes = 2;
      }
      bytes += batch.length === 0 ? weight : weight + 1;
      batch.push(issue);
    }
    if (batch.length > 0) batches.push(batch);
    return batches;
  },

  /**
   * The issue's Cloud Logging line. Every line carries the issue's fields,
   * its {@link fingerprint} (`clientIssueFingerprint`) and who reported it
   * — the `client_issue_count` metric counts lines by `clientIssueKind`.
   * The conditions (a data refusal, a chunk, a CSP report) are `warn`
   * lines; the error kinds (`ClientIssue.isError`) are `error` lines typed
   * as Error Reporting's `ReportedErrorEvent`, under the `web` service and
   * the issue's build, their message a one-frame stack — and, when the
   * issue has no frame to report, a report location naming its route and
   * kind (line 0: unknown) so Error Reporting still takes it.
   */
  logLine(
    issue: ClientIssue,
    reporter: ClientIssueReporter,
  ): ClientIssueLogLine {
    const fields = {
      ...issue,
      clientIssueFingerprint: fingerprint(issue),
      reporterRoles: reporter.reporterRoles,
      reporterAuthed: reporter.reporterAuthed,
    };
    if (!ClientIssue.isError(issue)) {
      return {
        level: 'warn',
        msg: `client issue ${issue.clientIssueKind}`,
        fields,
      };
    }
    return {
      level: 'error',
      msg: reportedMessage(issue),
      fields: {
        ...fields,
        '@type': REPORTED_ERROR_EVENT,
        serviceContext: {
          service: SERVICE,
          version: issue.release ?? UNKNOWN_RELEASE,
        },
        ...(issue.topFrame === null
          ? {
              context: {
                reportLocation: {
                  filePath: issue.routePattern ?? '/',
                  lineNumber: 0,
                  functionName: issue.clientIssueKind,
                },
              },
            }
          : null),
      },
    };
  },
} as const;
