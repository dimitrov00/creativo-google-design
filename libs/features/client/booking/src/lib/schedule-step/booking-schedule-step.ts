import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  type Observable,
  combineLatest,
  distinctUntilChanged,
  map,
  of,
  switchMap,
} from 'rxjs';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  AVAILABILITY_READER,
  BOOKING_POLICY_READER,
  BookingPolicy,
  CalendarDay,
  ObserveDayAvailabilityUseCase,
  type ObserveDayAvailabilityInput,
  ObserveRangeCapacityUseCase,
  type ScheduleSelection,
  ZonedDateTime,
} from '@creativo/application/booking';
import type { BookingCart, MoveRider } from '@creativo/application/booking';
import {
  BarberId as BarberKey,
  type BookingCart as CartData,
  BookingCartSystem,
  CartLineId as LineKey,
  type CartRider,
  type CartServiceScope,
  DurationMinutes,
  LocationId as LocationKey,
  MinuteCount,
  MinuteDelta,
  SeatKeyText,
  ServiceId as ServiceKey,
  ServiceVariantId as VariantKey,
  defect,
} from '@creativo/ecs-core';
import {
  BarberId,
  type LocationId,
  type Service,
} from '@creativo/application/catalog';
import { CLOCK } from '@creativo/application/shared';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  CatalogContentService,
  CatalogPresenter,
} from '@creativo/features/shared/catalog';
import { NgTemplateOutlet } from '@angular/common';
import { UiButton, UiIcon } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiCalendarGrid,
  UiCalendarScroller,
  UiDateBadge,
  UiSectionHeader,
} from '@creativo/ui/patterns';
import { BookingFlowStore } from '../booking-flow.store';
import { bookingSignInReturnUrl } from '../booking-return-url';
import {
  BookingChromeAccessory,
  BookingStepTitle,
} from '../chrome/booking-chrome.service';
import { BookingStepLayout } from '../step-layout/booking-step-layout';
import { BookingTimeSheet } from './time-sheet/booking-time-sheet';
import { sameDayQuery } from './same-day-query';
import {
  type AvailabilityDayCell,
  type AvailabilityMonth,
  type ScheduleDayVm,
  type ScheduleMonthVm,
  buildAvailabilityMonths,
  horizonQueryRange,
} from './availability-month';

/**
 * Step 3 — when.
 *
 * ### The whole step is one calendar
 * It used to be a paged month grid with a list of times under it, which asked
 * two questions on one screen and answered neither well: the grid was small
 * enough to be an accessory, and paging to next month meant a button press
 * that hid the boundary — the last week of August and the first of September
 * are the same fortnight to someone deciding when to come in.
 *
 * Now the calendar IS the screen: a continuous run of months from today to the
 * booking horizon, its heading scrolling away under the wizard's toolbar and
 * the Mo–Su key pinning beneath it, with cells large enough to be the primary
 * target (`ui-calendar-scroller` + `ui-calendar-grid uiSize="large"`). Times
 * moved into a sheet, reached from the toolbar, which is the same
 * docked-decision shape the services step already uses — one bar, at the
 * bottom, naming the outcome.
 *
 * ### ONE way to answer "when"
 * A day and a time. Tap a day, "Choose time", pick from the sheet.
 *
 * There was briefly a second way — a toggle that turned the calendar
 * multi-select so several days could be searched at once, each narrowed to
 * its own hours. It is gone (owner ruling 2026-08-01): it earned a mode, a
 * second sheet layout and a per-day window editor for a question most people
 * never ask, and every control it touched had to branch on it. The waitlist
 * survives it as the bell in the sheet's bar, watching the one chosen day.
 *
 * ### The days the projection cannot answer
 * The calendar's grey/live split comes from a coarse per-day capacity
 * projection. It never sees `now`, and it counts a moved visit's own chairs
 * as taken, so today and a move's own day are answered by the real day query
 * instead — see {@link isBookable}.
 *
 * ### A shop that cannot serve the visit says so
 * The grid runs a shop only if it offers every service on the visit, the
 * cart's and the ones a move carries (`shopsServingParty`), because the
 * server refuses a seat at a shop that does not offer its service. The
 * capacity projection knows nothing of services. Left alone, a shop the
 * party cannot be served at would show a calendar of live days whose every
 * sheet says "busy", with a waitlist bell for a shop that will never serve
 * it. So the step asks the same rule first ({@link shopReach}): such a shop
 * greys the calendar and SAYS why, with the one tap to a shop that can.
 *
 * ### Everything here is an OFFER
 * The grid is computed in the browser from live geometry. The authority is
 * `commitBooking`, which re-runs the identical engine inside a transaction.
 * A slot that goes while the user is deciding comes back as a bounce on the
 * review step — never a silent success against stale data.
 */
