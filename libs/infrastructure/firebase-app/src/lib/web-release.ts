/**
 * The build's own name, as the deploy compiles it in (ADR
 * `2026-11-18-releases-and-environments.md`, R6): `CREATIVO_RELEASE`, an
 * esbuild `define` the deploy workflows pass to the web build —
 * `0.4.1` for a release tag, `0.4.1+abc1234` for a commit of a branch
 * (`tools/release/release-stamp.mjs`). The literal replaces the identifier
 * at build time, so the bundle reads no global and fetches nothing.
 */
declare const CREATIVO_RELEASE: string | undefined;

/**
 * The release every client issue this bundle reports carries (`release`,
 * Error Reporting's `serviceContext.version` on the server's line).
 * `null` in a build without the define: the dev server, a local build,
 * the unit tests — `typeof` reads an undeclared global without throwing.
 */
export const WEB_RELEASE: string | null =
  typeof CREATIVO_RELEASE === 'string' && CREATIVO_RELEASE !== ''
    ? CREATIVO_RELEASE
    : null;
