import type { DocumentData } from 'firebase/firestore';
import { RepositoryError } from '@core/errors';

/*
 * What a web adapter answers its port with — over Firestore AND Storage,
 * written once: a stored document as its entity, and a failure as the
 * store's own reason. SDK-free (a type import only), so it rides the EAGER
 * barrel and `@creativo/infrastructure/storage` reads it through the same
 * edge it already takes for `subscribeWithRetry`.
 */

/**
 * A document as its entity: the body spread beside its id. The one cast of
 * the web data layer — Firestore types a body `DocumentData`, and the
 * archetype is exactly that body plus its id (as `firestoreReadTx` does on
 * the server).
 */
export function entityOf<E>(id: string, data: DocumentData): E {
  return { id, ...data } as E;
}

/**
 * The store's own reason for a failure: the SDK's string `code` (Firestore's
 * `permission-denied`, Storage's `storage/unauthorized`), else the message.
 */
export function reasonOf(cause: unknown): string | null {
  if (typeof cause === 'object' && cause !== null) {
    const code = (cause as { readonly code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return cause instanceof Error ? cause.message : null;
}

/** A refused or failed read of `path`. */
export function readFailed(path: string, cause: unknown): RepositoryError {
  return RepositoryError.readFailed(path, reasonOf(cause));
}

/** A refused or failed write of `path`. */
export function writeFailed(path: string, cause: unknown): RepositoryError {
  return RepositoryError.writeFailed(path, reasonOf(cause));
}
