import { OfferingPriceSystem } from '@core/systems';
import type { LocalizedText, Money } from '@core/components';
import type { Service, ShopLocation } from '@core/entities';
import {
  type BarberId,
  LocalDate,
  type ServiceId,
  type TimeZone,
  type UtcEpochMs,
} from '@core/primitives';
import type {
  UiChoiceOption,
  UiIconName,
  UiSegment,
} from '@creativo/ui/controls';
import type { UiAlertAction } from '@creativo/ui/patterns';
import {
  formatWallClock,
  formatZoneName,
  wallClockParts,
} from '@creativo/ui/wall-clock';
import { firstNameOf } from '@creativo/features/shared/visits';
import { formatDayPill, formatDayPillRange } from '../day-pill/day-pill.format';
import type { GridColumn } from '../time-grid/staff-time-grid';
import type {
  VisitEditorServiceOption,
  VisitEditorShopOption,
} from '../visit-editor/staff-visit-editor';
import { DiscardAnswer, SCOPE_ALL, type StaffTranslate } from './staff-day.vm';

/*
 * THE PAGE'S CHROME, WORDED (Law 10): the toolbar's pills and menus, a grid
 * column's head, the week strip's labels, the sheets' option lists. Pure — the
 * words, the catalogue's names and the locale arrive as inputs, and the page
 * calls these inside its `computed()`s. What a menu offers for sale is
 * `OfferingPriceSystem`'s; these name it.
 */

/** The catalogue as a presenter reads it — the page's live lookups. */
export interface StaffCatalogNames {
  readonly findService: (id: ServiceId) => Service | undefined;
  /** A localized pair in the reader's language (`CatalogWording.text`). */
  readonly text: (localized: LocalizedText) => string;
}

/** The chrome's words from the catalogue, read once. */
export interface StaffChromeWords {
  /** «Списък» — `staff.day.view.<id>`. */
  readonly viewName: (view: string) => string;
  /** «Всички бръснари» — `staff.day.scopeAll`. */
  readonly scopeAll: string;
  /** «Отхвърли» — `staff.visit.discard`. */
  readonly discard: string;
  /** «Продължи редакцията» — `staff.visit.keepEditing`. */
  readonly keepEditing: string;
  /** «Затвори» — `staff.day.cancelDismiss`. */
  readonly dismiss: string;
  /** The scroller's accessible name — `staff.day.gridRegion`. */
  readonly gridRegion: (period: string) => string;
}

/** The chrome's words, from the catalogue as it stands. */
export function staffChromeWordsOf(
  translate: StaffTranslate,
): StaffChromeWords {
  return {
    viewName: (view) => translate(`staff.day.view.${view}`),
    scopeAll: translate('staff.day.scopeAll'),
    discard: translate('staff.visit.discard'),
    keepEditing: translate('staff.visit.keepEditing'),
    dismiss: translate('staff.day.cancelDismiss'),
    gridRegion: (period) => translate('staff.day.gridRegion', { period }),
  };
}

/** The street line of a postal address — everything before its first comma. */
export function streetOf(address: string): string {
  const street = address.split(',')[0]?.trim() ?? '';
  return street.length > 0 ? street : address;
}

/**
 * THE SHOPS the «Салон» row offers — every active location, named in the
 * reader's language, pinned by its coordinates, with its STREET line as
 * the row's second line: the address up to its first comma. The city is
 * where the staff already are, and the row has two lines to spend.
 */
export function shopOptionsOf(
  locations: readonly ShopLocation[],
  names: Pick<StaffCatalogNames, 'text'>,
): readonly VisitEditorShopOption[] {
  return locations.map((location) => ({
    id: location.id,
    label: names.text(location.name),
    address: streetOf(names.text(location.address)),
    lat: location.latitude,
    lng: location.longitude,
  }));
}

/** What the service options are named and priced by. */
export interface ServiceOptionNames extends StaffCatalogNames {
  /** «28,00 €» — the client's catalogue's wording (`CatalogWording.price`). */
  readonly price: (money: Money) => string;
}

