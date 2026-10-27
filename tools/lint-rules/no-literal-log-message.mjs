/**
 * `creativo/no-literal-log-message` — audit-hardening WS-4.6 (RU-8, RU-9,
 * RU-37): a structured log line's message is a value of the `LogEvent`
 * dictionary (`libs/ecs-core/src/primitives/log-event.data.ts`), declared
 * once, so a log-based metric, a runbook recipe or the web's
 * `endsWith('dropped')` classifier filters on a text that has ONE home. The
 * `Log` port's signature stays the law's verbatim (`msg: string`), so the
 * type checker cannot refuse a literal; this rule does.
 *
 * Reported: the 2nd argument of a `log(…)` / `x.log(…)` call whose 1st
 * argument is the level literal `'info'`, `'warn'` or `'error'`, when that
 * message is
 *   - a string `Literal` (`'booking.rejected'`);
 *   - a `TemplateLiteral` (`\`[otp] would send ${channel} …\``);
 *   - a `+` concatenation with a string or template literal anywhere in it;
 *   - any of those behind a type assertion (`'x' as LogEvent`,
 *     `<LogEvent>'x'`, `'x' satisfies string`, `'x'!`) or as a branch of a
 *     conditional / logical expression (`ok ? 'a' : LogEvent.B`).
 * The report sits on the call, so a justified exemption is one
 * `// eslint-disable-next-line creativo/no-literal-log-message -- <reason>`
 * above the `log(` line.
 *
 * Not reported:
 *   - a non-literal message — `LogEvent.BookingRejected`, an identifier, a
 *     member expression (the client-issue sink's `line.msg`, RU-37 b: a
 *     message built by `ClientIssueSystem.logLine` from the client's frame,
 *     never a `LogEvent` value by design, OR-34);
 *   - a call whose 1st argument is not a level literal (`log(level, msg)`
 *     forwards a line someone else built);
 *   - `console.log`, `Math.log` and `logger.log` (the SDK's own logger —
 *     `firebase-functions/logger` sits behind the console adapter).
 *
 * Recorded exemption (RU-37 a): the emulator-only console OTP sender's QA
 * line keeps its text word for word (WS-0) under a justified disable.
 *
 * Scope: every production `.ts` file — the root config ignores specs and
 * test support (a spec double may assert on a literal line).
 */

const LEVELS = new Set(['info', 'warn', 'error']);

/** Objects whose own `.log` is not the `Log` port. */
const FOREIGN_LOGGERS = new Set(['console', 'Math', 'logger']);

/** The type-only wrappers that leave the runtime value as it is. */
const TRANSPARENT = new Set([
  'TSAsExpression',
  'TSTypeAssertion',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
]);

/** The static name of a member's property (`a.log`, `a['log']`), or null. */
function propertyName(member) {
  if (!member.computed && member.property.type === 'Identifier') {
    return member.property.name;
  }
  if (
    member.computed &&
    member.property.type === 'Literal' &&
    typeof member.property.value === 'string'
  ) {
    return member.property.value;
  }
  return null;
}

/** The terminal name of a member's object (`console`, `this.logger` → `logger`), or null. */
function objectName(object) {
  if (object.type === 'Identifier') return object.name;
  if (object.type === 'MemberExpression') return propertyName(object);
  return null;
}

/** Whether `callee` is `log` or `x.log` with `x` not a foreign logger. */
function isLogCallee(callee) {
  if (callee.type === 'Identifier') return callee.name === 'log';
  if (callee.type !== 'MemberExpression') return false;
  if (propertyName(callee) !== 'log') return false;
  const owner = objectName(callee.object);
  return owner === null || !FOREIGN_LOGGERS.has(owner);
}

/** Whether `node` is a level literal (`'info'`, `` `warn` ``). */
function isLevel(node) {
  if (node === undefined) return false;
  if (node.type === 'Literal') {
    return typeof node.value === 'string' && LEVELS.has(node.value);
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return LEVELS.has(node.quasis[0].value.cooked);
  }
  return false;
}

/** Whether a message expression is, or contains as its text, a string literal. */
function isLiteralMessage(node) {
  if (node === undefined || node === null) return false;
  if (TRANSPARENT.has(node.type)) return isLiteralMessage(node.expression);
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string';
    case 'TemplateLiteral':
      return true;
    case 'BinaryExpression':
      return (
        node.operator === '+' &&
        (isLiteralMessage(node.left) || isLiteralMessage(node.right))
      );
    case 'ConditionalExpression':
      return (
        isLiteralMessage(node.consequent) || isLiteralMessage(node.alternate)
      );
    case 'LogicalExpression':
      return isLiteralMessage(node.left) || isLiteralMessage(node.right);
    default:
      return false;
  }
}

export const noLiteralLogMessage = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "WS-4.6: a structured log line's message is a `LogEvent` value (`@core/primitives`), never a string literal.",
    },
    schema: [],
    messages: {
      literalMessage:
        "No string literal as the log message (WS-4.6, RU-9): pass a value of the `LogEvent` dictionary (`ports.log('warn', LogEvent.BookingRejected, { errorCode })`, `@core/primitives`). A new message is a new `LogEvent` entry — dotted and domain-prefixed (`callable.completed`) — and the dynamic parts go into the fields, never into the text.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isLogCallee(node.callee)) return;
        const [level, message] = node.arguments;
        if (!isLevel(level) || !isLiteralMessage(message)) return;
        context.report({ node, messageId: 'literalMessage' });
      },
    };
  },
};
