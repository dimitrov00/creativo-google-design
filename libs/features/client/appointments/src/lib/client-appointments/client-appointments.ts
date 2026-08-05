import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { UserId, ZonedDateTime } from '@creativo/application/accounts';
import {
  Appointment,
  AppointmentId,
  AppointmentStatusKind,
  BOOKING_POLICY_READER,
  BookingPolicy,
  Money,
  formatMoney,
} from '@creativo/application/booking';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  CatalogContentService,
  CatalogPresenter,
} from '@creativo/features/shared/catalog';
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
import { UiScrollRow, UiSpacer, UiStack, UiToolbar } from '@creativo/ui/layout';
import {
  UiCalendarGrid,
  UiCalendarScroller,
  UiDateBadge,
  UiListGroup,
  UiListRow,
  UiMenu,
  UiMenuItem,
  UiPageActionBar,
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
import { CLOCK } from '@creativo/application/shared';
import { translateDomainError } from '@creativo/infrastructure/i18n';
import { AppointmentsStore, APPOINTMENTS_ZONE } from '../appointments.store';
import {
  type VisitSection,
  type VisitVm,
  groupVisitsByMonth,
  monthKeyOf,
} from '../visit-vm';
import { buildVisitIcs } from '../visit-ics';

type AppointmentsView = 'list' | 'calendar';

/**
 * What the funnel narrows to.
 *
 * `all` and `upcoming` are the two axes a person actually thinks in; the
 * three terminal statuses are there because a history is where you go
 * looking for "did I ever no-show?" — and each of them is a status the
 * appointment document genuinely carries, so no option can ever be a lie.
 */
type VisitFilter = 'all' | 'upcoming' | 'completed' | 'cancelled' | 'no_show';

const VISIT_FILTERS: readonly VisitFilter[] = [
  'all',
  'upcoming',
  'completed',
  'cancelled',
  'no_show',
];

/** The upcoming section's key — not a month, so it can never collide with one. */
const UPCOMING_KEY = 'upcoming';

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
const DEFAULT_CANCEL_REASON = 'Cancelled by client.';

/** One day cell of the calendar view. */
interface VisitDayVm {
  readonly dayKey: string;
  readonly dayOfMonth: number | null;
  readonly isToday: boolean;
  readonly visits: readonly VisitVm[];
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
 * ### The pills navigate, they do not filter
 * A filter row hides things; these jump. Every section stays on screen and
 * the pills say where you are — the Photos-app grammar, and the reason there
 * is a pill for "upcoming" and one per month that ACTUALLY holds a visit.
 * An option that leads nowhere is the one thing a filter row must not have.
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
    UiMenu,
    UiMenuItem,
    UiModalSheet,
    UiPageActionBar,
    UiPaddingDirective,
    UiRadiusDirective,
    UiScrollRow,
    UiSheetActionBar,
    UiSkeleton,
    UiSpacer,
    UiStack,
    UiTextDirective,
    UiTextField,
    UiToolbar,
    UiWeightDirective,
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

  protected readonly filters = VISIT_FILTERS;
  protected readonly filter = signal<VisitFilter>('all');
  protected readonly filterMenuOpen = signal(false);

  /** A narrowed list has to SAY so — the funnel wears a dot when it bites. */
  protected readonly filtering = computed(() => this.filter() !== 'all');

  /**
   * The button's accessible name carries what the DOT cannot.
   *
   * A coloured mark is a glance affordance and nothing more: a screen reader
   * announcing "Filter" over a narrowed list would be describing a control
   * whose state it cannot see. Naming the active option is how the same fact
   * reaches both.
   */
  protected readonly filterButtonLabel = computed(() => {
    const label = this.transloco.translate('appointments.filter.label');
    if (!this.filtering()) return label;
    return `${label}: ${this.transloco.translate(
      `appointments.filter.${this.filter()}`,
    )}`;
  });

  /**
   * Which section the pills call current — set by a tap, then by scrolling.
   *
   * `null` until either happens, because there is no honest default: a
   * client with no upcoming visit opens on their most recent month, and
   * pinning the pill to "upcoming" would light up a section that is not
   * even in the list (which is exactly how it first rendered — three pills,
   * none of them current).
   */
  private readonly touchedSection = signal<string | null>(null);

  protected readonly activeSection = computed(
    () => this.touchedSection() ?? this.sections()[0]?.key ?? UPCOMING_KEY,
  );

  /** How far the rendered run reaches, in months, either side of today. */
  private readonly monthsBack = signal(INITIAL_MONTH_SPAN);
  private readonly monthsAhead = signal(INITIAL_MONTH_SPAN);
  /** One growth at a time — a scroll fires far faster than a render. */
  private growing = false;

  protected readonly openVisitId = signal<string | null>(null);
  protected readonly confirmingId = signal<AppointmentId | null>(null);
  protected readonly cancelReason = signal(DEFAULT_CANCEL_REASON);

  private readonly sectionElements =
    viewChildren<ElementRef<HTMLElement>>('sectionAnchor');

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

  private readonly upcomingVisits = computed<readonly VisitVm[]>(() => {
    const filter = this.filter();
    // Every terminal filter is by definition about the past, so the
    // upcoming run empties rather than showing bookings that cannot match.
    if (filter !== 'all' && filter !== 'upcoming') return [];
    return [...this.store.appointments()]
      .sort((a, b) => (a.timeSlot.start.isBefore(b.timeSlot.start) ? -1 : 1))
      .map((appointment) => this.toVisit(appointment, true));
  });

  private readonly pastVisits = computed<readonly VisitVm[]>(() => {
    const filter = this.filter();
    if (filter === 'upcoming') return [];
    return this.store
      .history()
      .filter((appointment) =>
        filter === 'all' ? true : appointment.status.kind === filter,
      )
      .map((appointment) => this.toVisit(appointment, false));
  });

  protected readonly sections = computed<readonly VisitSection[]>(() => {
    const sections: VisitSection[] = [];
    const upcoming = this.upcomingVisits();
    if (upcoming.length > 0) {
      sections.push({
        key: UPCOMING_KEY,
        label: this.transloco.translate('appointments.sections.upcoming'),
        visits: upcoming,
      });
    }
    sections.push(
      ...groupVisitsByMonth(this.pastVisits(), (date) =>
        this.capitalize(date.toLocaleString(this.locale(), { month: 'long' })),
      ),
    );
    return sections;
  });

  protected readonly totalVisits = computed(
    () => this.upcomingVisits().length + this.pastVisits().length,
  );

  /** "5 посещения" / "1 посещение" — two forms, because one visit is not "1 visits". */
  protected readonly countLabel = computed(() => {
    const count = this.totalVisits();
    return this.transloco.translate(
      count === 1 ? 'appointments.countOne' : 'appointments.count',
      { count },
    );
  });

  protected readonly isEmpty = computed(
    () => this.store.upcoming().kind === 'ready' && this.totalVisits() === 0,
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
    const visits = [...this.pastVisits(), ...this.upcomingVisits()];

    const byDay = new Map<string, VisitVm[]>();
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
    const todayKey = monthKeyOf(this.store.today);
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

  /** Hands the destination to the phone's own navigator. */
  protected readonly openVisitDirections = computed(() => {
    const shop = this.openVisitShop();
    if (!shop) return null;
    return `https://www.google.com/maps/dir/?api=1&destination=${shop.geo.lat},${shop.geo.lng}`;
  });

  protected readonly openVisitPhoneHref = computed(() => {
    const shop = this.openVisitShop();
    // `e164`, the canonical form the VO documents as "drives tel: links" —
    // the display string is punctuated for reading, not for dialling.
    return shop ? `tel:${shop.phone.e164}` : null;
  });

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

  protected readonly openVisit = computed<VisitVm | null>(() => {
    const id = this.openVisitId();
    if (!id) return null;
    return (
      [...this.upcomingVisits(), ...this.pastVisits()].find(
        (visit) => visit.id === id,
      ) ?? null
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

    // The pills follow the scroll: whichever section's heading is highest on
    // screen is the one they call current. Tapping one scrolls there and the
    // observer confirms it — one source of truth for "where am I", rather
    // than a selection that drifts out of step with what is on screen.
    effect((onCleanup) => {
      const anchors = this.sectionElements();
      if (anchors.length === 0 || typeof IntersectionObserver === 'undefined') {
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort(
              (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
            );
          const key = visible[0]?.target.getAttribute('data-section-key');
          if (key) this.touchedSection.set(key);
        },
        // The band under the toolbar: a heading counts as "current" from the
        // moment it reaches the chrome, not when it reaches the middle.
        { rootMargin: '-96px 0px -70% 0px', threshold: 0 },
      );
      for (const anchor of anchors) observer.observe(anchor.nativeElement);
      onCleanup(() => observer.disconnect());
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
    const key = monthKeyOf(this.store.today);
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
    this.filter.set(next);
    this.filterMenuOpen.set(false);
    // The sections a moment ago may not exist now; let the pills fall back
    // to whatever the narrowed list starts with.
    this.touchedSection.set(null);
  }

  protected jumpTo(key: string): void {
    this.touchedSection.set(key);
    const anchor = this.sectionElements().find(
      (element) => element.nativeElement.dataset['sectionKey'] === key,
    );
    anchor?.nativeElement.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  /**
   * Hand the visit to the device's calendar.
   *
   * A downloaded `.ics` rather than a Google template URL: it opens in
   * whatever calendar a person actually uses, works offline, and carries a
   * stable UID so a second tap updates the event instead of duplicating it.
   * See `visit-ics.ts`.
   */
  protected addToCalendar(visit: VisitVm): void {
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

  protected showVisit(visit: VisitVm): void {
    this.openVisitId.set(visit.id);
  }

  protected dismissVisit(): void {
    this.openVisitId.set(null);
  }

  protected requestCancel(id: AppointmentId): void {
    this.confirmingId.set(id);
    this.cancelReason.set(DEFAULT_CANCEL_REASON);
  }

  protected dismissCancel(): void {
    this.confirmingId.set(null);
  }

  protected async confirmCancel(): Promise<void> {
    const id = this.confirmingId();
    if (!id) return;
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
  protected dayAriaLabel(visits: readonly VisitVm[]): string {
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

  protected fullDayLabel(visit: VisitVm): string {
    return visit.appointment.timeSlot.start.toLocaleString(this.locale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  protected translateCancelError(): string | null {
    const error = this.store.cancelError();
    if (!error) return null;
    return translateDomainError(this.transloco, {
      code: error.code,
      params: error.params,
    });
  }

  protected translateListError(): string {
    return translateDomainError(this.transloco, { code: 'repository_failure' });
  }

  // ── Internals ────────────────────────────────────────────────────────

  private locale(): string {
    return this.transloco.getActiveLang();
  }

  private capitalize(value: string): string {
    return value.charAt(0).toLocaleUpperCase(this.locale()) + value.slice(1);
  }

  private toVisit(appointment: Appointment, upcoming: boolean): VisitVm {
    const start = appointment.timeSlot.start;
    const barberIds = appointment.barberIds();
    const barber =
      barberIds.length === 1
        ? this.catalog
            .barberVms()
            .find((candidate) => candidate.id === barberIds[0]?.value)
        : undefined;

    const services = appointment.seats
      .map((seat) => this.catalog.findService(seat.serviceId.value))
      .filter((service) => service !== undefined)
      .map((service) =>
        this.content.text({ en: service.name.en, bg: service.name.bg }),
      );
    // Deduplicated: a party of three having the same cut is one thing being
    // done, three times — the row says WHAT, and the sheet says how many.
    const uniqueServices = [...new Set(services)];

    return {
      id: appointment.id.value,
      appointment,
      weekdayShort: start.toLocaleString(this.locale(), { weekday: 'short' }),
      dayOfMonth: Number(start.toISO().slice(8, 10)),
      title:
        uniqueServices.join(' · ') ||
        this.transloco.translate('appointments.visit.unknownService'),
      barberLabel: barber
        ? this.content.text(barber.name)
        : this.transloco.translate('appointments.visit.severalBarbers', {
            count: barberIds.length,
          }),
      barberAvatarSrc: barber?.avatarSrc ?? null,
      barberMonogram: barber ? this.content.text(barber.name) : '',
      multipleBarbers: barberIds.length !== 1,
      timeLabel: start.toLocaleString(this.locale(), {
        hour: '2-digit',
        minute: '2-digit',
      }),
      upcoming,
      status: appointment.status.kind,
    };
  }

  private buildMonth(
    year: number,
    month: number,
    byDay: ReadonlyMap<string, VisitVm[]>,
  ): VisitMonthVm {
    const pad = (value: number) => String(value).padStart(2, '0');
    const firstOfMonth = Date.UTC(year, month - 1, 1);
    const lead = (new Date(firstOfMonth).getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const todayKey = this.store.today.toISODate();

    const cells: VisitDayVm[] = [
      ...Array.from({ length: lead }, () => ({
        dayKey: '',
        dayOfMonth: null,
        isToday: false,
        visits: [] as readonly VisitVm[],
      })),
      ...Array.from({ length: days }, (_, index) => {
        const dayKey = `${year}-${pad(month)}-${pad(index + 1)}`;
        return {
          dayKey,
          dayOfMonth: index + 1,
          isToday: dayKey === todayKey,
          visits: byDay.get(dayKey) ?? [],
        };
      }),
    ];
    while (cells.length % 7 !== 0) {
      cells.push({
        dayKey: '',
        dayOfMonth: null,
        isToday: false,
        visits: [],
      });
    }

    const weeks: VisitDayVm[][] = [];
    for (let index = 0; index < cells.length; index += 7) {
      weeks.push(cells.slice(index, index + 7));
    }

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
