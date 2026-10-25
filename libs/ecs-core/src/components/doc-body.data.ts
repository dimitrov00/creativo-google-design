/*
 * Split out of `write-op.data.ts` (pass D, S-21; one name per file, L-1):
 * read by the pipelines, the adapters and the test support beside
 * `WriteOp`. A type-only component: no companion, nothing to put in one.
 */

/**
 * A document body (or an update's field map): the flat entity minus `id`.
 * Entity types are object type aliases, so any of them is assignable here
 * without a cast.
 */
export type DocBody = { readonly [field: string]: unknown };