@Component({
  selector: 'lib-booking-schedule-step',
  imports: [
    BookingChromeAccessory,
    BookingStepLayout,
    BookingStepTitle,
    BookingTimeSheet,
    NgTemplateOutlet,
    TranslocoDirective,
    UiButton,
    UiCalendarGrid,
    UiCalendarScroller,
    UiDateBadge,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    // Without this the cells' `uiRadius="capsule"` sits inert in the DOM and
    // the hover ink paints a SQUARE behind a round selected badge — the two
    // states of one control disagreeing about its own shape.
    UiRadiusDirective,
    UiSectionHeader,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './booking-schedule-step.html',
  // The time-pick renders the SHARED select recipe (booking-select.css) — the
  // same pill the services sheet and the bag dock, so the three cannot drift.
  styleUrls: ['./booking-schedule-step.css', '../chrome/booking-select.css'],
  host: { 'data-testid': 'booking-schedule-step' },
})
export class BookingScheduleStep {
  private readonly transloco = inject(TranslocoService);
  private readonly clock = inject(CLOCK);
  private readonly availability = inject(AVAILABILITY_READER);
  private readonly policyReader = inject(BOOKING_POLICY_READER);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly accountState = inject(AccountStateService);

  protected readonly catalog = inject(CatalogContentService);
  protected readonly content = inject(CatalogPresenter);
  protected readonly store = inject(BookingFlowStore);

  private readonly observeCapacity = new ObserveRangeCapacityUseCase(
    this.availability,
  );

  /** The days the projection cannot answer — see {@link exactDays}. */
  private readonly observeExact = new ObserveDayAvailabilityUseCase(
    this.availability,
  );

  /**
   * Tenant policy, through the port.
   *
   * The horizon this calendar runs to is a shop's decision, not a constant —
   * and it is the number most visibly on screen here, since it is literally
   * how far the page scrolls. `BookingPolicy.default()` is the adapter's
   * fallback, so this reads the same before any admin surface exists.
   */
  protected readonly policy = toSignal(this.policyReader.observe(), {
    initialValue: BookingPolicy.default(),
  });

  protected readonly selectedDayKey = this.store.selectedDayKey;

  // ── Where ───────────────────────────────────────────────────────────

  protected readonly locations = computed(() => this.catalog.locations());

  private readonly location = computed(() => {
    const chosen = this.store.locationId();
    if (!chosen) return null;
    return (
      this.locations().find((candidate) => candidate.id.equals(chosen)) ?? null
    );
  });

  /**
   * The SHOP's zone, never the device's (§7.1).
   *
   * Under "any shop" the shops must agree, and in this tenant they do — a
   * single city. A chain spanning zones would have to render each option in
   * its own shop's clock, which is a different design and a different problem.
   */
  protected readonly zone = computed(
    () =>
      this.location()?.timezone ??
      this.locations().at(0)?.timezone ??
      'Europe/Sofia',
  );

  /**
   * EVERY active barber — the ROSTER decides who works where, not the barber's
   * editorial `locationIds`.
   */
  private readonly barberIds = computed<readonly BarberId[]>(() =>
    this.catalog.barbers().map((barber) => barber.id),
  );

  /**
   * The chairs the projection is asked about: the barbers the visit's lines
   * accept (`BookingCart.acceptedBarbers`), not every active one.
   *
   * The same reasoning as the shop below, one level down. Asked about every
   * barber, a "same again with Ivan" bag saw every Friday live at Center —
   * Niko and Stefan have room there, Ivan works Mladost that day — and each
   * of those days opened a sheet that could only say "busy" (2026-09-26).
   * A chair no line accepts can never make a day bookable for this visit.
   */
  private readonly capacityBarberIds = computed<readonly BarberId[]>(() => {
    const cart = this.store.cart();
    const pool = this.barberIds();
    return cart ? cart.acceptedBarbers(pool) : pool;
  });

  // ── Which shops can serve this visit ────────────────────────────────

  /**
   * The active shops that offer every service on the visit, the cart's and
   * the ones a move carries: `shopsServingParty`, the rule the grid runs a
   * shop by and the server refuses a seat by.
   *
   * `null` until the services and the shops have both answered
   * SUCCESSFULLY (`servicesKnown`, `locationsKnown`): an empty list that is
   * pending or failed is not "no shop serves this".
   *
   * `null` too for an answered list with no active shop in it. The question
   * here is which shops the visit's SERVICES shut out, and with no shop at
   * all no change to the services would open one: «Промени услугите» would
   * send the client round a loop. That is a shop outage, not this notice's.
   */
  private readonly servingShops = computed<readonly LocationId[] | null>(() => {
    const cart = this.store.cart();
    if (
      !cart ||
      !this.catalog.servicesKnown() ||
      !this.catalog.locationsKnown()
    ) {
      return null;
    }
    const shops = this.locations();
    if (shops.length === 0) return null;
    // `BookingCartSystem.shopsServingParty` — the shops, in the order given,
    // that offer every service on the visit.
    const serving = BookingCartSystem.shopsServingParty(
      BookingCartSystem.partyServicesOf(
        toCartData(cart),
        this.store.availabilityRiders().map(toCartRider),
      ),
      this.catalog.services().map(toServiceScope),
      shops.map((shop) => LocationKey.of(shop.id.value)),
    );
    return shops
      .filter((shop) => serving.includes(LocationKey.of(shop.id.value)))
      .map((shop) => shop.id);
  });

  /**
   * Can the chosen shop serve this visit, and if not, where can it be?
   *
   * - `served`: the grid answers. Under "any shop" that holds whenever ONE
   *   active shop can, since the grid runs only those.
   * - `elsewhere`: the chosen shop does not offer something on the visit,
   *   and another shop does. The way there is one tap: the shop, when one
   *   alone can serve it, else "any shop", which runs exactly the ones that
   *   can.
   * - `nowhere`: no active shop offers everything on the visit together.
   *   Only a change to the services can fix that. A move whose CARRIED seats
   *   no one active shop serves together never gets here: the shell ends it
   *   in the call panel (`carriedSeatsInReach` asks about all of them at
   *   once), because a change to the client's own services cannot fix a
   *   companion's.
   *
   * A chosen shop that is not on the active list is not this question's to
   * answer (it would read as "does not offer your services", which is not
   * why), so it counts as served.
   */
  protected readonly shopReach = computed<ShopReach>(() => {
    const serving = this.servingShops();
    if (serving === null) return SERVED;
    const chosen = this.store.locationId();
    if (chosen === null) {
      return serving.length > 0 ? SERVED : { kind: 'nowhere' };
    }
    const chosenShop = this.location();
    if (!chosenShop || serving.some((id) => id.equals(chosen))) return SERVED;
    if (serving.length === 0) return { kind: 'nowhere' };

    const only = serving.length === 1 ? serving[0] : undefined;
    const target = only
      ? this.locations().find((shop) => shop.id.equals(only))
      : undefined;
    return {
      kind: 'elsewhere',
      shop: this.shopName(chosenShop),
      target: target
        ? { locationId: target.id, name: this.shopName(target) }
        : null,
    };
  });

  /**
   * `shopReach` as the calendar needs it: a boolean, so a fresh notice for
   * the same answer (a locale change renames the shops) does not re-derive
   * every cell of the run.
   */
  private readonly shopServed = computed(
    () => this.shopReach().kind === 'served',
  );

  private shopName(shop: {
    readonly name: { readonly en: string; readonly bg: string };
  }): string {
    return this.content.text({ en: shop.name.en, bg: shop.name.bg });
  }

  /**
   * Take the visit to a shop that can serve it: the one the notice names,
   * or "any shop" (`null`), which runs every shop that can. The day and the
   * time are dropped with the shop, as on the location step.
   */
  protected switchShop(locationId: LocationId | null): void {
    this.store.selectLocation(locationId);
  }

  // ── When ────────────────────────────────────────────────────────────

  private readonly now = computed<ZonedDateTime | null>(() => {
    const result = this.clock.now(this.zone());
    return result.isSuccess() ? result.value : null;
  });

  protected readonly today = computed<CalendarDay | null>(() => {
    const now = this.now();
    return now ? CalendarDay.fromZonedDateTime(now) : null;
  });

  /** The last bookable day — the policy's own calendar walk, in months. */
  private readonly horizonEnd = computed<CalendarDay | null>(() => {
    const today = this.today();
    return today ? this.policy().horizonEndFrom(today) : null;
  });

  private readonly rawMonths = computed<readonly AvailabilityMonth[]>(() => {
    const today = this.today();
    const horizonEnd = this.horizonEnd();
    if (!today || !horizonEnd) return [];
    return buildAvailabilityMonths({
      today,
      horizonEnd,
      capacityByDay: this.capacityByDay(),
    });
  });

  /**
   * The spine, with every per-cell fact already resolved.
   *
   * Selection is deliberately NOT in here. Everything else — the label, the
   * resting state, bookability — depends only on the data, so it is computed
   * once per capacity/locale change instead of once per cell per
   * change-detection cycle. The template used to call `dayState`, `dayAria`,
   * `isBookable` and `hasWindows` per cell, and `dayAria` ran an
   * `Intl.format` AND a translation each time, so a single tap on a day
   * re-derived ~200 aria labels before the new selection could paint. Leaving
   * selection out is what keeps this cheap: a tap changes one signal that the
   * template answers with a string compare, and this whole computed does not
   * re-run at all.
   */
  protected readonly months = computed<readonly ScheduleMonthVm[]>(() =>
    this.rawMonths().map((month) => ({
      ...month,
      weeks: month.weeks.map((week) =>
        week.map((cell) => (cell === null ? null : this.describe(cell))),
      ),
    })),
  );

  /** One cell's resting facts — everything except whether it is selected. */
  private describe(cell: AvailabilityDayCell): ScheduleDayVm {
    // A shop that cannot serve the visit has no bookable day, whatever its
    // chairs say: the grid runs nothing there (`shopReach`).
    const bookable = this.shopServed() && this.isBookable(cell);
    const date = this.dateAriaFormat().format(
      new Date(cell.day.startOfDay().toMillis()),
    );
    return {
      day: cell.day,
      dayKey: cell.dayKey,
      dayOfMonth: cell.dayOfMonth,
      isToday: cell.isToday,
      bookable,
      // ONE language for "you cannot book this day". Splitting the ink by
      // WHY — 'outside' (secondary) for past/beyond-horizon, 'unavailable'
      // (tertiary) for full — made today-when-full dimmer than the past days
      // beside it, which read as three different rules where a person sees
      // one fact. The reason lives in the aria label; the ink says only
      // yes-or-no.
      state: bookable ? 'plain' : 'unavailable',
      aria: this.transloco.translate(
        bookable ? 'booking.schedule.dayFree' : 'booking.schedule.dayFull',
        { date },
      ),
    };
  }

  /**
   * "Август", "Септември 2027".
   *
   * Capitalized deliberately, and worth a note: Bulgarian orthography writes
   * month names in lower case in running prose, and `Intl` is right to return
   * "август". This is not running prose — it is a heading that titles a block,
   * where the typographic convention wins (owner ruling 2026-08-01).
   *
   * Done on the string rather than with `text-transform: capitalize`, which
   * would also capitalize the second word of a two-word label and cannot be
   * told which locales it should leave alone.
   */
  /**
   * Formatters, built ONCE per locale/zone and reused.
   *
   * `Intl.DateTimeFormat` construction is the expensive half of the API, and
   * these are called per CELL per change-detection cycle — constructing them
   * inline meant every tap on a day paid for ~200 fresh formatters before the
   * selection could paint, which is the stutter that read as a glitch.
   */
  private readonly monthFormat = computed(
    () =>
      new Intl.DateTimeFormat(this.content.locale(), {
        month: 'long',
        timeZone: this.zone(),
      }),
  );

  private readonly monthWithYearFormat = computed(
    () =>
      new Intl.DateTimeFormat(this.content.locale(), {
        month: 'long',
        year: 'numeric',
        timeZone: this.zone(),
      }),
  );

  private readonly dateAriaFormat = computed(
    () =>
      new Intl.DateTimeFormat(this.content.locale(), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: this.zone(),
      }),
  );

  private readonly timeFormat = computed(
    () =>
      new Intl.DateTimeFormat(this.content.locale(), {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: this.zone(),
      }),
  );

  /** Takes the anchor structurally, so the raw month and its VM both fit. */
  protected monthLabel(month: { readonly anchor: CalendarDay }): string {
    const locale = this.content.locale();
    // The year is stated only when it is not this one — "August" needs no
    // qualification in August, and "August 2026" on every heading is noise
    // that the scroll position already answers.
    const format =
      month.anchor.year === (this.today()?.year ?? month.anchor.year)
        ? this.monthFormat()
        : this.monthWithYearFormat();
    const label = format.format(new Date(month.anchor.startOfDay().toMillis()));

    // Capitalized on the string, deliberately: Bulgarian writes month names
    // lower-case in prose and `Intl` is right to return "август" — but this
    // is a heading, where the typographic convention wins (owner ruling
    // 2026-08-01). Not `text-transform: capitalize`, which would also
    // capitalize the year-bearing second word.
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  }

  /** Mon-first weekday initials, localized — labels are never modeled as data. */
  protected readonly weekdayLabels = computed(() => {
    const formatter = new Intl.DateTimeFormat(this.content.locale(), {
      weekday: 'short',
      timeZone: 'UTC',
    });
    // 2024-01-01 was a Monday; UTC keeps the walk zone-independent.
    return Array.from({ length: 7 }, (_, index) =>
      formatter.format(Date.UTC(2024, 0, 1 + index)),
    );
  });

  // ── Live reads ──────────────────────────────────────────────────────

  /**
   * ONE capacity query for the whole run, not one per month.
   *
   * Derived from today and the horizon rather than from `months()` — `months()`
   * is built FROM this query's result, so reading it here would make the query
   * depend on its own output.
   */
  private readonly capacityQuery = computed(() => {
    const today = this.today();
    const horizonEnd = this.horizonEnd();
    const barberIds = this.capacityBarberIds();
    if (!today || !horizonEnd || barberIds.length === 0) return null;
    const range = horizonQueryRange(today, horizonEnd);
    return range
      ? { locationId: this.capacityLocationId(), range, barberIds }
      : null;
  });

  /**
   * The shop the projection is asked about: the chosen one or, under "any
   * shop", the ONE active shop that can serve the visit when only one can.
   *
   * The projection knows nothing of services, and the grid runs only the
   * shops that can serve the party. Asked about every shop, it would mark a
   * day live for chairs at a shop the grid never runs for this visit, and
   * that day's sheet could only say "busy". With several serving shops among
   * more, the projection still counts them all: it takes one shop or every
   * shop, and the sheet stays the authority.
   */
  private readonly capacityLocationId = computed<LocationId | null>(() => {
    const chosen = this.store.locationId();
    if (chosen !== null) return chosen;
    const serving = this.servingShops();
    return serving !== null && serving.length === 1
      ? (serving[0] ?? null)
      : null;
  });

  private readonly capacityResult = toSignal(
    toObservable(this.capacityQuery).pipe(
      // STRUCTURAL identity, not object identity. The computed above mints a
      // fresh literal per recompute, and `switchMap` on raw identity answered
      // every no-op recompute by tearing down and re-billing the whole
      // listener set — the single largest avoidable read cost in the app.
      // Re-subscribe only when the QUERY genuinely changes.
      distinctUntilChanged(
        (a, b) => capacityQueryKey(a) === capacityQueryKey(b),
      ),
      switchMap((input) =>
        input === null ? of(null) : this.observeCapacity.execute(input),
      ),
    ),
    { initialValue: null },
  );

  private readonly capacityByDay = computed<ReadonlyMap<string, number>>(() => {
    const result = this.capacityResult();
    return result?.isSuccess() ? result.value : new Map();
  });

  // ── Bookability ─────────────────────────────────────────────────────

  /**
   * Can this day still be booked?
   *
   * The cheap capacity projection answers every day but the ones it CANNOT
   * answer, which are asked the real day query instead ({@link exactDays}).
   * Until that answer lands, today stays live (so it does not flicker grey
   * and back on every load) and every other day keeps the projection.
   */
  private isBookable(cell: AvailabilityDayCell): boolean {
    if (cell.outOfRange) return false;
    const exact = this.exactAnswers()?.get(cell.dayKey);
    if (exact !== undefined) return exact;
    return cell.isToday || cell.freeMinutes > 0;
  }

  /**
   * The days the projection cannot answer, each asked the REAL day query,
   * the same engine the time sheet runs:
   * - TODAY, the one day the clock matters to. `observeRangeCapacity`
   *   reports a coarse free-minute total per day and never sees `now`, so at
   *   21:00 today still looked as open as it did at 09:00: a tappable day
   *   whose sheet then had nothing in it.
   * - the day the visit being MOVED sits on now. The projection counts the
   *   visit's own chairs as taken, while its own seats never block its own
   *   move, so a day it alone fills may still take it. Only the exact query,
   *   the release included, can say, and it says exactly what the sheet will
   *   show. A projection-free "keep it tappable" would promise a sheet that
   *   is empty whenever the release is not honoured.
   */
  private readonly exactDays = computed<readonly CalendarDay[]>(() => {
    const today = this.today();
    if (!today) return [];
    const zone = this.zone();
    const days = new Map([[today.key(), today]]);
    for (const chair of this.store.moveRelease()) {
      const start = ZonedDateTime.fromMillis(chair.occupied.startMs, zone);
      if (start.isFailure()) continue;
      const day = CalendarDay.fromZonedDateTime(start.value);
      // A day gone by has no cell to answer for.
      if (!day.isBefore(today)) days.set(day.key(), day);
    }
    return [...days.values()];
  });

  /**
   * One live query per exact day. Worth it: today is the difference between
   * "grey because the shop is closed" and "tappable at 22:00 and lying about
   * it", and a move's own day is the one it most often lands back on.
   */
  private readonly exactQueries = computed<
    readonly ObserveDayAvailabilityInput[] | null
  >(() => {
    const cart = this.store.cart();
    const now = this.now();
    if (!cart || !now) return null;
    const query = {
      cart,
      services: this.catalog.services(),
      barberIds: this.barberIds(),
      locationId: this.store.locationId(),
      policy: this.policy(),
      now,
      // Everybody a MOVE carries, pinned to the party's start, for the
      // engine's rider check (`AvailabilityQuery.riders`): a start where one
      // of them cannot sit is not offered, because the server would refuse
      // it (`booking.reschedule.carried_seat_unplaceable`).
      riders: this.store.availabilityRiders(),
      // …and the visit's own chairs, handed back: its own seats never block
      // its own move, for the cart's lines and the riders alike.
      release: this.store.moveRelease(),
    };
    return this.exactDays().map((day) => ({ ...query, day }));
  });

  /** Each exact day's answer, by day key, once all of them have answered. */
  private readonly exactAnswers = toSignal(
    toObservable(this.exactQueries).pipe(
      // The capacity stream's structural guard, one query at a time.
      distinctUntilChanged((a, b) =>
        a === null || b === null
          ? a === b
          : a.length === b.length &&
            a.every((query, index) => sameDayQuery(query, b.at(index) ?? null)),
      ),
      switchMap((queries): Observable<ReadonlyMap<string, boolean> | null> => {
        if (queries === null) return of(null);
        // `combineLatest([])` completes without emitting; no day is no answer.
        if (queries.length === 0) return of(new Map());
        return combineLatest(
          queries.map((query) =>
            this.observeExact
              .execute(query)
              .pipe(
                map((result): readonly [string, boolean] => [
                  query.day.key(),
                  result.isSuccess() && result.value.options.length > 0,
                ]),
              ),
          ),
        ).pipe(map((answers) => new Map(answers)));
      }),
    ),
    { initialValue: null },
  );

  // ── Commands ────────────────────────────────────────────────────────

  protected selectDay(cell: ScheduleDayVm): void {
    if (!cell.bookable) return;
    this.store.selectDay(cell.dayKey, this.zone());
  }

  /**
   * Watch the chosen day — the bell in the sheet's bar.
   *
   * One day, because there is only ever one: the multi-date search was removed
   * as over-complication (owner ruling 2026-08-01). `submitWaitlist` sends
   * `state.when`, and a single-day pick lives in `selectedDayKey`, so the day
   * has to be declared first — `watchOnly` does exactly that, replacing rather
   * than adding so a restored draft's days cannot ride along.
   *
   * Signed-out, this routes to auth FIRST rather than letting the server
   * refuse: a waitlist request is a promise to notify someone, and there is
   * nobody to notify yet. The draft carries the declaration across the round
   * trip, so it costs nothing the user assembled.
   */
  protected async watchSelectedDay(): Promise<void> {
    if (this.store.pending()) return;

    const day = this.selectedDay();
    if (!day) return;
    this.store.watchOnly(day);

    if (this.accountState.principal().kind !== 'active') {
      // The same return the review step builds, sources and all — see
      // `bookingSignInReturnUrl`.
      await this.router.navigate(['/auth'], {
        queryParams: {
          redirect: bookingSignInReturnUrl(this.router, this.router.url),
        },
      });
      return;
    }
    await this.store.submitWaitlist();
  }

  /**
   * Bring TODAY into view — the way back from a long scroll, and where the
   * step opens.
   *
   * Anchored on today's own cell rather than on its month. The run starts at
   * the 1st because a month grid that begins mid-month is not a month grid,
   * but that means the current month is mostly days nobody can book — on the
   * 31st, an entire screen of grey before anything tappable. Landing on the
   * cell puts the first bookable day where the eye already is; `scroll-margin`
   * in the stylesheet keeps it clear of the pinned weekday row.
   */
  protected scrollToToday(
    behavior: ScrollBehavior = 'smooth',
    block: ScrollLogicalPosition = 'start',
  ): void {
    afterNextRender(
      () => {
        const key = this.today()?.key();
        const cell = this.host.nativeElement.querySelector(
          `[data-day-key="${key}"]`,
        );
        // jsdom has no layout and no `scrollIntoView` — this is polish, and
        // polish never throws in an environment that cannot do it.
        cell?.scrollIntoView?.({ block, behavior });
      },
      { injector: this.injector },
    );
  }

  /**
   * Open on today, unless the user already chose a day.
   *
   * `nearest`, NOT `start`: on the 1st, today is already in the first row, and
   * forcing it to the top of the scroll box scrolled the step's own heading
   * away before the user had touched anything — the screen opened with its
   * title already collapsed into the bar and half a row of dates dissolving
   * under it. `nearest` scrolls the minimum, which is nothing at all when
   * today is on screen. The BUTTON still uses `start`, because a deliberate
   * "back to today" from three months out should land today at the top.
   *
   * Coming back from review must land where they left off — the same reason
   * the machine keeps the location across a step back. The jump is
   * unanimated: there is nothing on screen yet for an animation to explain.
   */
  constructor() {
    if (this.selectedDayKey() === null) this.scrollToToday('auto', 'nearest');

    // A waitlist match landed here through its notification: the freed day
    // is already selected — open its times without another tap, because the
    // notification promised a live search, not homework.
    if (this.store.consumeWaitlistArrival() && this.selectedDayKey() !== null) {
      this.timeOpen.set(true);
    }
  }

  // ── The sheet ───────────────────────────────────────────────────────

  protected readonly timeOpen = signal(false);

  /** The day the time sheet is about in SINGLE mode, as a domain value. */
  protected readonly selectedDay = computed<CalendarDay | null>(() => {
    const key = this.selectedDayKey();
    if (!key) return null;
    const day = CalendarDay.create(key, this.zone());
    return day.isSuccess() ? day.value : null;
  });

  /**
   * Is there anything for the sheet to be ABOUT yet?
   *
   * One day in single mode, at least one declared day in multi-select. The
   * pick is present in both modes and only ever changes its enabled state —
   * a control that vanishes when you toggle a neighbouring one is the bar
   * churn this step was rebuilt to stop.
   *
   * Never at a shop that cannot serve the visit (`shopReach`): its sheet
   * could only say "busy" and offer a waitlist for times that shop will
   * never have for this party.
   */
  protected readonly canOpenTimes = computed(
    () => this.selectedDay() !== null && this.shopServed(),
  );

  // ── The forward move ────────────────────────────────────────────────

  /**
   * The arrangement the time sheet's Confirm handed back — WHERE, WHEN and by
   * whom, ready for the machine.
   *
   * Held here rather than dispatched by the sheet itself because confirming a
   * time is no longer the step's exit: the CTA below is, exactly as on the
   * services step, where the sheet configures and the bar advances. Validity
   * is re-derived against the store's own start (below) so a `slot_unavailable`
   * bounce — which clears the start — cannot leave a stale offer armed.
   */
  private readonly pendingSelection = signal<ScheduleSelection | null>(null);

  /** The pending arrangement, IF it still describes the chosen start. */
  private readonly validSelection = computed<ScheduleSelection | null>(() => {
    const selection = this.pendingSelection();
    const startMs = this.store.selectedStartMs();
    if (!selection || startMs === null) return null;
    return selection.timeSlot.start.toMillis() === startMs ? selection : null;
  });

  /**
   * What the time-pick states: the chosen time, or the question. The DAY is
   * already answered by the calendar behind it, so the pill only ever has to
   * carry the hour.
   */
  protected readonly timePickLabel = computed(() => {
    const selection = this.validSelection();
    return selection
      ? this.formatTime(selection.timeSlot.start.toMillis())
      : this.transloco.translate('booking.schedule.chooseTime');
  });

  /**
   * A plain forward move, like every other step — the time question lives in
   * the pick above it.
   */
  protected readonly forwardLabel = computed(() =>
    this.transloco.translate('booking.continue'),
  );

  /**
   * A time, in both modes. Multi-select widens the SEARCH, not what counts as
   * an answer: the machine's `select_schedule` takes one arrangement either
   * way, and "3 days declared" is not something the review step can show.
   */
  protected readonly forwardBlocked = computed(
    () => this.validSelection() === null,
  );

  protected advance(): void {
    const selection = this.validSelection();
    if (selection) this.store.selectSchedule(selection);
  }

  /** The sheet's Confirm: keep the offer, arm the CTA, put the sheet away. */
  protected onTimeConfirmed(selection: ScheduleSelection): void {
    this.pendingSelection.set(selection);
    this.timeOpen.set(false);
  }

  protected formatTime(millis: number): string {
    return this.timeFormat().format(new Date(millis));
  }
}

