import type { AchievementsContext } from '../achievements.presenter';
import type { AchievementsData, Slice } from '../client-pages.vm';
import type { ClientCardWords } from '../client-card.words';

/**
 * WHERE AN ACHIEVEMENTS PAGE STANDS — the collection, a scope and a medal
 * (client-card-redesign §3.3.4, §3.4, §3.5, §3.8) read the same store
 * data and stand in the same four places:
 *
 * - `loading` — the catalogue, the account or the progress is still on its
 *   way (or the card's words are): shaped placeholders.
 * - `failed` — a read failed: the heading stays, and under it the one
 *   retry grammar of the stack. Drawing every medal `notStarted` over a
 *   failed progress read would be a fake zero, so a partial read is a
 *   failure too. A scope or a family the catalogue does not hold is the
 *   same page: nothing true can be drawn for it.
 * - `absent` — there is no achievements data for this person at all (no
 *   loyalty account, the flag off): the pages are unreachable from the
 *   glance, and a deep push says how the first achievement comes.
 * - `ready` — the page's VM, and the words it was built in.
 */
export type AchievementsPageState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'ready';
      readonly vm: T;
      readonly words: ClientCardWords;
    };

const LOADING = { kind: 'loading' } as const;
const FAILED = { kind: 'failed' } as const;
const ABSENT = { kind: 'absent' } as const;

/**
 * The page's state from the store's slice and the presenters' context,
 * `build` being the page's own pure presenter (`medalsPageVm`,
 * `medalScopeVm`, `medalDetailVm`); a `null` from it is a scope or a family
 * the catalogue lacks.
 */
export function achievementsPageState<T>(
  data: Slice<AchievementsData> | null,
  ctx: AchievementsContext | null,
  build: (data: AchievementsData, ctx: AchievementsContext) => T | null,
): AchievementsPageState<T> {
  if (data === null) return ABSENT;
  if (ctx === null || data.status === 'loading') return LOADING;
  if (data.status === 'failed') return FAILED;
  const vm = build(data.data, ctx);
  return vm === null ? FAILED : { kind: 'ready', vm, words: ctx.words };
}

let nextPrefix = 0;

/**
 * A prefix for the ids one page mounts (the headings its rails and grids
 * are labelled by), unique per instance: a pushed page and the one it
 * replaced can both be in the DOM for a frame.
 */
export function achievementsIdPrefix(page: string): string {
  nextPrefix += 1;
  return `${page}-${nextPrefix}`;
}
