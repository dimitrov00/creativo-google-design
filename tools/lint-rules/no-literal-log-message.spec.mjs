import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint, RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { noLiteralLogMessage } from './no-literal-log-message.mjs';

/**
 * `creativo/no-literal-log-message` (audit-hardening WS-4.6) — the unit
 * cases through RuleTester, then RU-37's two recorded exemptions on the
 * REAL files through each project's own config (the root block registers
 * the rule; the projects spread the root config):
 *   (a) the emulator-only console OTP line keeps its text under a justified
 *       `eslint-disable-next-line` — honoured, and the directive is used
 *       (the line is reported once the directive is gone);
 *   (b) the client-issue sink's `line.msg` is a non-literal — never
 *       reported.
 */

const tester = new RuleTester({
  languageOptions: { parser: tsParser },
});

const literal = [{ messageId: 'literalMessage' }];

tester.run('creativo/no-literal-log-message', noLiteralLogMessage, {
  valid: [
    // A `LogEvent` value — a member expression.
    "ports.log('warn', LogEvent.BookingRejected, { errorCode });",
    "log('error', LogEvent.DocumentRefused, { path });",
    "telemetry.log('error', LogEvent.AuditWriteFailed, { error });",
    // An identifier message (a parameter typed `LogEvent`).
    "guard.log('error', line, { path: error.path });",
    // RU-37 (b): the sink's message is a non-literal built by a system.
    'ports.log(line.level, line.msg, line.fields);',
    "ports.log('info', line.msg, line.fields);",
    // A non-literal level forwards a line someone else built.
    "ports.log(outcome.level, 'built elsewhere', {});",
    'log(level, `x ${y}`);',
    // Foreign loggers keep their own `.log`.
    "console.log('info', 'plain console text');",
    "logger.log('warn', 'the SDK logger');",
    "this.logger.log('error', 'the SDK logger');",
    'Math.log(2);',
    // Not a log call at all.
    "ports.track('warn', 'x');",
    "logLine('warn', 'x');",
    // A level that is not one of the three.
    "ports.log('debug', 'x');",
    // A one-argument call.
    "ports.log('info');",
  ],
  invalid: [
    {
      code: "ports.log('warn', 'booking.rejected', { errorCode });",
      errors: literal,
    },
    { code: "log('info', 'malformed document refused');", errors: literal },
    {
      code: "telemetry.log('error', 'audit write failed', {});",
      errors: literal,
    },
    { code: "a.b.log('error', 'x');", errors: literal },
    { code: "ports.log?.('warn', 'x');", errors: literal },
    { code: "ports['log']('warn', 'x');", errors: literal },
    // A template literal, with or without expressions.
    { code: "ports.log('info', `plain`);", errors: literal },
    {
      code: "log('info', `[otp] would send ${channel} OTP to ${destination}: ${code}`);",
      errors: literal,
    },
    // A template-literal level is still a level.
    { code: "ports.log(`warn`, 'x');", errors: literal },
    // A concatenation with a literal anywhere in it.
    { code: "ports.log('warn', 'prefix ' + suffix);", errors: literal },
    { code: "ports.log('warn', prefix + ' suffix');", errors: literal },
    { code: "ports.log('warn', a + b + 'c');", errors: literal },
    { code: "ports.log('warn', a + `${b}`);", errors: literal },
    // Behind a type assertion.
    { code: "ports.log('warn', 'x' as LogEvent);", errors: literal },
    { code: "ports.log('warn', 'x' satisfies string);", errors: literal },
    { code: "ports.log('warn', ('x' as string)!);", errors: literal },
    // As a branch of a conditional or logical expression.
    { code: "ports.log('warn', ok ? 'a' : LogEvent.B);", errors: literal },
    { code: "ports.log('warn', msg ?? 'fallback');", errors: literal },
  ],
});

const WORKSPACE = fileURLToPath(new URL('../../', import.meta.url));
const at = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

const OTP_SENDER = at(
  'apps/functions/src/adapters/console-otp-sender.adapter.ts',
);
const FUNCTIONS_CONFIG = at('apps/functions/eslint.config.mjs');
const SINK = at('libs/ecs-core/src/pipelines/report-client-issues.pipeline.ts');
const ECS_CORE_CONFIG = at('libs/ecs-core/eslint.config.mjs');

const RULE_ID = 'creativo/no-literal-log-message';
const DIRECTIVE =
  /^[ \t]*\/\/ eslint-disable-next-line creativo\/no-literal-log-message -- emulator-only QA line, WS-0 keeps it word for word\n/m;

/** The rule's hits and any unused-directive report, linting `text` as `filePath`. */
async function lintAs(config, filePath, text) {
  const eslint = new ESLint({ cwd: WORKSPACE, overrideConfigFile: config });
  const [result] = await eslint.lintText(text, { filePath });
  const messages = result?.messages ?? [];
  return {
    hits: messages.filter((message) => message.ruleId === RULE_ID),
    unusedDirectives: messages.filter(
      (message) =>
        message.ruleId === null &&
        /unused eslint-disable directive/i.test(message.message) &&
        message.message.includes(RULE_ID),
    ),
  };
}

describe('RU-37 — the two recorded exemptions on the real files', () => {
  it('(a) honours the justified disable on the emulator-only OTP line, and the directive is used', async () => {
    const source = readFileSync(OTP_SENDER, 'utf8');
    expect(source).toMatch(DIRECTIVE);

    const kept = await lintAs(FUNCTIONS_CONFIG, OTP_SENDER, source);
    expect(kept.hits).toEqual([]);
    expect(kept.unusedDirectives).toEqual([]);

    const withoutDirective = await lintAs(
      FUNCTIONS_CONFIG,
      OTP_SENDER,
      source.replace(DIRECTIVE, ''),
    );
    expect(withoutDirective.hits).toHaveLength(1);
  }, 60_000);

  it("(b) never reports the client-issue sink's non-literal `line.msg`", async () => {
    const source = readFileSync(SINK, 'utf8');
    expect(source).toContain('ports.log(line.level, line.msg, line.fields);');

    const { hits } = await lintAs(ECS_CORE_CONFIG, SINK, source);
    expect(hits).toEqual([]);
  }, 60_000);
});
