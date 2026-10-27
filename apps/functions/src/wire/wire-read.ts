import {
  ClientOperationId,
  OperationId,
  Result,
  Tag,
  type UtcEpochMs,
} from '@core/primitives';
import { type RepositoryError, RepositoryErrorCode } from '@core/errors';
import type { OperationIdField } from '@core/ports';
import { ZonedTimeSystem } from '@core/systems';
import type { EdgeError } from '../edge';
import type { VerifiedRequest } from '../lib/booking/caller-roles';

/**
 * THE WIRE'S READERS (Phase 4a 4A-4) — the ONE copy of how every decoder
 * reads a callable's `unknown` payload and how every callable meets a store
 * failure, shared by `wire/*.wire.ts` (reuse, never copy). A decoder reads
 * every field as a primitive and nothing into existence: ids through their
 * smart constructors (Law 7.4), the caller and their roles off the VERIFIED
 * token (`lib/booking/caller-roles.ts`), never the payload.
 */

/** What a decoder reads off a callable request — the payload and the verified token. */
export type WireRequest = VerifiedRequest & {
  readonly data?: unknown;
};

/** An untrusted object, read by name only. */
export type Payload = { readonly [field: string]: unknown };

/** A plain object (never an array, never `null`). */
export function isRecord(raw: unknown): raw is Payload {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
}

/** The request's payload object, or the empty one — read without trusting its shape. */
export function payloadOf(request: WireRequest): Payload {
  const data = request.data;
  return data !== null && typeof data === 'object' ? (data as Payload) : {};
}

/** A field of an untrusted object by name — no dynamic index; `undefined` when absent. */
export function field(source: unknown, name: string): unknown {
  return source !== null && typeof source === 'object'
    ? Object.getOwnPropertyDescriptor(source, name)?.value
    : undefined;
}

/** `String(x ?? '')` — the wire's reading of a text field. */
export function text(source: unknown, name: string): string {
  const value = field(source, name);
  return value === undefined || value === null ? '' : String(value);
}

/** A text field that is present and not `null`, else `null` (`String`-coerced as the wire reads text). */
export function textOrNull(source: unknown, name: string): string | null {
  const value = field(source, name);
  return value === undefined || value === null ? null : String(value);
}

/** A list field, or none. */
export function listOf(source: unknown, name: string): readonly unknown[] {
  const value = field(source, name);
  return Array.isArray(value) ? value : [];
}

/**
 * The instant a trigger delivery's wire time names (RFC 3339, an offset
 * required — `ZonedTimeSystem.parseOffsetIso`), `null` when it does not
 * parse. The ONE reading of `event.time`: the triggers' wire and the edge's
 * attempt line both read it (DEP-13).
 */
export function eventInstantOf(time: string): UtcEpochMs | null {
  const instant = ZonedTimeSystem.parseOffsetIso(time);
  return instant.ok ? instant.value : null;
}

/** A number field as sent, or `null` for anything that is not a number. */
export function numberOrNull(source: unknown, name: string): number | null {
  const value = field(source, name);
  return typeof value === 'number' ? value : null;
}

/** An id through its smart constructor, or `null`. */
export function idOf<T>(
  raw: unknown,
  parse: (value: string) => Result<T, unknown>,
): T | null {
  if (typeof raw !== 'string') return null;
  const parsed = parse(raw);
  return parsed.ok ? parsed.value : null;
}

/**
 * The operation id a callable's payload carries in `field` (WS-4.1,
 * `OPERATION_ID_FIELD`), else `null`: the client-minted key's shape
 * (`ClientOperationId.inPayload` — an own property, `[A-Za-z0-9_-]{16,64}`)
 * and then a plain id (`OperationId.parse` — a reserved `__x__` name reads
 * as none). Never an unvalidated string; the decoder decides whether `null`
 * is a refusal (a booking act) or no id (an optional transport id).
 */
export function operationIdOf(
  payload: unknown,
  field: OperationIdField,
): OperationId | null {
  const sent = ClientOperationId.inPayload(payload, field);
  return sent === null ? null : idOf(sent, OperationId.parse);
}

/** Whether a failure is a store failure (any {@link RepositoryErrorCode}) — the infrastructure, never a refusal. */
export function isStoreFailure(error: {
  readonly errorCode: string;
}): error is RepositoryError {
  return Tag.has(RepositoryErrorCode, error.errorCode);
}

/**
 * A store failure as the edge's unexpected throw — tracked, and answered as
 * the callable's coded `internal` (its `failureCode`) or the platform's bare
 * INTERNAL, the cause in the log only. Never a refusal on the wire.
 */
export function storeFailure(error: RepositoryError): Error {
  return Object.assign(new Error(error.errorCode), { repositoryError: error });
}

/**
 * Throws a store failure for the edge's unexpected path ({@link storeFailure});
 * any other refusal comes back narrowed.
 */
export function refusalOf<E extends { readonly errorCode: string }>(
  error: E | RepositoryError,
): Exclude<E, RepositoryError> {
  if (isStoreFailure(error)) throw storeFailure(error);
  return error as Exclude<E, RepositoryError>;
}

/**
 * A pipeline's result as the callable answers it: the answer encoded, a
 * refusal in the callable's own words (a store failure thrown on the way).
 */
export function settle<A, E, Out>(
  result: Result<A, E>,
  encode: (answer: A) => Out,
  refuse: (error: E) => EdgeError,
): Result<Out, EdgeError> {
  return result.ok
    ? Result.ok(encode(result.value))
    : Result.err(refuse(result.error));
}