/**
 * The chair's menu: each service the catalogue still holds, an option per
 * offer. Which offers the chair's menu holds, at the terms the server
 * resolves, is `OfferingPriceSystem.offersOf`: the cents, the currency and the
 * minutes straight off `ServiceTerms` (D-10.3); the LABEL is those cents in
 * their own currency, worded as the client's catalogue words them.
 */
export function serviceOptionsOf(
  services: readonly {
    readonly id: ServiceId;
    readonly name: LocalizedText;
    readonly coverSrc?: string;
  }[],
  barberId: BarberId,
  names: ServiceOptionNames,
): readonly VisitEditorServiceOption[] {
  return services.flatMap((vm): VisitEditorServiceOption[] => {
    const service = names.findService(vm.id);
    // The VM is the entity's own (`serviceVms` maps `services`); one the list
    // no longer holds has no terms to quote.
    if (service === undefined) return [];
    const name = names.text(vm.name);
    return OfferingPriceSystem.offersOf(service, barberId).map(
      ({ variant, terms }): VisitEditorServiceOption => {
        const priced = {
          coverSrc: vm.coverSrc ?? null,
          minutes: terms.durationMinutes,
          priceCents: terms.priceCents,
          currency: terms.currency,
          priceLabel: names.price({
            amountCents: terms.priceCents,
            currency: terms.currency,
          }),
        };
        return variant === null
          ? {
              id: vm.id,
              serviceId: service.id,
              variantId: null,
              label: name,
              serviceLabel: name,
              ...priced,
            }
          : {
              id: `${vm.id}:${variant.variantId}`,
              serviceId: service.id,
              variantId: variant.variantId,
              label: `${name} · ${names.text(variant.name)}`,
              serviceLabel: name,
              variantLabel: names.text(variant.name),
              ...priced,
            };
      },
    );
  });
}

/**
 * "петък" → "Пет", "friday" → "Fri".
 *
 * THREE letters off the long name, not `Intl`'s `short`. English's short IS
 * three ("Fri"), but Bulgarian's is two ("пт") by CLDR convention — which read
 * as a different, terser system beside the reference. Slicing the long form
 * gives the idiomatic Bulgarian abbreviation (пон/вто/сря/чет/пет/съб/нед) and
 * leaves English exactly where it already was.
 */
export function abbreviateWeekday(long: string, locale: string): string {
  const three = long.slice(0, 3);
  return three.charAt(0).toLocaleUpperCase(locale) + three.slice(1);
}

function weekdayLabel(dayKey: LocalDate, locale: string): string {
  return abbreviateWeekday(
    formatTitled(dayKey, { weekday: 'long' }, locale),
    locale,
  );
}

/**
 * The weekday's one-letter form — the week strip's own, from the same
 * `Intl` narrow formatter, so a date column too narrow for a word writes
 * its day the way the strip above it does (never a second formatter: the
 * pickers may not differ in facts, 2026-09-04).
 */
function weekdayInitial(dayKey: LocalDate, locale: string): string {
  return formatWallClock(dayKey, null, locale, { weekday: 'narrow' });
}

/**
 * Format, with the MONTH capitalised.
 *
 * Bulgarian writes month names lowercase in prose ("7 август"), and `Intl`
 * follows the language. A heading is not prose — the reference's `May` is
 * title case, and "7 Август" reads as a label rather than a sentence
 * fragment. Only the month part is touched, so the day number and any
 * separators come back untouched, and English (already capitalised) is
 * unchanged.
 */
function formatTitled(
  at: LocalDate,
  options: Intl.DateTimeFormatOptions,
  locale: string,
): string {
  return wallClockParts(at, null, locale, options)
    .map((part) =>
      part.type === 'month'
        ? part.value.charAt(0).toLocaleUpperCase(locale) + part.value.slice(1)
        : part.value,
    )
    .join('');
}

