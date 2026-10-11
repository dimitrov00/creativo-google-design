import type { Actor } from './actor.data';

/**
 * Who wrote a journal entry — the flattened identity slice `Actor` of
 * `actor.data.ts` (flatten-spec §3.7), intersected at the root of the
 * journal entry: `actorRole` and its `actor*` fields, ids only. It IS the
 * audit `Actor` (SYSTEM | USER | STAFF | ADMIN | IMPERSONATOR), so it is
 * that type by another name — reused, never copied; the journal reads its
 * `SystemSource` dictionary (`LOYALTY_ENGINE`, `FIXTURE`, …) like the audit
 * log does. An actor is always an ACCOUNT (`UserId`), never a customer (D29).
 */
export type JournalActor = Actor;
