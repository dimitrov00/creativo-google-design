import type { Actor } from './actor.data';

/**
 * Who wrote a journal entry — the stored `clientJournal.actor`
 * (`loyalty-document.ts:617-635`): `serializeActor`'s five-kind union, ids
 * only, kinds and keys unchanged. It IS the audit `Actor` of
 * `actor.data.ts` (system | user | staff | admin | impersonator), so it is
 * that type by another name — reused, never copied; the journal reads its
 * `SystemSource` dictionary (`loyalty_engine`, `fixture`, …) like the audit
 * log does.
 */
export type JournalActor = Actor;