/** A column's head — everything but what it holds. */
export type GridColumnHead = Omit<GridColumn, 'events' | 'open'>;

/**
 * A CHAIR's column head.
 *
 * THE HEAD AT THREE WIDTHS (2026-09-23, §4): the first name where the whole
 * one would truncate, the portrait alone below that; the whole name stays on
 * the accessible label.
 */
export function chairColumnHead(
  barberId: BarberId,
  name: string,
  isToday: boolean,
  avatarSrc: string | null,
): GridColumnHead {
  return {
    id: barberId,
    title: name,
    shortTitle: firstNameOf(name),
    initial: null,
    fullTitle: name,
    detail: null,
    dayNumber: null,
    isToday,
    avatarSrc,
  };
}

/**
 * A DATE's column head: the short weekday beside the capsule while the column
 * can carry a word; the weekday's INITIAL over it below that — the same narrow
 * form the week strip writes, from the same formatter (§4). The long date is
 * the accessible name at every width.
 */
export function dateColumnHead(
  dayKey: LocalDate,
  isToday: boolean,
  locale: string,
): GridColumnHead {
  return {
    id: dayKey,
    title: weekdayLabel(dayKey, locale),
    shortTitle: weekdayLabel(dayKey, locale),
    initial: weekdayInitial(dayKey, locale),
    fullTitle: formatTitled(
      dayKey,
      { weekday: 'long', day: 'numeric', month: 'long' },
      locale,
    ),
    detail: null,
    dayNumber: LocalDate.parts(dayKey).day,
    isToday,
    avatarSrc: null,
  };
}

/**
 * The zone abbreviation every time on this surface is stated in — "EEST"
 * in summer, "EET" in winter, resolved rather than hardcoded so it stays
 * true across the changeover (`formatZoneName`, the shared cached face; the
 * `en-GB` abbreviation whatever the reader's language).
 */
export function zoneLabelOf(
  nowUtcMs: UtcEpochMs,
  zone: TimeZone | null,
): string {
  return zone === null ? '' : formatZoneName(nowUtcMs, zone, 'en-GB');
}

/**
 * «ср, 9.09» for a day; «21 – 27.09» for a period — the pill's ONE
 * numeric grammar for both (2026-09-23, the grid views' design record
 * §9). The range used to be written in the long month («23 – 25
 * Септември») for a headline segment that no longer exists, and in the
 * pill it pushed the search and the chair picker off a 390px bar.
 */
export function periodLabelOf(
  days: readonly LocalDate[],
  locale: string,
): string {
  const first = days[0];
  // NO DAYS YET — a cold load before the shop's zone is read, when there
  // is no "today" to anchor a period on. The canvas binds its region
  // label off this before `store.ready()`, so it names nothing rather
  // than formatting a day that is not there (it threw on every load).
  if (first === undefined) return '';
  if (days.length <= 1) {
    /*
     * ⚠ THE WEEKDAY LEADS. (owner ruling 2026-09-04)
     *
     * This read `4 Септември` while the visit sheet's pill two taps away
     * read `пт, 4.09` — the same date, and one of them never said which
     * day of the week it was. The two pickers may differ in DENSITY, a
     * page title against a field value, and Apple's own apps do exactly
     * that; they must not differ in FACTS. In a barbershop a Saturday is
     * not a Tuesday, and the day a barber is standing in was the one
     * thing this label left out.
     */
    // The pill's own grammar — one formatter for both pickers.
    return formatDayPill(first, locale);
  }
  const last = days.at(-1) ?? first;
  return formatDayPillRange(first, last, locale);
}

/** How far the strip runs either side of this week. */
const WEEKS_BACK = 4;
const WEEKS_AHEAD = 8;

/** One day cell of the strip. */
export interface WeekStripDayVm {
  readonly key: LocalDate;
  readonly initial: string;
  readonly number: string;
  readonly today: boolean;
}