/**
 * The capacity query, flattened to a comparable string.
 *
 * The adapter listens to `capacity/{YYYY-MM}` month docs now, so the
 * listener set depends only on the RANGE; `barberIds` and `locationId` are
 * applied in its pure map. They stay in the key regardless: a change to
 * either must re-emit a recomputed capacity map, and re-subscribing two or
 * three month-doc listeners to get one is noise-level cost. `null` (query
 * not ready) never equals a real key, so readiness transitions still pass.
 */
function capacityQueryKey(
  query: {
    readonly locationId: { readonly value: string } | null;
    readonly range: {
      readonly from: { key(): string };
      readonly to: { key(): string };
    };
    readonly barberIds: readonly { readonly value: string }[];
  } | null,
): string {
  if (query === null) return '∅';
  return [
    query.locationId?.value ?? '*',
    query.range.from.key(),
    query.range.to.key(),
    query.barberIds.map((id) => id.value).join(','),
  ].join('|');
}

/** Can the chosen shop serve the visit — see `BookingScheduleStep.shopReach`. */
type ShopReach =
  | { readonly kind: 'served' }
  | {
      readonly kind: 'elsewhere';
      /** The chosen shop's name. */
      readonly shop: string;
      /** The one shop that can serve it, or `null` for "any shop". */
      readonly target: {
        readonly locationId: LocationId;
        readonly name: string;
      } | null;
    }
  | { readonly kind: 'nowhere' };

