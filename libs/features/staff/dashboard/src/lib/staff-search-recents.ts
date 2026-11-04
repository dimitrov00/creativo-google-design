import { SearchQuery } from '@core/components';

/**
 * THE SCHEDULE SEARCH'S RECENTS — the last few searches (text and chips), per
 * device. A plain function pair beside the store, as `agenda-fields.ts` is:
 * `localStorage` only, no Firestore read or write, no sign-out hook.
 * Everything read back is held to {@link SearchQuery.parse}, so a corrupt
 * entry is dropped and nothing else is lost; every storage access is in a
 * try/catch (private windows, blocked storage and previews throw).
 */

/** The key the list is stored under on a device. */
export const SEARCH_RECENTS_KEY = 'creativo.staff.search.recents';

/** How many searches are kept. */
export const SEARCH_RECENTS_MAX = 8;

/**
 * `query` pushed on the front of `recents`: any earlier copy of the same
 * search goes (so it moves up rather than repeats), the list is cut at
 * `max`, and an empty search is not kept. The list given is not changed.
 */
export function pushRecent(
  recents: readonly SearchQuery[],
  query: SearchQuery,
  max: number = SEARCH_RECENTS_MAX,
): readonly SearchQuery[] {
  if (SearchQuery.isEmpty(query)) return recents;
  const out: SearchQuery[] = [query];
  for (let i = 0; i < recents.length && out.length < max; i++) {
    const held = recents[i] as SearchQuery;
    if (!SearchQuery.equals(held, query)) out.push(held);
  }
  return out;
}

/** The recents on this device, newest first; empty when storage is unavailable or holds nothing readable. */
export function loadRecents(storage: Storage | null): readonly SearchQuery[] {
  let raw: unknown;
  try {
    const text = storage?.getItem(SEARCH_RECENTS_KEY) ?? null;
    if (text === null) return [];
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: SearchQuery[] = [];
  for (let i = 0; i < raw.length && out.length < SEARCH_RECENTS_MAX; i++) {
    const parsed = SearchQuery.parse(raw[i]);
    if (parsed.ok && !SearchQuery.isEmpty(parsed.value)) out.push(parsed.value);
  }
  return out;
}

/** Writes the recents; silent when storage is unavailable or full. */
export function saveRecents(
  storage: Storage | null,
  recents: readonly SearchQuery[],
): void {
  try {
    storage?.setItem(SEARCH_RECENTS_KEY, JSON.stringify(recents));
  } catch {
    // Recents are a convenience: nothing else depends on them.
  }
}

/** Forgets the recents on this device. */
export function clearRecents(storage: Storage | null): void {
  try {
    storage?.removeItem(SEARCH_RECENTS_KEY);
  } catch {
    // As above.
  }
}