/** One week of the strip — a page of the slider. */
export interface WeekStripWeekVm {
  readonly key: LocalDate;
  readonly days: readonly WeekStripDayVm[];
}

/**
 * The strip's CELLS — thirteen weeks of them, none depending on which day is
 * SHOWN: the page's `weekCalendar` recomputes this only when the DATE or the
 * LOCALE turns over, and the two faces come from the shared, cached formatters
 * (`formatWallClock`) instead of two built per cell. No today before the shop's
 * zone is known: no strip to build.
 */
export function weekCalendarOf(
  today: LocalDate | null,
  locale: string,
): readonly WeekStripWeekVm[] {
  if (today === null) return [];
  const first = LocalDate.addDays(
    LocalDate.startOfWeek(today),
    -WEEKS_BACK * 7,
  );
  const weeks = WEEKS_BACK + WEEKS_AHEAD + 1;

  return Array.from({ length: weeks }, (_, w) => {
    const weekStart = LocalDate.addDays(first, w * 7);
    return {
      key: weekStart,
      days: Array.from({ length: 7 }, (_, d) => {
        const key = LocalDate.addDays(weekStart, d);
        return {
          key,
          // The weekday INITIAL, Apple's own strip: the column position
          // already says which day it is, so the letter is a reminder and
          // not a label.
          initial: formatWallClock(key, null, locale, { weekday: 'narrow' }),
          number: formatWallClock(key, null, locale, { day: 'numeric' }),
          today: key === today,
        };
      }),
    };
  });
}

/** A reading of the switcher: its id and its glyph. */
export interface StaffViewOption {
  readonly id: string;
  readonly icon: UiIconName;
}

/** The four readings, as `ui-choice-menu` options (owner, 2026-09-09). */
export function viewChoicesOf(
  views: readonly StaffViewOption[],
  words: StaffChromeWords,
): readonly UiChoiceOption[] {
  return views.map((view) => ({
    id: view.id,
    label: words.viewName(view.id),
    icon: view.icon,
    testId: `staff-view-${view.id}`,
  }));
}

/** The same four readings as SEGMENTS — the toolbar's icon pill. */
export function viewSegmentsOf(
  views: readonly StaffViewOption[],
  words: StaffChromeWords,
): readonly UiSegment[] {
  return views.map((view) => ({
    id: view.id,
    label: words.viewName(view.id),
    icon: view.icon,
    iconOnly: true,
    testId: `staff-view-segment-${view.id}`,
  }));
}

/** Everyone, then each chair — the scope switcher's options. */
export function scopeChoicesOf(
  chairs: readonly {
    readonly id: BarberId;
    readonly name: string;
    readonly avatarSrc: string | null;
  }[],
  words: StaffChromeWords,
): readonly UiChoiceOption[] {
  return [
    {
      id: SCOPE_ALL,
      label: words.scopeAll,
      testId: 'staff-scope-all',
    },
    ...chairs.map((option) => ({
      id: option.id,
      label: option.name,
      avatarSrc: option.avatarSrc,
      testId: `staff-scope-${option.id}`,
    })),
  ];
}

/**
 * The discard alert's two answers (2026-09-23): the destructive one, and the
 * safe one — bold, last in the stack, and what Escape and the scrim mean.
 */
export function discardActionsOf(
  words: StaffChromeWords,
): readonly UiAlertAction[] {
  return [
    {
      id: DiscardAnswer.Discard,
      label: words.discard,
      role: 'destructive',
      testId: 'staff-discard-confirm',
    },
    {
      id: DiscardAnswer.Keep,
      label: words.keepEditing,
      role: 'cancel',
      preferred: true,
      testId: 'staff-discard-keep',
    },
  ];
}

/** The zone notice's one way out. */
export function zoneActionsOf(
  words: StaffChromeWords,
): readonly UiAlertAction[] {
  return [
    {
      id: 'close',
      label: words.dismiss,
      role: 'cancel',
      preferred: true,
      testId: 'staff-zone-close',
    },
  ];
}
