import type { DocumentData } from 'firebase-admin/firestore';
import { RepositoryError } from '@core/errors';
import { FailureCodeSystem } from '@core/systems';

/**
 * What an adapter answers its port with — the ONE copy of the store-failure
 * and stored-body spellings every `*.adapter.ts` here shares (reuse, never
 * copy). A failure's `reason` is the SDK's canonical code
 * (`FailureCodeSystem.codeOf`: `unavailable`, `aborted`, `already-exists`, …)
 * — ids and codes only, never the SDK's message — so the retrying edge
 * judges a failed attempt by it. No business logic.
 */

/** Firestore's canonical name for gRPC 6, as `FailureCodeSystem.codeOf` reads it. */
export const ALREADY_EXISTS = 'already-exists';

/** A read of `path` that threw — answered with the failure's canonical code. */
export function readFailed(path: string, error: unknown): RepositoryError {
  return RepositoryError.readFailed(path, FailureCodeSystem.codeOf(error));
}

/** A write of `path` that threw — answered with the failure's canonical code. */
export function writeFailed(path: string, error: unknown): RepositoryError {
  return RepositoryError.writeFailed(path, FailureCodeSystem.codeOf(error));
}

/** The stored body of an entity — the entity minus its id (Law 5). */
export function bodyOf<E extends { readonly id: string }>(
  entity: E,
): DocumentData {
  const { id: _id, ...body } = entity;
  return body;
}
