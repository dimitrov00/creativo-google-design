/**
 * The env name the deployed build's stamp arrives under: one line of the
 * generated `.env.<projectId>` (`tools/flags/write-functions-env.mjs
 * --release`, ADR 2026-11-18 R9) — `0.4.1` for a release tag,
 * `0.4.1+abc1234` for a branch commit.
 */
export const RELEASE_ENV = 'CREATIVO_RELEASE';

/**
 * A stamp's shape: the web's own rule for an issue's `release`
 * (`ClientIssueSystem`, word characters, dots, `+` and `-`), at most 64.
 */
const STAMP = /^[\w.+-]{1,64}$/;

/**
 * The build this process runs, read off its environment once at the
 * composition root: the stamp when it is one, else `null` (the emulator, a
 * deploy without a stamp, a value of any other shape — never a half-trusted
 * text on every log line).
 */
export function serverRelease(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const value = env[RELEASE_ENV];
  return typeof value === 'string' && STAMP.test(value) ? value : null;
}
