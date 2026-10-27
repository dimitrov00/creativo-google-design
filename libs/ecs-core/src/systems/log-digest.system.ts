import { CanonicalJsonSystem } from './canonical-json.system';

/**
 * The keys a decoded command may contribute to its log digest (RU-23) —
 * ids, tags, minutes, cents, dates, versions and flags, and the containers
 * that hold them (`seats`, `commands`, `editCommand`, `placement`, …). An
 * ALLOWLIST, not a deny-list: R36 / T5 (free text and contact values never
 * enter a log line) outrank the brief's "remove `contact` and every
 * free-text field", because a deny-list leaks the next free-text field a
 * command grows. Never here: `contact`, `label`, `guestKey`, `reason`,
 * `code` / `codes` (OTP, voucher and coupon codes are bearer credentials),
 * `rawDestination`, `rawIdentifier`, `fields`, `edits`, `text`, `issues`.
 */
const BASIS_KEYS = [
  'appointmentId',
  'locationId',
  'localDate',
  'startMinutes',
  'endMinutes',
  'seatId',
  'seats',
  'lineId',
  'serviceId',
  'variantId',
  'barberId',
  'barberPreference',
  'toBookingStatus',
  'cancellationReason',
  'markArrivalAction',
  'amountCents',
  'tipCents',
  'expectedVersion',
  'acknowledgedOverlap',
  'commands',
  'editCommand',
  'durationMinutes',
  'priceCents',
  'operationId',
  'attemptId',
  'requestId',
  'streakId',
  'version',
  'baseVersion',
  'backfillJobName',
  'targetUserId',
  'impersonationScope',
  'expiresAtUtcMs',
  'sessionId',
  'ownerUserId',
  'staffPlacement',
  'placement',
  'days',
  'windows',
] as const;

/** The digest's printed length — 16 hex characters (64 bits). */
const DIGEST_LENGTH = 16;

/** One of {@link BASIS_KEYS}. */
type BasisKey = (typeof BASIS_KEYS)[number];

/** `key` is one of {@link BASIS_KEYS} — an indexed scan, no allocation. */
function isBasisKey(key: string): key is BasisKey {
  for (let i = 0; i < BASIS_KEYS.length; i++) {
    if (BASIS_KEYS[i] === key) return true;
  }
  return false;
}

/** A leaf the basis may hold: a string, a finite number, a boolean or `null`. */
function isLeaf(raw: unknown): raw is string | number | boolean | null {
  return (
    raw === null ||
    typeof raw === 'string' ||
    typeof raw === 'boolean' ||
    (typeof raw === 'number' && Number.isFinite(raw))
  );
}

/**
 * The allowlisted projection of a value reached through an allowlisted key
 * (`allowed`) or not: a record keeps only its allowlisted keys, each walked
 * on; an array keeps its order, each element walked with the array's own
 * standing (an element that projects to nothing is `null`, so positions
 * stay content); a leaf is kept only under an allowlisted key. `undefined`
 * answers "nothing to keep". A new structure — the input is never written.
 */
function project(raw: unknown, allowed: boolean): unknown {
  if (Array.isArray(raw)) {
    const out: unknown[] = [];
    for (let i = 0; i < raw.length; i++) {
      const element = project(raw[i], allowed);
      out.push(element === undefined ? null : element);
    }
    return out;
  }
  if (typeof raw === 'object' && raw !== null) {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(raw);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] as string;
      if (!isBasisKey(key)) continue;
      const value = project((raw as Record<string, unknown>)[key], true);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  return allowed && isLeaf(raw) ? raw : undefined;
}

/**
 * The log digest of a decoded command (audit-hardening WS-4.2, RU-23): the
 * `inputDigest` of a callable's outcome line, which tells two calls with
 * the same input apart without carrying the input. Pure (Law 3): the keyed
 * hash is a parameter (the `LogDigestPorts.logDigest` port, HMAC-SHA-256
 * under `LOG_DIGEST_KEY`), never a crypto import.
 */
export const LogDigestSystem = {
  /** The allowlist itself — every key a command may contribute (RU-23). */
  BASIS_KEYS,

  /**
   * The canonical JSON ({@link CanonicalJsonSystem.of}) of the command's
   * ALLOWLISTED projection: records keep only {@link BASIS_KEYS} (at every
   * depth), arrays keep their order, leaves are strings, finite numbers,
   * booleans and `null` under an allowlisted key. A top-level leaf is under
   * no key and prints `null`; key order never changes the basis.
   */
  basisOf(command: unknown): string {
    const projected = project(command, false);
    return CanonicalJsonSystem.of(projected === undefined ? null : projected);
  },

  /**
   * `keyedHash(basisOf(command))` cut to its first 16 characters, or `null`
   * when the hash answered `''` (no key bound: an unkeyed digest of an id
   * set is guessable, so none is printed).
   */
  digestOf(
    command: unknown,
    keyedHash: (input: string) => string,
  ): string | null {
    const hash = keyedHash(LogDigestSystem.basisOf(command));
    return hash.length === 0 ? null : hash.slice(0, DIGEST_LENGTH);
  },
} as const;
