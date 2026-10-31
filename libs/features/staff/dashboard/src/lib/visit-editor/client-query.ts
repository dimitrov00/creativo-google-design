import {
  ClientQuerySystem,
  type ParsedClientQuery,
  type RankableClient,
} from '@core/systems';

/**
 * THE ADD-CLIENT OMNIBOX (2026-09-18; owner: "it should auto detect phone
 * or name or email and auto assign it and look it up").
 *
 * One field, three kinds of answer. The desk types whatever the caller
 * gives — «Мария», «088 765 4321», «maria@…», or all of it at once, pasted
 * from a message — and every part is found where it stands: the words are
 * the NAME, the digit run is the PHONE, the token with an `@` is the MAIL.
 * The most selective part LEADS the lookup (mail, then number, then name);
 * the others rank what comes back and prefill the new-client form.
 *
 * The reading, the lookup keys, the ranking and the marked segments are
 * `ClientQuerySystem` in `@core/systems`, which its callers call directly;
 * the reading IS the system's `ParsedClientQuery` — its leading part the
 * field `clientQueryShape` (`ClientQueryShape`), compared against the
 * dictionary's member. This file keeps only `rankClients`: the system's
 * ranking (`ClientQuerySystem.rank`, which answers indexes) resolved onto
 * the caller's own objects. The caller's options are the system's
 * `RankableClient` as they are (every field present, an absent mail
 * `null` — pass D, D-10.4).
 */

export interface RankedClient<T extends RankableClient> {
  readonly client: T;
  /** The typed number or mail IS this person's — a duplicate in waiting. */
  readonly exact: boolean;
}

/** The owner's hits, filtered by the LEADING part and ordered best first. */
export function rankClients<T extends RankableClient>(
  clients: readonly T[],
  parsed: ParsedClientQuery,
  callingCode: string = ClientQuerySystem.DEFAULT_CALLING_CODE,
): readonly RankedClient<T>[] {
  return ClientQuerySystem.rank(clients, parsed, callingCode).map((hit) => ({
    client: clients[hit.index] as T,
    exact: hit.exact,
  }));
}
