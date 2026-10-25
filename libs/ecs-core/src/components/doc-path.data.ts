/*
 * Split out of `write-op.data.ts` (pass D, S-21; one name per file, L-1):
 * read by the ports tier, the pipelines, the adapters and the test support
 * beside `WriteOp`. A type-only component: no companion, nothing to put in
 * one.
 */

/**
 * A document path as alternating collection names and ids —
 * `['clientStats', uid, 'restricted', 'money']` is one path. Collection
 * names come from the collection registry, never a literal at the call site.
 */
export type DocPath = readonly string[];
