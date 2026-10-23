import type { Brand } from './brand';
import { PrimitiveError, PrimitiveErrorCode } from './primitive.error';
import { Result } from './result.data';

/**
 * Absolute URLs (`http:`, `javascript:`, `data:` — any `scheme:`),
 * protocol-relative ones (`//evil.com`) and the backslash variant some
 * browsers normalise (`/\evil.com`) — the legacy class's regex verbatim.
 */
const ABSOLUTE_OR_DANGEROUS = /^(\/[/\\]|[a-z][a-z0-9+.-]*:)/i;

/**
 * A safe in-app redirect target — a same-origin path (`/account?tab=x#top`),
 * trimmed. The `?redirect=` parameter is attacker-controlled (anyone can
 * craft a link), so this is the open-redirect guard: an absolute,
 * protocol-relative or backslash URL, a `scheme:` and anything not starting
 * with `/` never becomes one. Whether the path resolves to a route is the
 * router's question, not this primitive's (was the legacy identity class
 * `RedirectPath`, deleted in Phase 4b).
 */
export type RedirectPath = Brand<string, 'RedirectPath'>;

const ROOT = '/' as RedirectPath;
const ACCOUNT_HOME = '/account' as RedirectPath;

export const RedirectPath = {
  /** The smart constructor — the ONLY way an untrusted `?redirect=` becomes a RedirectPath. */
  parse(raw: string): Result<RedirectPath, PrimitiveError> {
    const trimmed = raw.trim();
    if (
      trimmed.length === 0 ||
      !trimmed.startsWith('/') ||
      ABSOLUTE_OR_DANGEROUS.test(trimmed)
    ) {
      return Result.err(
        PrimitiveError.of(
          PrimitiveErrorCode.RedirectPathUnsafe,
          raw,
          'RedirectPath',
        ),
      );
    }
    return Result.ok(trimmed as RedirectPath);
  },

  /** The public marketing landing, `/`. */
  root(): RedirectPath {
    return ROOT;
  },

  /**
   * Parse with a silent fallback to {@link RedirectPath.root} — for routes
   * where an unsafe or absent redirect lands the user home instead of
   * surfacing a validation error.
   */
  parseOrRoot(raw: string | null): RedirectPath {
    if (raw === null || raw.length === 0) return ROOT;
    const parsed = RedirectPath.parse(raw);
    return parsed.ok ? parsed.value : ROOT;
  },

  /**
   * Where to send a user AFTER authentication: a redirect of `/` carries no
   * intent (the public landing is not a post-auth destination), so it
   * collapses to the app home `/account`; any other path is honoured as is.
   */
  authDestination(path: RedirectPath): RedirectPath {
    return path === ROOT ? ACCOUNT_HOME : path;
  },
} as const;
