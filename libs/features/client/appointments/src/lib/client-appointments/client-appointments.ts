import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { map, switchMap } from 'rxjs';
import {
  CLOCK_PORTS,
  SCHEDULING_READ_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  CatalogContentService,
  CatalogPresenter,
} from '@creativo/features/shared/catalog';
import {
  VisitFilterMenu,
  type VisitLookup,
  type VisitRowVm,
  type VisitSectionVm,
  type VisitWords,
  VisitsBrowser,
  matchesVisitFilter,
  sectionVisits,
  visitRowOf,
  visitSectionKey,
  visitSectionLabel,
  visitWordsOf,
} from '@creativo/features/shared/visits';
import {
  formatCents,
  formatInstant,
  formatMinute,
  formatWallClock,
  formatWeekdayLabels,
} from '@creativo/ui/wall-clock';
import {
  UiAvatar,
  UiBadge,
  UiBadgeTone,
  UiButton,
  UiIcon,
  UiModalSheet,
  UiTextField,
  UiSkeleton,
} from '@creativo/ui/controls';
import { UiSpacer, UiStack, UiToolbar } from '@creativo/ui/layout';
import {
  UiCalendarGrid,
  UiCalendarScroller,
  UiDateBadge,
  UiListGroup,
  UiListRow,
  UiNotice,
  UiPageActionBar,
  UiQuickAction,
  UiQuickActions,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import {
  UiFrameDirective,
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiPaddingDirective,
  UiRadiusDirective,
  UiTextDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import type { Appointment } from '@core/entities';
import {
  type AppointmentId,
  BookingErrorCode,
  BookingStatus,
  CancellationRefusalCode,
  LocalDate,
  UtcEpochMs,
} from '@core/primitives';
import {
  BookingLifecycle,
  BookingPolicy,
  Money,
  Principal,
  ServiceTerms,
  ShopReach,
  TimeCoordinate,
} from '@core/components';
import {
  CalendarGridSystem,
  CancellationPolicySystem,
  MoveSystem,
  ShopReachSystem,
  VisitFilter,
  VisitGrain,
  VisitPerspective,
} from '@core/systems';
import { LoadState } from '@creativo/shared/view-state';
import {
  bookingStatusWords,
  translateDomainError,
  wordPipelineError,
} from '@creativo/infrastructure/i18n';
import {
  AppointmentsStore,
  appointmentsStateWords,
} from '../appointments.store';
import type { ClientVisitVm } from '../visit-vm';
import { buildVisitIcs } from '../visit-ics';

type AppointmentsView = 'list' | 'calendar';

/**
 * How far the calendar reaches on first paint, and how much more it takes
 * each time the scroll approaches an end.
 *
 * A calendar you cannot scroll past your own history is a calendar that
 * feels broken — Apple's own scrolls to 1900 — but rendering a decade up
 * front is 5,000 cells nobody asked for. Half a year each way, then more as
 * the scroll asks for it.
 */
const INITIAL_MONTH_SPAN = 6;
const MONTH_SPAN_STEP = 6;
/** Two years either side. Past this, a person wants a date field, not a scroll. */
const MAX_MONTH_SPAN = 24;

const STATUS_TONES: Record<BookingStatus, UiBadgeTone> = {
  [BookingStatus.Pending]: 'neutral',
  [BookingStatus.Confirmed]: 'accent',
  [BookingStatus.Completed]: 'success',
  [BookingStatus.Cancelled]: 'destructive',
  [BookingStatus.NoShow]: 'warning',
};

/**
 * Empty until the client types something. The field is optional, and the
 * callable files any text as the client's own words (`other`), so a
 * prefilled sentence was recorded as their reason on every cancel nobody
 * explained — in English, on a Bulgarian screen — instead of `unspecified`.
 */
const DEFAULT_CANCEL_REASON = '';

const MS_PER_MINUTE = 60_000;

/** One day cell of the calendar view. */
interface VisitDayVm {
  readonly dayKey: string;
  readonly dayOfMonth: number | null;
  readonly isToday: boolean;
  readonly visits: readonly ClientVisitVm[];
}

/** One visit, both ways the page draws it: a row of the list, and the calendar's and the sheet's view model. */
interface PageVisit {
  readonly row: VisitRowVm;
  readonly visit: ClientVisitVm;
}

interface VisitMonthVm {
  readonly key: string;
  readonly label: string;
  readonly weeks: readonly (readonly VisitDayVm[])[];
}

/**
 * `/account/appointments` — a person's whole relationship with the shop, in
 * two views of the same data.
 *
 * ### Two lists, one truth
 * `AppointmentsStore` runs two bounded listeners: the open bookings (a
 * handful, no date bound) and the newest N past visits. This screen never
 * asks for more; "my history" grows forever and a screen that reads all of it
 * pays for every visit a loyal client ever made, on every mount.
 *
 * ### One browser, shared with the staff card
 * The list view is the shared visits BROWSER (`lib-visits-browser`,
 * `@creativo/features/shared/visits`, client-card revision 3 §3.11, R2-I):
 * the jump pills over the list, the scroll spy and the jump, and the same
 * rows, sections and funnel a barber reads a client's history with — in
 * the client's perspective, where a row opens the visit's sheet and the
 * barber is a face on the trailing edge. What stays here is the page's
 * own: the bar with the funnel, the calendar, the visit sheet and the
 * cancel flow, and the one length the browser asks its host for — how far
 * a heading stands clear of the floating bar when a pill lands on it
 * (`--visit-list-anchor-clearance`, client-appointments.css).
 *
 * ### The pills navigate, they do not filter
 * A filter row hides things; these jump. Every section stays on screen and
 * the pills say where you are — the Photos-app grammar, and the reason there
 * is a pill for "upcoming" and one per month that ACTUALLY holds a visit.
 * An option that leads nowhere is the one thing a filter row must not have.
 * They moved from this page into the browser value for value (same ids);
 * the page hands it the sections and hears which row was opened.
 *
 * ### A visit can be asked for
 * `/account/appointments?visit=<id>` opens that visit's sheet on arrival —
 * how `/account`'s «Предстоящ час» card lands here. The query is bound to
 * the `visit` input by the router's component input binding; the page
 * writes no URL back when the sheet closes.
 *
 * ### Cancelling lives in the visit sheet
 * A row states a fact; it does not carry a destructive button (a red glyph
 * repeated down a list turns a history into a list of things to delete). The
 * row opens the visit, and the visit is where the deadline, the honest
 * "window closed" line, and the cancel action live — the same
 * `CancellationPolicySystem.mayCancel` rule the server refuses by, so the
 * button never promises what the callable will deny.
 */
@Component({
  selector: 'lib-client-appointments',
  imports: [
    RouterLink,
    TranslocoDirective,
    UiAvatar,
    UiBadge,
    UiButton,
    UiCalendarGrid,
    UiCalendarScroller,
    UiDateBadge,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiModalSheet,
    UiNotice,
    UiPageActionBar,
    UiPaddingDirective,
    UiQuickAction,
    UiQuickActions,
    UiRadiusDirective,
    UiSheetActionBar,
    UiSkeleton,
    UiSpacer,
    UiStack,
    UiTextDirective,
    UiTextField,
    UiToolbar,
    UiWeightDirective,
    VisitFilterMenu,
    VisitsBrowser,
  ],
  providers: [AppointmentsStore],
  templateUrl: './client-appointments.html',
  styleUrl: './client-appointments.css',
  host: {
    'data-testid': 'appointments-page',
    '[attr.data-state]': 'dataState()',
    '[attr.data-view]': 'view()',
  },
})
export class ClientAppointments {
  private readonly accountState = inject(AccountStateService);
  private readonly clock = inject(CLOCK_PORTS);
  private readonly injector = inject(Injector);
  private readonly transloco = inject(TranslocoService);
  private readonly catalog = inject(CatalogContentService);
  private readonly content = inject(CatalogPresenter);

  protected readonly store = inject(AppointmentsStore);
  private readonly scheduling = inject(SCHEDULING_READ_PORTS);

  /** The load states, for the template's `@switch`. */
  protected readonly LoadState = LoadState;
  /** The funnel's choices, for the template's «clear the filter». */
  protected readonly VisitFilter = VisitFilter;
  /** Whose list this is, for the shared funnel and browser. */
  protected readonly VisitPerspective = VisitPerspective;

  /** The host's `data-state` — the e2e suite's lowercase word for the load state. */
  protected readonly dataState = computed(
    () => appointmentsStateWords[this.store.upcoming().loadState],
  );

  /**
   * The tenant's cancellation window — the SAME
   * `CancellationPolicySystem.mayCancel` rule the `cancelAppointment`
   * callable refuses by. A policy that cannot be read is the default one,
   * as an absent `settings/bookingPolicy` document is.
   */
  protected readonly policy = toSignal(
    this.scheduling
      .observePolicy()
      .pipe(
        map((result) => (result.ok ? result.value : BookingPolicy.DEFAULT)),
      ),
    { initialValue: BookingPolicy.DEFAULT },
  );

  protected readonly view = signal<AppointmentsView>('list');

  /**
   * What the funnel narrows to (`lib-visit-filter`, which draws the
   * trigger, names the choice in force and goes to the accent while it
   * bites); the list and the calendar both show only what matches it.
   */
  protected readonly filter = signal<VisitFilter>(VisitFilter.All);

  /** A narrowed list — its empty offers the filter back rather than a booking. */
  protected readonly filtering = computed(
    () => this.filter() !== VisitFilter.All,
  );

  /** How far the rendered run reaches, in months, either side of today. */
  private readonly monthsBack = signal(INITIAL_MONTH_SPAN);
  private readonly monthsAhead = signal(INITIAL_MONTH_SPAN);
  /** One growth at a time — a scroll fires far faster than a render. */
  private growing = false;

  /**
   * A visit to open on arrival — `/account/appointments?visit=<id>`, bound
   * from the query by the router's component input binding. `/account`'s
   * «Предстоящ час» card lands here with its visit's sheet already open.
   */
  readonly visit = input<string>();

  /**
   * The visit whose sheet is open: the one the route asked for, until a row
   * or a day opens another or the sheet is dismissed. The sheet itself waits
   * for the visit to be among the loaded ones (`openVisit`).
   */
  protected readonly openVisitId = linkedSignal<string | null>(
    () => this.visit() ?? null,
  );
  protected readonly confirmingId = signal<AppointmentId | null>(null);
  protected readonly cancelReason = signal(DEFAULT_CANCEL_REASON);

  /**
   * `read: ElementRef` is load-bearing: `ui-calendar-scroller` is a
   * COMPONENT, so a bare template-reference query hands back its instance,
   * whose `nativeElement` is undefined — and the growth handler then bailed
   * on every single scroll while the calendar looked, correctly, like it
   * simply did not grow.
   */
  private readonly calendarScroller = viewChild('calendarScroller', {
    read: ElementRef<HTMLElement>,
  });

  // ── The visits, resolved ─────────────────────────────────────────────

  /**
   * The language the catalogue has LOADED, once it has. The row words are
   * built from it with `translate(…, lang)`, so no lookup inside a
   * `computed` can start a load — a write the computed would read back and
   * never settle on (the staff card's store reads its words the same way).
   */
  private readonly loadedLang = toSignal(
    this.transloco.langChanges$.pipe(
      switchMap((lang) =>
        this.transloco.selectTranslation(lang).pipe(map(() => lang)),
      ),
    ),
    { initialValue: null },
  );

  /** The rows' words in the client's perspective — «Пропуснат», «Отказан». */
  private readonly words = computed<VisitWords | null>(() => {
    const lang = this.loadedLang();
    return lang === null
      ? null
      : visitWordsOf(
          (key, params) => this.transloco.translate(key, params, lang),
          lang,
          VisitPerspective.Client,
        );
  });

  /** The catalogue, as a row reads it: names in the active language, the barber's face. */
  private readonly lookup = computed<VisitLookup>(() => {
    const barbers = new Map(
      this.catalog.barberVms().map((barber) => [barber.id, barber]),
    );
    const locations = this.catalog.locations();
    return {
      serviceName: (id) => {
        const service = this.catalog.findService(id);
        return service
          ? this.content.text({ en: service.name.en, bg: service.name.bg })
          : null;
      },
      barberName: (id) => {
        const barber = barbers.get(id);
        return barber ? this.content.text(barber.name) : null;
      },
      barberAvatarSrc: (id) => barbers.get(id)?.avatarSrc ?? null,
      locationName: (id) => {
        const shop = locations.find((location) => location.id === id);
        return shop
          ? this.content.text({ en: shop.name.en, bg: shop.name.bg })
          : null;
      },
      locationCount: locations.length,
      locationTimeZone: (id) =>
        locations.find((location) => location.id === id)?.timeZone ?? null,
    };
  });

  /**
   * Every visit the two reads hold, each ONCE. An open booking whose hour
   * has already begun is in both — the upcoming read has no date bound, the
   * history holds everything started — and it is one visit, filed by its
   * own start.
   */
  private readonly appointments = computed<readonly Appointment[]>(() => {
    const seen = new Set<string>();
    const appointments: Appointment[] = [];
    for (const appointment of [
      ...this.store.appointments(),
      ...this.store.history(),
    ]) {
      if (seen.has(appointment.id)) continue;
      seen.add(appointment.id);
      appointments.push(appointment);
    }
    return appointments;
  });

  /**
   * Every visit as the list's row, and the calendar's and the sheet's view
   * model built from that row. Empty until the catalogue's words have
   * loaded — the list shows its placeholders meanwhile — and until the
   * shop's zone has resolved: "now" is read on the shop's wall clock
   * (`ShopNow`, Law 7.3), and both reads stay empty without it anyway.
   */
  private readonly visits = computed<readonly PageVisit[]>(() => {
    const words = this.words();
    const lang = this.loadedLang();
    const now = this.store.now();
    const timeZone = this.store.zone();
    if (words === null || lang === null || now === null || timeZone === null) {
      return [];
    }
    const lookup = this.lookup();
    const owner = this.store.owner();
    return this.appointments().map((appointment) => {
      const row = visitRowOf(
        appointment,
        {
          perspective: VisitPerspective.Client,
          grain: VisitGrain.Month,
          subjectUserId: owner,
          currentAppointmentId: null,
          now,
          timeZone,
          locale: lang,
          words,
        },
        lookup,
      );
      return { row, visit: this.toVisit(appointment, row, lookup, lang) };
    });
  });

  /** What the funnel lets through — the list's rows and the calendar's days alike. */
  private readonly shownVisits = computed<readonly PageVisit[]>(() => {
    const filter = this.filter();
    return this.visits().filter(({ row }) => matchesVisitFilter(row, filter));
  });

  /**
   * The list: «Предстоящи» first, soonest first, then one section per month
   * that holds a visit, newest first — each heading with its year
   * («Юли 2026 г.»), so a history reaching past a year never draws two
   * «Юли» under the same word. The pills say what the headings say.
   */
  protected readonly sections = computed<readonly VisitSectionVm[]>(() => {
    const lang = this.loadedLang();
    if (lang === null) return [];
    return sectionVisits(
      this.shownVisits().map(({ row }) => row),
      {
        grain: VisitGrain.Month,
        testIdPrefix: 'appointments',
        labels: {
          upcoming: this.transloco.translate(
            'appointments.sections.upcoming',
            {},
            lang,
          ),
          section: (key) => visitSectionLabel(key, lang),
        },
      },
    );
  });

  /**
   * Where the list stands: the catalogue's words are part of "loaded" — a
   * READY read whose rows cannot be worded yet is still LOADING, never an
   * empty list (`visits()` is `[]` until the words arrive).
   */
  protected readonly listState = computed<LoadState>(() => {
    const state = this.store.upcoming().loadState;
    return state === LoadState.Ready && this.words() === null
      ? LoadState.Loading
      : state;
  });

  /** Every visit by its id — what a row, or a day, opens. */
  private readonly visitById = computed(
    () => new Map(this.visits().map(({ visit }) => [visit.id, visit] as const)),
  );

  protected readonly totalVisits = computed(() => this.shownVisits().length);

  /** "5 посещения" / "1 посещение" — two forms, because one visit is not "1 visits". */
  protected readonly countLabel = computed(() => {
    const count = this.totalVisits();
    return this.transloco.translate(
      count === 1 ? 'appointments.countOne' : 'appointments.count',
      { count },
    );
  });

  protected readonly isEmpty = computed(
    () => this.listState() === LoadState.Ready && this.totalVisits() === 0,
  );

  /**
   * Nothing to show BECAUSE of the funnel, rather than because there is
   * nothing. The two need different words: one offers a booking, the other
   * offers the filter back.
   */
  protected readonly isFilteredEmpty = computed(
    () => this.isEmpty() && this.filtering(),
  );

  // ── The calendar view ────────────────────────────────────────────────

  /**
   * Every month between the oldest visit and the newest, in order — the
   * booking flow's own scrolling run of months, showing WHO rather than
   * merely THAT something is booked.
   */
  protected readonly months = computed<readonly VisitMonthVm[]>(() => {
    const today = this.store.today();
    if (today === null) return [];
    const visits = this.shownVisits().map(({ visit }) => visit);

    const byDay = new Map<LocalDate, ClientVisitVm[]>();
    for (const visit of visits) {
      const key = visit.appointment.localDate;
      const bucket = byDay.get(key);
      if (bucket) bucket.push(visit);
      else byDay.set(key, [visit]);
    }

    // The window is around TODAY and grows with the scroll — a month with
    // nothing in it is still a month a person may want to look at. It is
    // then widened to hold every visit, so a booking outside the current
    // window is never unreachable. Months are their first shop day.
    const thisMonth = LocalDate.startOfMonth(today);
    const windowStart = LocalDate.addMonths(thisMonth, -this.monthsBack());
    const windowEnd = LocalDate.addMonths(thisMonth, this.monthsAhead());
    const days = [...byDay.keys()].sort(LocalDate.compare);
    const earliestDay = days.at(0);
    const latestDay = days.at(-1);
    const earliestVisit =
      earliestDay === undefined
        ? thisMonth
        : LocalDate.startOfMonth(earliestDay);
    const latestVisit =
      latestDay === undefined ? thisMonth : LocalDate.startOfMonth(latestDay);
    const from =
      LocalDate.compare(earliestVisit, windowStart) < 0
        ? earliestVisit
        : windowStart;
    const to =
      LocalDate.compare(latestVisit, windowEnd) > 0 ? latestVisit : windowEnd;

    const months: VisitMonthVm[] = [];
    // Bounded by construction (the history read is capped), but the guard
    // keeps a corrupt date from spinning the loop forever.
    let month = from;
    for (let guard = 0; guard < 240; guard++) {
      months.push(this.buildMonth(month, today, byDay));
      if (month === to) break;
      month = LocalDate.addMonths(month, 1);
    }
    return months;
  });

  protected readonly weekdayLabels = computed(() =>
    formatWeekdayLabels(this.locale()),
  );

  // ── The open visit ───────────────────────────────────────────────────

  /** The shop this visit is at — the address, the phone and the map link. */
  protected readonly openVisitShop = computed(() => {
    const visit = this.openVisit();
    if (!visit) return null;
    return (
      this.catalog
        .locations()
        .find((shop) => shop.id === visit.appointment.locationId) ?? null
    );
  });

  protected readonly openVisitAddress = computed(() => {
    const shop = this.openVisitShop();
    return shop
      ? this.content.text({ en: shop.address.en, bg: shop.address.bg })
      : '';
  });

  protected readonly openVisitShopName = computed(() => {
    const shop = this.openVisitShop();
    return shop
      ? this.content.text({ en: shop.name.en, bg: shop.name.bg })
      : '';
  });

  /**
   * The ways to reach the open visit's shop (`ShopReachSystem.reach`): the
   * `tel:` on its canonical E.164 (the display string is punctuated for
   * reading, not for dialling), the directions for the phone's navigator,
   * and which "reach the shop" phrase the copy ends with.
   */
  private readonly openVisitReach = computed(() => {
    const shop = this.openVisitShop();
    // The shop as it is: its id, number and pin are its own root fields.
    return ShopReachSystem.reach(
      shop === null ? [] : [shop],
      shop === null ? null : shop.id,
    );
  });

  /** Hands the destination to the phone's own navigator. */
  protected readonly openVisitDirections = computed(
    () => this.openVisitReach().directionsHref,
  );

  protected readonly openVisitPhoneHref = computed(
    () => this.openVisitReach().callHref,
  );

  /**
   * How the visit sheet sends the client to the shop (`{{reach}}`): "call"
   * when the sheet's own call verb is there to press, "get in touch" when
   * the catalogue has no number for this shop.
   */
  protected readonly openVisitReachKey = computed(
    () => this.openVisitReach().reach,
  );

  /**
   * The call beside a cancel the server refused because the free window
   * closed while the sheet was open. That refusal ends at the shop, and the
   * confirmation sheet covers the visit sheet's own call verb, so it gets
   * its own. `null` for every other failure (a retry is the fix, not a
   * call) and when there is no number to dial.
   */
  protected readonly cancelCallHref = computed(() =>
    this.cancelRefusedForGood() ? this.openVisitPhoneHref() : null,
  );

  /**
   * The server said NO for good: the free window closed while the sheet was
   * open. Pressing «Откажи» again can only hear the same refusal, so the
   * destructive confirm is disabled and the sheet leads with the call to the
   * shop, which is the one way this visit can still be cancelled (business
   * decision: a definitive refusal ends at the shop). A refusal a retry can
   * fix (the terms could not be read) leaves the confirm as it is: pressing
   * it again IS the fix.
   */
  protected readonly cancelRefusedForGood = computed(
    () =>
      this.store.cancelError()?.serverErrorCode ===
      CancellationRefusalCode.WindowClosed,
  );

  /**
   * What the client asked the shop to know, echoed back.
   *
   * Written at booking and, until now, never shown again — a note you
   * cannot re-read is a note you cannot trust was received.
   */
  protected readonly openVisitNote = computed(
    () => this.openVisit()?.appointment.contactNote ?? null,
  );

  /** What this visit comes to, summed from the seats' own terms. */
  protected readonly openVisitTotal = computed(() => {
    const visit = this.openVisit();
    const first = visit?.appointment.seats[0];
    if (!visit || first === undefined) return null;
    const total = Money.sum(
      visit.appointment.seats.map((seat) => ServiceTerms.price(seat)),
      first.currency,
    );
    // Mixed currencies are a data error the entity also refuses; a partial
    // total would be worse than none.
    return total.ok
      ? formatCents(
          total.value.amountCents,
          total.value.currency,
          this.locale(),
        )
      : null;
  });

  protected readonly openVisit = computed<ClientVisitVm | null>(() => {
    const id = this.openVisitId();
    return id === null ? null : (this.visitById().get(id) ?? null);
  });

  /**
   * How many verbs the open visit's sheet offers — one column each. A verb
   * this visit cannot use is ABSENT, never dimmed, and the run closes up
   * around it: «В календара» or «Пак същото» always, «Премести» while the
   * client may move it, «Навигация» and «Обади се» when the catalogue
   * knows the shop's place and number.
   */
  protected readonly openVisitVerbCount = computed(() => {
    const visit = this.openVisit();
    if (!visit) return 0;
    const move = visit.upcoming && this.canMove(visit.appointment);
    return (
      1 +
      (move ? 1 : 0) +
      (this.openVisitDirections() === null ? 0 : 1) +
      (this.openVisitPhoneHref() === null ? 0 : 1)
    );
  });

  constructor() {
    effect(() => {
      const principal = this.accountState.principal();
      if (!Principal.isActive(principal)) return;
      this.store.setUserId(principal.userId);
    });
  }

  // ── Commands ─────────────────────────────────────────────────────────

  protected setView(next: AppointmentsView): void {
    this.view.set(next);
    // A calendar opens on NOW. Without this the run starts six months ago
    // and the first thing a person sees is a screen of empty squares from
    // last winter.
    if (next === 'calendar') this.scrollToToday();
  }

  /**
   * Grow the run as the scroll approaches either end — the endless-calendar
   * behaviour, done lazily.
   *
   * Prepending months moves everything below them DOWN, so the scroll offset
   * has to be corrected by exactly the height that appeared above the
   * viewport; without that the view jumps backwards the moment it grows,
   * which reads as the calendar fighting the finger.
   */
  protected onCalendarScroll(): void {
    const scroller = this.calendarScroller()?.nativeElement;
    if (!scroller || this.growing) return;

    const viewport = scroller.clientHeight;
    if (scroller.scrollTop < viewport && this.monthsBack() < MAX_MONTH_SPAN) {
      this.grow('past');
    } else if (
      scroller.scrollHeight - (scroller.scrollTop + viewport) < viewport &&
      this.monthsAhead() < MAX_MONTH_SPAN
    ) {
      this.grow('future');
    }
  }

  private grow(side: 'past' | 'future'): void {
    const scroller = this.calendarScroller()?.nativeElement;
    if (!scroller) return;

    this.growing = true;
    const heightBefore = scroller.scrollHeight;

    if (side === 'past') {
      this.monthsBack.update((value) => value + MONTH_SPAN_STEP);
    } else {
      this.monthsAhead.update((value) => value + MONTH_SPAN_STEP);
    }

    afterNextRender(
      () => {
        if (side === 'past') {
          scroller.scrollTop += scroller.scrollHeight - heightBefore;
        }
        this.growing = false;
      },
      { injector: this.injector },
    );
  }

  /**
   * Put today's month at the top of the view.
   *
   * `afterNextRender` because the two callers arrive at different moments:
   * switching to the calendar has to wait for the run to exist at all, and
   * the anchor button has to wait for nothing — but paying one frame is
   * cheaper than two code paths.
   */
  protected scrollToToday(smooth = false): void {
    const today = this.store.today();
    if (today === null) return;
    const key = visitSectionKey(today, VisitGrain.Month);
    afterNextRender(
      () => {
        this.calendarScroller()
          ?.nativeElement.querySelector(`[data-month-key="${key}"]`)
          ?.scrollIntoView({
            block: 'start',
            behavior: smooth ? 'smooth' : 'auto',
          });
      },
      { injector: this.injector },
    );
  }

  protected setFilter(next: VisitFilter): void {
    // The browser forgets its current pill when the sections change under
    // it, so the narrowed list's rail falls back to whatever it starts with.
    this.filter.set(next);
  }

  /** Read both lists again — the list's «Опитай пак» after a failed read. */
  protected retry(): void {
    this.store.retry();
  }

  /**
   * Hand the visit to the device's calendar.
   *
   * A downloaded `.ics` rather than a Google template URL: it opens in
   * whatever calendar a person actually uses, works offline, and carries a
   * stable UID so a second tap updates the event instead of duplicating it.
   * See `visit-ics.ts`.
   */
  protected addToCalendar(visit: ClientVisitVm): void {
    const nowUtcMs = this.clock.nowUtcMs();
    const shopName = this.openVisitShopName();
    const address = this.openVisitAddress();

    // The `.ics` is what an instant is FOR (Law 7.3): the start as stored,
    // the end its sold span later.
    const startMs = visit.appointment.utcEpochMs;
    const endMs = UtcEpochMs.plusMs(
      startMs,
      TimeCoordinate.durationMinutes(visit.appointment) * MS_PER_MINUTE,
    );
    const ics = buildVisitIcs(
      {
        uid: `${visit.id}@creativo`,
        title: visit.title,
        startMs,
        endMs,
        location: [shopName, address].filter(Boolean).join(', '),
        description: [
          `${this.transloco.translate('appointments.visit.barberRole')}: ${
            visit.barberLabel
          }`,
          this.openVisitNote(),
        ]
          .filter(Boolean)
          .join('\n'),
      },
      nowUtcMs,
    );

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `creativo-${visit.appointment.localDate}.ics`;
    link.click();
    // Freed on the next turn of the loop — revoking synchronously races the
    // click the browser has not finished handling.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /** Open a visit's sheet — by id, from a row (`openRow`) or a calendar day. */
  protected showVisit(id: string): void {
    this.openVisitId.set(id);
  }

  protected dismissVisit(): void {
    this.openVisitId.set(null);
  }

  protected requestCancel(id: AppointmentId): void {
    // A fresh sheet asks afresh: the last refusal was about the last ask.
    this.store.clearCancelError();
    this.confirmingId.set(id);
    this.cancelReason.set(DEFAULT_CANCEL_REASON);
  }

  protected dismissCancel(): void {
    this.confirmingId.set(null);
  }

  protected async confirmCancel(): Promise<void> {
    const id = this.confirmingId();
    // The button is disabled then; this holds for any other way in.
    if (!id || this.cancelRefusedForGood()) return;
    const cancelled = await this.store.cancel(id, this.cancelReason());
    if (cancelled) {
      this.confirmingId.set(null);
      this.openVisitId.set(null);
    }
  }

  // ── Policy ───────────────────────────────────────────────────────────

  protected canCancel(appointment: Appointment): boolean {
    return CancellationPolicySystem.mayCancel(
      appointment,
      this.policy(),
      this.store.nowUtcMs,
    ).ok;
  }

  /**
   * «Премести» is offered only for a visit the client can actually move: one
   * the window still allows (the same rule a cancellation is refused by) AND
   * one holding a seat that is theirs to move — the domain's rule, the one
   * the server refuses `shop_only` by. A visit left holding only somebody
   * the shop added would open a move that can only be refused.
   */
  protected canMove(appointment: Appointment): boolean {
    return (
      this.canCancel(appointment) &&
      MoveSystem.hasSeatTheBookerCanMove(appointment, this.store.owner())
    );
  }

  /**
   * Movable by the window, but nothing on it is the client's to move — only
   * the shop can. Said, rather than leaving the verb to silently vanish; the
   * shop's number is already one of the verbs when the catalogue knows it.
   */
  protected shopMovesOnly(appointment: Appointment): boolean {
    return this.canCancel(appointment) && !this.canMove(appointment);
  }

  /** Still cancellable by STATUS, but the free window has passed. */
  protected windowClosed(appointment: Appointment): boolean {
    return (
      BookingLifecycle.isLive(appointment) &&
      !BookingPolicy.mayCancelAt(
        this.policy(),
        CancellationPolicySystem.startUtcMsOf(appointment),
        this.store.nowUtcMs,
      )
    );
  }

  /**
   * "Free cancellation until …" — the deadline, human-shaped, on the shop's
   * calendar: the visit's own shop's zone, else the default shop's (an
   * instant is read in a LOCATION's zone, never the device's — 4A-11).
   */
  protected cancellationDeadline(appointment: Appointment): string {
    const zone =
      this.lookup().locationTimeZone?.(appointment.locationId) ??
      this.store.zone();
    if (zone === null) return '';
    return formatInstant(
      BookingPolicy.cancellationDeadlineUtcMs(
        this.policy().cancellationWindowHours,
        CancellationPolicySystem.startUtcMsOf(appointment),
      ),
      zone,
      this.locale(),
      {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      },
    );
  }

  protected statusTone(status: BookingStatus): UiBadgeTone {
    // eslint-disable-next-line security/detect-object-injection -- closed union.
    return STATUS_TONES[status];
  }

  /** The status's word key segment — `appointments.status.<key>`. */
  protected statusKey(status: BookingStatus): string {
    // eslint-disable-next-line security/detect-object-injection -- closed union.
    return bookingStatusWords[status];
  }

  // ── Formatting ───────────────────────────────────────────────────────

  /** One day cell's announcement — the visit, or how many there are. */
  protected dayAriaLabel(visits: readonly ClientVisitVm[]): string {
    const first = visits[0];
    if (!first) return '';
    if (visits.length === 1) {
      return `${this.fullDayLabel(first)} · ${first.timeLabel} · ${first.title}`;
    }
    return this.transloco.translate('appointments.visit.severalThatDay', {
      count: visits.length,
      day: this.fullDayLabel(first),
    });
  }

  protected fullDayLabel(visit: ClientVisitVm): string {
    // The shop's own day, printed as stored (no zone is consulted).
    return formatWallClock(visit.appointment.localDate, null, this.locale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  /**
   * Why a cancel did not go through — in the SERVER's words when the
   * catalogue has them (`wordPipelineError`, the rule the booking flow's
   * review step follows too). Unreadable cancellation terms say to try
   * again in a moment, and the sheet stays open on the same button to do
   * exactly that; a closed window names its hours. The surface's own
   * "something went wrong" (`BookingErrorCode.CallFailed`) is only the
   * fallback — for a cancel the server gave no more words for.
   */
  protected translateCancelError(): string | null {
    const error = this.store.cancelError();
    if (!error) return null;
    // A closed window sends the client to the shop, in the words the call
    // beside it earns (`cancelCallHref`).
    const reach = this.transloco.translate(
      ShopReach.forCallHref(this.cancelCallHref()),
    );
    return wordPipelineError(
      error,
      (code, params) =>
        translateDomainError(this.transloco, { ...params, errorCode: code }),
      BookingErrorCode.CallFailed,
      { reach },
    );
  }

  // ── Internals ────────────────────────────────────────────────────────

  private locale(): string {
    return this.transloco.getActiveLang();
  }

  private capitalize(value: string): string {
    return value.charAt(0).toLocaleUpperCase(this.locale()) + value.slice(1);
  }

  /**
   * The calendar's and the sheet's view of a visit, built FROM its row: the
   * title (the services, deduplicated — a party of three having the same
   * cut is one thing being done, three times) and the barber's word (one
   * barber the catalogue no longer lists is still ONE barber, never
   * «1 бръснари») are the row's own, so the row and the sheet it opens
   * cannot word the visit apart.
   */
  private toVisit(
    appointment: Appointment,
    row: VisitRowVm,
    lookup: VisitLookup,
    locale: string,
  ): ClientVisitVm {
    const barberIds = appointment.barberIds;
    const single = barberIds.length === 1 ? (barberIds[0] ?? null) : null;
    const trailing = row.trailing;
    return {
      id: row.id,
      appointment,
      title: row.title,
      barberLabel: trailing !== null ? trailing.name : '',
      barberAvatarSrc: single === null ? null : lookup.barberAvatarSrc(single),
      barberMonogram: single === null ? '' : (lookup.barberName(single) ?? ''),
      timeLabel: formatMinute(appointment.startMinutes, locale),
      upcoming: row.upcoming,
      bookingStatus: appointment.bookingStatus,
    };
  }

  /** One month of the run — `month` its first shop day. */
  private buildMonth(
    month: LocalDate,
    today: LocalDate,
    byDay: ReadonlyMap<LocalDate, ClientVisitVm[]>,
  ): VisitMonthVm {
    // The grid is `CalendarGridSystem.monthGrid` on the shop's civil days
    // (no zone, no day table — the weekday is the day's own); this list pads
    // with BLANKS, so a neighbour's day reads as one.
    const weeks: VisitDayVm[][] = CalendarGridSystem.monthGrid(month, []).map(
      (week) =>
        week.map((cell) =>
          cell.inMonth
            ? {
                dayKey: cell.localDate,
                dayOfMonth: cell.dayOfMonth,
                isToday: cell.localDate === today,
                visits: byDay.get(cell.localDate) ?? [],
              }
            : {
                dayKey: '',
                dayOfMonth: null,
                isToday: false,
                visits: [] as readonly ClientVisitVm[],
              },
        ),
    );

    const sameYear =
      LocalDate.parts(month).year === LocalDate.parts(today).year;
    return {
      key: visitSectionKey(month, VisitGrain.Month),
      // The month's name as the shop's calendar has it (no zone consulted).
      label: this.capitalize(
        formatWallClock(month, null, this.locale(), {
          month: 'long',
          year: sameYear ? undefined : 'numeric',
        }),
      ),
      weeks,
    };
  }
}
