import { LocalizedText } from '@core/components';
import type { ShopEvent, ShopLocation } from '@core/entities';
import type { RepositoryError } from '@core/errors';
import { type Result } from '@core/primitives';
import { ProgramsSystem } from '@core/systems';
import { namedShopsOf } from '@creativo/features/shared/catalog';
import { formatWallClock } from '@creativo/ui/wall-clock';
import type { EventRowVm } from './marketing-events.vm';
import { localeFor } from '@creativo/infrastructure/i18n';

/*
 * THE EVENTS PAGE'S WORDS (OR-37, Law 10) — the events as read in, the rows
 * `/events` prints out. It decides nothing: which events exist and their
 * order are the read's (upcoming soonest first, past latest first), the
 * shop an event is at is `ProgramsSystem.eventShop`'s, and whether there
 * are shops to tell apart is `LocationScopeSystem.isMultiShop`'s. It words
 * the title in the active language, the start on the shop's wall clock as
 * stored (`formatWallClock`, the shared cached formatter, once per row —
 * flip-4 OQ-8) and the shop by the name a line that already knows the
 * business calls it (`namedShopsOf`, the one shop-name wording of the
 * programs pages).
 *
 * The shops are named ONCE per emission (each read of events or shops),
 * and every row asks the system for its shop among those names. Unread or
 * failed, the shops name nothing: each row prints its date alone, and no
 * row is ever hidden for it.
 */

/** A row's date — «Mon, Oct 5, 07:00 PM» / «пн, 5.10, 19:00». */
const EVENT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
};

/** What the events page's rows are worded from. */
export type EventRowsInput = {
  /** The tab's events, in the read's order. */
  readonly events: readonly ShopEvent[];
  /** The ACTIVE shops as read — `undefined` until they answer. */
  readonly shops: Result<readonly ShopLocation[], RepositoryError> | undefined;
  /** The active UI language (`bg` | `en`; anything else reads its data as `bg`). */
  readonly lang: string;
  /** Where a row with no RSVP link of its own leads — the shop's Instagram. */
  readonly fallbackHref: string;
};

/** Every event's row, in the read's order. */
export function eventRowsVm(input: EventRowsInput): readonly EventRowVm[] {
  const locale = localeFor(input.lang);
  const named = namedShopsOf(input.shops, locale);
  const rows: EventRowVm[] = [];
  for (const event of input.events) {
    const date = formatWallClock(
      event.localDate,
      event.startMinutes,
      input.lang,
      EVENT_DATE_FORMAT,
    );
    const shop = ProgramsSystem.eventShop(event, named);
    rows.push({
      id: event.id,
      title: LocalizedText.pick(event.title, locale),
      whenLine: shop === null ? date : `${date} · ${shop.name}`,
      href: event.applyUrl ?? input.fallbackHref,
    });
  }
  return rows;
}
