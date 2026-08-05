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
import { distinctUntilChanged, of, switchMap } from 'rxjs';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  AVAILABILITY_READER,
  BOOKING_POLICY_READER,
  BookingPolicy,
  CalendarDay,
  ObserveDayAvailabilityUseCase,
  ObserveRangeCapacityUseCase,
  type ScheduleSelection,
  ZonedDateTime,
} from '@creativo/application/booking';
import { BarberId } from '@creativo/application/catalog';
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
import {
  BookingChromeAccessory,
  BookingStepTitle,
} from '../chrome/booking-chrome.service';
import { BookingStepLayout } from '../step-layout/booking-step-layout';
import { BookingTimeSheet } from './time-sheet/booking-time-sheet';
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
 * ### Today is the only day the clock matters to
 * The calendar's grey/live split comes from a coarse per-day capacity
 * projection that never sees `now`, so today alone is answered by the real
 * day query — see {@link isBookable}.
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

  /** Today only — the one day whose bookability depends on the clock. */
  private readonly observeToday = new ObserveDayAvailabilityUseCase(
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
    const bookable = this.isBookable(cell);
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
    const barberIds = this.barberIds();
    if (!today || !horizonEnd || barberIds.length === 0) return null;
    const range = horizonQueryRange(today, horizonEnd);
    return range
      ? { locationId: this.store.locationId(), range, barberIds }
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
   * TODAY is the only day where the clock matters, and it is the one day the
   * capacity projection cannot answer: `observeRangeCapacity` reports a coarse
   * free-minute total per day and never sees `now`, so at 21:00 today still
   * looked as open as it did at 09:00 — a tappable day whose sheet then had
   * nothing in it. So today, and only today, is answered by the REAL day query
   * ({@link todayHasOptions}), which runs the same engine the time sheet does
   * and does see the clock. Every other day keeps the cheap projection.
   */
  private isBookable(cell: AvailabilityDayCell): boolean {
    if (cell.outOfRange) return false;
    if (cell.isToday) return this.todayHasOptions();
    return cell.freeMinutes > 0;
  }

  /**
   * Today's real arrangements — one extra live query, for one day.
   *
   * Worth it: this is the difference between "today is grey because the shop
   * is closed" and "today is tappable at 22:00 and lies about it". `null`
   * (still loading) counts as bookable so the day does not flicker grey and
   * back on every load.
   */
  private readonly todayQuery = computed(() => {
    const cart = this.store.cart();
    const now = this.now();
    const today = this.today();
    if (!cart || !now || !today) return null;
    return {
      cart,
      services: this.catalog.services(),
      barberIds: this.barberIds(),
      locationId: this.store.locationId(),
      day: today,
      policy: this.policy(),
      now,
    };
  });

  private readonly todayResult = toSignal(
    toObservable(this.todayQuery).pipe(
      // Same structural guard as the capacity stream, plus the pieces this
      // query adds: the cart and the clock's "now" tick. References suffice
      // for cart/services — they change identity only on a real change.
      distinctUntilChanged((a, b) => {
        if (a === null || b === null) return a === b;
        return (
          a.cart === b.cart &&
          a.services === b.services &&
          a.day.key() === b.day.key() &&
          a.policy === b.policy &&
          a.now.toMillis() === b.now.toMillis() &&
          (a.locationId?.value ?? null) === (b.locationId?.value ?? null) &&
          a.barberIds.map((id) => id.value).join(',') ===
            b.barberIds.map((id) => id.value).join(',')
        );
      }),
      switchMap((input) =>
        input === null ? of(null) : this.observeToday.execute(input),
      ),
    ),
    { initialValue: null },
  );

  private readonly todayHasOptions = computed(() => {
    const result = this.todayResult();
    if (result === null) return true;
    return result.isSuccess() && result.value.options.length > 0;
  });

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
      await this.router.navigate(['/auth'], {
        queryParams: { redirect: '/book?step=schedule' },
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
   */
  protected readonly canOpenTimes = computed(() => this.selectedDay() !== null);

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
