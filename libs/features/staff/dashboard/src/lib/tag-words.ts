import { ClientQueryShape, GridEvent } from '@core/systems';

/*
 * The staff day's lowercase words for two ecs-core tag families (UI residue
 * cleanup §2.2, UR-3) — read only inside this lib, so they live beside
 * their readers rather than in `@creativo/infrastructure/i18n`. The tags are
 * SCREAMING; the words are what the DOM has always printed. ONE table per
 * family; they retire the time grid's and the omnibox's old word-to-tag
 * round trips — the components carry the tag, and only the DOM reads a word.
 */

/**
 * A grid block's kind as its `data-kind` value — the word the time grid's
 * and the timeline's CSS select on (`[data-kind='block']`, `[data-kind='gap']`).
 */
export const gridEventWords = {
  [GridEvent.Visit]: 'visit',
  [GridEvent.Gap]: 'gap',
  [GridEvent.Block]: 'block',
} as const satisfies Record<GridEvent, string>;

/**
 * Which part of a typed omnibox query leads, as the search field's
 * `uiIconKind` (printed as its `data-kind`) and the new-client rows' test-id
 * suffix (`staff-visit-new-client-name|phone|email`) spell it.
 */
export const clientQueryShapeWords = {
  [ClientQueryShape.Empty]: 'empty',
  [ClientQueryShape.Name]: 'name',
  [ClientQueryShape.Phone]: 'phone',
  [ClientQueryShape.Email]: 'email',
} as const satisfies Record<ClientQueryShape, string>;
