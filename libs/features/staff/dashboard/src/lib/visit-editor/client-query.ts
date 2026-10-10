import {
  ClientQuerySystem,
  type ClientQueryKind as EcsClientQueryKind,
  type ParsedClientQuery as EcsParsedClientQuery,
  type RankableClient as EcsRankableClient,
  type TextSegment as EcsTextSegment,
} from '@creativo/ecs-core';

/**
 * THE ADD-CLIENT OMNIBOX, as pure functions (2026-09-18; owner: "it should
 * auto detect phone or name or email and auto assign it and look it up").
 *
 * One field, three kinds of answer. The desk types whatever the caller
 * gives — «Мария», «088 765 4321», «maria@…», or all of it at once, pasted
 * from a message — and every part is found where it stands: the words are
 * the NAME, the digit run is the PHONE, the token with an `@` is the MAIL.
 * The most selective part LEADS the lookup (mail, then number, then name);
 * the others rank what comes back and prefill the new-client form.
 *
 * Phase 2 shim: the reading, the lookup keys, the ranking and the marked
 * segments are `ClientQuerySystem` in `@creativo/ecs-core`. This file keeps
 * the legacy names and signatures (the default calling code, the generic
 * ranking over the caller's own objects) for its callers.
 */

export type ClientQueryKind = EcsClientQueryKind;

export type ParsedClientQuery = EcsParsedClientQuery;

/** A client as the ranking reads them — the option's own fields. */
export interface RankableClient {
  readonly label: string;
  readonly phone: string | null;
  readonly email?: string | null;
}

export interface RankedClient<T extends RankableClient> {
  readonly client: T;
  /** The typed number or mail IS this person's — a duplicate in waiting. */
  readonly exact: boolean;
}

export type TextSegment = EcsTextSegment;

/** Bulgaria's calling code — the shop's, and the default a bare number gets. */
export const DEFAULT_CALLING_CODE: string =
  ClientQuerySystem.DEFAULT_CALLING_CODE;

export function parseClientQuery(raw: string): ParsedClientQuery {
  return ClientQuerySystem.parse(raw);
}

/**
 * The number in the forms the index holds — the international digits and
 * the national «0…» — so a number finds its person however it was dialled.
 */
export function phoneLookupVariants(
  parsed: ParsedClientQuery,
  callingCode = DEFAULT_CALLING_CODE,
): readonly string[] {
  return ClientQuerySystem.phoneLookupVariants(parsed, callingCode);
}

/** What to ask the index, most selective part first. */
export function clientLookupKeys(
  parsed: ParsedClientQuery,
  callingCode = DEFAULT_CALLING_CODE,
): readonly string[] {
  return ClientQuerySystem.lookupKeys(parsed, callingCode);
}

/** The typed digits as INTERNATIONAL digits (no `+`), most likely reading first. */
export function phoneInternationalDigits(
  parsed: ParsedClientQuery,
  callingCode = DEFAULT_CALLING_CODE,
): readonly string[] {
  return ClientQuerySystem.phoneInternationalDigits(parsed, callingCode);
}

/** The owner's hits, filtered by the LEADING part and ordered best first. */
export function rankClients<T extends RankableClient>(
  clients: readonly T[],
  parsed: ParsedClientQuery,
  callingCode = DEFAULT_CALLING_CODE,
): readonly RankedClient<T>[] {
  return ClientQuerySystem.rank(
    clients.map(toRankable),
    parsed,
    callingCode,
  ).map((hit) => ({ client: clients[hit.index] as T, exact: hit.exact }));
}

/** A name with the typed beginnings of its words marked. */
export function nameSegments(
  label: string,
  parsed: ParsedClientQuery,
): readonly TextSegment[] {
  return ClientQuerySystem.nameSegments(label, parsed);
}

/** A printed number with the typed run of its digits marked, spacing kept. */
export function phoneSegments(
  formatted: string,
  parsed: ParsedClientQuery,
  callingCode = DEFAULT_CALLING_CODE,
): readonly TextSegment[] {
  return ClientQuerySystem.phoneSegments(formatted, parsed, callingCode);
}

/** A mail with the typed fragment marked. */
export function emailSegments(
  email: string,
  parsed: ParsedClientQuery,
): readonly TextSegment[] {
  return ClientQuerySystem.emailSegments(email, parsed);
}

/** The caller's option → the system's struct (an absent mail is `null`). */
function toRankable(client: RankableClient): EcsRankableClient {
  return {
    label: client.label,
    phone: client.phone,
    email: client.email ?? null,
  };
}
