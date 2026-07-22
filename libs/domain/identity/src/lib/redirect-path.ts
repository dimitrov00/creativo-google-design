import { Result, fail, ok } from '@creativo/domain/kernel';
import { RedirectPathUnsafeError } from './redirect-path.errors';

/**
 * A safe in-app redirect target — relative path only.
 *
 * Security invariant: prevents open-redirect vulnerabilities. The
 * `?redirect=` URL parameter is attacker-controlled (anyone can craft a
 * link) — without validation, an attacker could send
 * `/auth?redirect=https://phishing.example.com`, and after the user logs
 * in they'd be sent to the phishing site.
 *
 * Rejects: absolute URLs (`http:`, `https:`), protocol-relative (`//evil.com`),
 * protocol injection (`javascript:`, `data:`), backslash variants some
 * browsers normalize (`/\evil.com`), and anything not starting with `/`.
 * Accepts: `/anything-relative?with=query#and-fragment`. Routing legality
 * (does the path actually resolve to a route) is the router's problem, not
 * this value object's.
 */
const ABSOLUTE_OR_DANGEROUS = /^(\/[/\\]|[a-z][a-z0-9+.-]*:)/i;

export class RedirectPath {
  private constructor(private readonly _value: string) {}

  /** Validating factory — the ONLY way an untrusted `?redirect=` value becomes a RedirectPath. */
  static create(raw: string): Result<RedirectPath, RedirectPathUnsafeError> {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('/')) {
      return fail(new RedirectPathUnsafeError(raw));
    }
    if (ABSOLUTE_OR_DANGEROUS.test(trimmed)) {
      return fail(new RedirectPathUnsafeError(raw));
    }
    return ok(new RedirectPath(trimmed));
  }

  /** Rebuild from persistence/config that was validated on the way in. Never call with user input. */
  static fromPrimitive(trusted: string): RedirectPath {
    return new RedirectPath(trusted);
  }

  /** Parse with a silent fallback to `root()` on failure — for routes where an invalid redirect should land the user home instead of surfacing a validation error. */
  static parseOrRoot(raw: string | undefined | null): RedirectPath {
    if (!raw) return RedirectPath.root();
    const result = RedirectPath.create(raw);
    return result.isSuccess() ? result.value : RedirectPath.root();
  }

  /** The public marketing landing. */
  static root(): RedirectPath {
    return new RedirectPath('/');
  }

  /** Post-authentication home — distinct from `root()`: once signed in, "no specific intent" means the app home, not marketing. */
  static defaultDest(): RedirectPath {
    return new RedirectPath('/account');
  }

  get value(): string {
    return this._value;
  }

  equals(other: RedirectPath): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  /**
   * Resolve where to send a user *after authentication*. A redirect of
   * root ('/') carries no real intent (the public landing is not a
   * post-auth destination), so it collapses to the app home; any other
   * path is honoured as-is.
   */
  authDestination(): RedirectPath {
    return this._value === '/' ? RedirectPath.defaultDest() : this;
  }
}