const SERVED: ShopReach = { kind: 'served' };

/* ── Legacy ↔ ECS converters (the shop rule is BookingCartSystem's) ────── */

function toServiceScope(service: Service): CartServiceScope {
  return {
    id: ServiceKey.of(service.id.value),
    locationIds: service.locationIds.map((id) => LocationKey.of(id.value)),
  };
}

/** A brand built from a stored value its own record already validated. */
function sure<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false },
  what: string,
): T {
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

function toCartRider(rider: MoveRider): CartRider {
  return {
    serviceId: ServiceKey.of(rider.serviceId.value),
    barberId: BarberKey.of(rider.barberId.value),
    offsetMinutes: sure(MinuteDelta.of(rider.offsetMinutes), 'an offset'),
    terms: {
      durationMinutes: sure(
        DurationMinutes.of(rider.terms.durationMinutes),
        'a sold duration',
      ),
      padBeforeMinutes: sure(
        MinuteCount.of(rider.terms.padBeforeMinutes),
        'a pad',
      ),
      padAfterMinutes: sure(
        MinuteCount.of(rider.terms.padAfterMinutes),
        'a pad',
      ),
    },
  };
}

function toCartData(cart: BookingCart): CartData {
  return {
    cartSeats: cart.entries().map(([text, lines]) => {
      const seatKey = SeatKeyText.of(text);
      return {
        seatKey,
        lines: lines.map((line) => ({
          lineId: LineKey.of(line.id.value),
          seatKey,
          serviceId: ServiceKey.of(line.serviceId.value),
          variantId:
            line.variantId === null
              ? null
              : VariantKey.of(line.variantId.value),
          barberId:
            line.barberPref.kind === 'specific'
              ? BarberKey.of(line.barberPref.barberId.value)
              : null,
          locationId: null,
        })),
      };
    }),
    cartNextSequence: cart.nextLineSequence,
  };
}
