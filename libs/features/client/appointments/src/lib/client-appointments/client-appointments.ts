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
import { UserId, ZonedDateTime } from '@creativo/application/accounts';
import {
  Appointment,
  AppointmentId,
  AppointmentStatusKind,
  BOOKING_POLICY_READER,
  BookingPolicy,
  Money,
  formatMoney,
  wordError,
} from '@creativo/application/booking';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  CatalogContentService,
  CatalogPresenter,
} from '@creativo/features/shared/catalog';
import {
  type VisitFilter,
  VisitFilterMenu,
  type VisitListState,
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
import {
  CalendarGridSystem,
  DayKey,
  E164,
  LocationId as LocationKey,
  type ReachableShop,
  ShopReach,
  ShopReachSystem,
  ZonedTimeSystem,
} from '@creativo/ecs-core';
import { CLOCK } from '@creativo/application/shared';
import { translateDomainError } from '@creativo/infrastructure/i18n';
import { AppointmentsStore, APPOINTMENTS_ZONE } from '../appointments.store';
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

/** `2026-07` ± n months, staying a `YYYY-MM` key. */
function shiftMonthKey(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number) as [number, number];
  const index = year * 12 + (month - 1) + delta;
  const shiftedYear = Math.floor(index / 12);
  const shiftedMonth = (index % 12) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, '0')}`;
}

const CANCELLABLE_STATUSES = new Set<AppointmentStatusKind>([
  'pending',
  'confirmed',
]);

const STATUS_TONES: Record<AppointmentStatusKind, UiBadgeTone> = {
  pending: 'neutral',
  confirmed: 'accent',
  completed: 'success',
  cancelled: 'destructive',
  no_show: 'warning',
};
/**
 * Empty until the client types something. The field is optional, and the
 * callable files any text as the client's own words (`other`), so a
 * prefilled sentence was recorded as their reason on every cancel nobody
 * explained — in English, on a Bulgarian screen — instead of `unspecified`.
 */
const DEFAULT_CANCEL_REASON = '';

/** The server's refusal of a cancel whose free window has closed. */
const CANCEL_WINDOW_CLOSED = 'booking.cancel.window_closed';

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
 * `BookingPolicy.mayCancelAt` rule the server refuses by, so the button never
 * promises what the callable will deny.
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
    '[attr.data-state]': 'store.upcoming().kind',
    '[attr.data-view]': 'view()',
  },
})
export class ClientAppointments {
  private readonly accountState = inject(AccountStateService);
  private readonly clock = inject(CLOCK);
  private readonly injector = inject(Injector);
  private readonly transloco = inject(TranslocoService);
  private readonly catalog = inject(CatalogContentService);
  private readonly content = inject(CatalogPresenter);

  protected readonly store = inject(AppointmentsStore);
  private readonly policyReader = inject(BOOKING_POLICY_READER);

  /**
   * The tenant's cancellation window — the SAME `BookingPolicy.mayCancelAt`
   * rule the `cancelAppointment` callable refuses by.
   */
  protected readonly policy = toSignal(this.policyReader.observe(), {
    initialValue: BookingPolicy.default(),
  });

  protected readonly view = signal<AppointmentsView>('list');

  /**
   * What the funnel narrows to (`lib-visit-filter`, which draws the
   * trigger, names the choice in force and goes to the accent while it
   * bites); the list and the calendar both show only what matches it.
   */
  protected readonly filter = signal<VisitFilter>('all');

  /** A narrowed list — its empty offers the filter back rather than a booking. */
  protected readonly filtering = computed(() => this.filter() !== 'all');

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
          'client',
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
        const shop = locations.find((location) => location.id.value === id);
        return shop
          ? this.content.text({ en: shop.name.en, bg: shop.name.bg })
          : null;
      },
      locationCount: locations.length,
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
      if (seen.has(appointment.id.value)) continue;
      seen.add(appointment.id.value);
      appointments.push(appointment);
    }
    return appointments;
  });

  /**
   * Every visit as the list's row, and the calendar's and the sheet's view
   * model built from that row. Empty until the catalogue's words have
   * loaded — the list shows its placeholders meanwhile.
   */
  private readonly visits = computed<readonly PageVisit[]>(() => {
    const words = this.words();
    const lang = this.loadedLang();
    if (words === null || lang === null) return [];
    const lookup = this.lookup();
    const nowMs = this.store.today.toMillis();
    const owner = this.store.owner()?.value ?? null;
    return this.appointments().map((appointment) => {
      const row = visitRowOf(
        appointment,
        {
          perspective: 'client',
          grain: 'month',
          subjectUserId: owner,
          currentAppointmentId: null,
          nowMs,
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
        grain: 'month',
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

  /** Where the list stands: the catalogue's words are part of "loaded". */
  protected readonly listState = computed<VisitListState>(() => {
    const kind = this.store.upcoming().kind;
    if (kind === 'error') return 'error';
    return kind === 'loading' || this.words() === null ? 'loading' : 'ready';
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
    () => this.listState() === 'ready' && this.totalVisits() === 0,
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
    const visits = this.shownVisits().map(({ visit }) => visit);

    const byDay = new Map<string, ClientVisitVm[]>();
    for (const visit of visits) {
      const key = visit.appointment.timeSlot.calendarDayKey();
      const bucket = byDay.get(key);
      if (bucket) bucket.push(visit);
      else byDay.set(key, [visit]);
    }

    // The window is around TODAY and grows with the scroll — a month with
    // nothing in it is still a month a person may want to look at. It is
    // then widened to hold every visit, so a booking outside the current
    // window is never unreachable.
    const todayKey = visitSectionKey(this.store.today, 'month');
    const keys = [...byDay.keys()].sort();
    const earliestVisit = (keys.at(0) ?? todayKey).slice(0, 7);
    const latestVisit = (keys.at(-1) ?? todayKey).slice(0, 7);

    const windowStart = shiftMonthKey(todayKey, -this.monthsBack());
    const windowEnd = shiftMonthKey(todayKey, this.monthsAhead());
    const from = earliestVisit < windowStart ? earliestVisit : windowStart;
    const to = latestVisit > windowEnd ? latestVisit : windowEnd;

    const months: VisitMonthVm[] = [];
    let [year, month] = from.split('-').map(Number) as [number, number];
    const [endYear, endMonth] = to.split('-').map(Number) as [number, number];

    // Bounded by construction (the history read is capped), but the guard
    // keeps a corrupt date from spinning the loop forever.
    for (let guard = 0; guard < 240; guard++) {
      months.push(this.buildMonth(year, month, byDay));
      if (year === endYear && month === endMonth) break;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    return months;
  });

  protected readonly weekdayLabels = computed(() =>
    ZonedDateTime.weekdayLabels(APPOINTMENTS_ZONE, this.locale()),
  );

  // ── The open visit ───────────────────────────────────────────────────

  /** The shop this visit is at — the address, the phone and the map link. */
  protected readonly openVisitShop = computed(() => {
    const visit = this.openVisit();
    if (!visit) return null;
    return (
      this.catalog
        .locations()
        .find((shop) => shop.id.equals(visit.appointment.locationId)) ?? null
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
    return ShopReachSystem.reach(
      shop === null ? [] : [reachableShopOf(shop)],
      shop === null ? null : LocationKey.of(shop.id.value),
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
      this.store.cancelError()?.params['serverCode'] === CANCEL_WINDOW_CLOSED,
  );

  /**
   * What the client asked the shop to know, echoed back.
   *
   * Written at booking and, until now, never shown again — a note you
   * cannot re-read is a note you cannot trust was received.
   */
  protected readonly openVisitNote = computed(
    () => this.openVisit()?.appointment.contact?.note ?? null,
  );

  /** What this visit comes to, summed from the seats' own terms. */
  protected readonly openVisitTotal = computed(() => {
    const visit = this.openVisit();
    if (!visit) return null;

    let total: Money | null = null;
    for (const seat of visit.appointment.seats) {
      if (total === null) {
        total = seat.terms.price;
        continue;
      }
      const sum = total.add(seat.terms.price);
      // Mixed currencies are a data error the aggregate also refuses; a
      // partial total would be worse than none.
      if (sum.isFailure()) return null;
      total = sum.value;
    }
    return total ? formatMoney(total, this.locale()) : null;
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
      if (principal.kind !== 'active') return;
      const userIdResult = UserId.create(principal.uid.value);
      if (userIdResult.isSuccess()) {
        this.store.setUserId(userIdResult.value);
      }
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
    const key = visitSectionKey(this.store.today, 'month');
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
    const now = this.clock.now(APPOINTMENTS_ZONE);
    const shopName = this.openVisitShopName();
    const address = this.openVisitAddress();

    const ics = buildVisitIcs(
      {
        uid: `${visit.id}@creativo`,
        title: visit.title,
        startMs: visit.appointment.timeSlot.start.toMillis(),
        endMs: visit.appointment.timeSlot.end.toMillis(),
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
      now.isSuccess()
        ? now.value.toMillis()
        : visit.appointment.timeSlot.start.toMillis(),
    );

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `creativo-${visit.appointment.timeSlot.calendarDayKey()}.ics`;
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
    return (
      CANCELLABLE_STATUSES.has(appointment.status.kind) &&
      !this.windowClosed(appointment)
    );
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
      appointment.hasSeatTheBookerCanMove(this.store.owner())
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
      CANCELLABLE_STATUSES.has(appointment.status.kind) &&
      !this.policy().mayCancelAt(
        appointment.timeSlot.start.toMillis(),
        this.store.today.toMillis(),
      )
    );
  }

  /** "Free cancellation until …" — the deadline, human-shaped. */
  protected cancellationDeadline(appointment: Appointment): string {
    return new Intl.DateTimeFormat(this.locale(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: APPOINTMENTS_ZONE,
    }).format(
      new Date(
        this.policy().cancellationDeadlineMs(
          appointment.timeSlot.start.toMillis(),
        ),
      ),
    );
  }

  protected statusTone(kind: AppointmentStatusKind): UiBadgeTone {
    return STATUS_TONES[kind];
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
    return visit.appointment.timeSlot.start.toLocaleString(this.locale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  /**
   * Why a cancel did not go through — in the SERVER's words when the
   * catalogue has them (`wordError`, the rule the booking flow's review step
   * follows too). Unreadable cancellation terms say to try again in a
   * moment, and the sheet stays open on the same button to do exactly that;
   * a closed window names its hours. The gateway's own "something went
   * wrong" is only the fallback.
   */
  protected translateCancelError(): string | null {
    const error = this.store.cancelError();
    if (!error) return null;
    // A closed window sends the client to the shop, in the words the call
    // beside it earns (`cancelCallHref`).
    const params = {
      ...error.params,
      reach: this.transloco.translate(
        ShopReach.forCallHref(this.cancelCallHref()),
      ),
    };
    return wordError(error, (code) =>
      translateDomainError(this.transloco, { code, params }),
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
    const barberIds = appointment.barberIds();
    const single =
      barberIds.length === 1 ? (barberIds[0]?.value ?? null) : null;
    const trailing = row.trailing;
    return {
      id: row.id,
      appointment,
      title: row.title,
      barberLabel: trailing?.kind === 'barber' ? trailing.name : '',
      barberAvatarSrc: single === null ? null : lookup.barberAvatarSrc(single),
      barberMonogram: single === null ? '' : (lookup.barberName(single) ?? ''),
      timeLabel: appointment.timeSlot.start.toLocaleString(locale, {
        hour: '2-digit',
        minute: '2-digit',
      }),
      upcoming: row.upcoming,
      status: appointment.status.kind,
    };
  }

  private buildMonth(
    year: number,
    month: number,
    byDay: ReadonlyMap<string, ClientVisitVm[]>,
  ): VisitMonthVm {
    const pad = (value: number) => String(value).padStart(2, '0');
    const firstOfMonth = Date.UTC(year, month - 1, 1);
    const todayKey = this.store.today.toISODate();

    // The grid is `CalendarGridSystem.monthGrid` over the shop zone's day
    // table; this list pads with BLANKS, so a neighbour's day reads as one.
    const monthKey = DayKey.of(`${year}-${pad(month)}-01`);
    const range = CalendarGridSystem.gridRange(monthKey);
    const weeks: VisitDayVm[][] = CalendarGridSystem.monthGrid(
      monthKey,
      ZonedTimeSystem.dayTable(
        this.store.today.zoneName,
        range.fromDayKey,
        range.toDayKey,
      ),
      [],
    ).map((week) =>
      week.map((cell) =>
        cell.inMonth
          ? {
              dayKey: cell.dayKey,
              dayOfMonth: cell.dayOfMonth,
              isToday: cell.dayKey === todayKey,
              visits: byDay.get(cell.dayKey) ?? [],
            }
          : {
              dayKey: '',
              dayOfMonth: null,
              isToday: false,
              visits: [] as readonly ClientVisitVm[],
            },
      ),
    );

    return {
      key: `${year}-${pad(month)}`,
      label: this.capitalize(
        new Intl.DateTimeFormat(this.locale(), {
          month: 'long',
          year: year === Number(todayKey.slice(0, 4)) ? undefined : 'numeric',
          timeZone: 'UTC',
        }).format(new Date(firstOfMonth)),
      ),
      weeks,
    };
  }
}

/** A catalogue shop as `ShopReachSystem` reads it: its id, number and pin. */
function reachableShopOf(location: {
  readonly id: { readonly value: string };
  readonly phone: { readonly e164: string; readonly display: string };
  readonly geo: { readonly lat: number; readonly lng: number };
}): ReachableShop {
  return {
    id: LocationKey.of(location.id.value),
    phone: {
      e164: E164.of(location.phone.e164),
      display: location.phone.display,
    },
    geo: { lat: location.geo.lat, lng: location.geo.lng },
  };
}
