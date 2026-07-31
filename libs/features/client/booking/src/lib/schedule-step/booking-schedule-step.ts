import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  AVAILABILITY_READER,
  type LocatedOption,
  BookingPolicy,
  CalendarDay,
  ObserveDayAvailabilityUseCase,
  ObserveRangeCapacityUseCase,
  type SeatAssignment,
  TimeSlot,
  ZonedDateTime,
} from '@creativo/application/booking';
import { BarberId, LocationId } from '@creativo/application/catalog';
import { CLOCK } from '@creativo/application/shared';
import {
  CatalogContentService,
  CatalogPresenter,
} from '@creativo/features/shared/catalog';
import { UiButton, UiChip, UiIcon } from '@creativo/ui/controls';
import { UiFlow, UiSpacer, UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiCalendarGrid,
  UiDateBadge,
  UiListGroup,
  UiListRow,
} from '@creativo/ui/patterns';
import { BookingFlowStore } from '../booking-flow.store';
import { BookingStepTitle } from '../chrome/booking-chrome.service';
import { BookingStepLayout } from '../step-layout/booking-step-layout';
import {
  type AvailabilityDayCell,
  buildAvailabilityMonth,
  monthQueryRange,
} from './availability-month';

/** A run of start times sharing a part of the day. */
interface DaypartVm {
  readonly key: 'morning' | 'afternoon' | 'evening';
  readonly starts: readonly StartVm[];
}

interface StartVm {
  readonly key: string;
  readonly startMs: number;
  readonly shopKey: string;
  readonly label: string;
  /**
   * Which shop this time is at — rendered only under "any shop", where two
   * shops can offer the same minute and they are different appointments.
   */
  readonly shopName: string | null;
}

/** One line of the "who, and when" explanation under the chosen time. */
interface ArrangementLineVm {
  readonly barberName: string;
  readonly personLabel: string;
  readonly timeLabel: string;
}

const MORNING_ENDS_AT = 12;
const AFTERNOON_ENDS_AT = 17;

/**
 * Step 3 — when.
 *
 * ### Why a month grid and not a list of days
 * The party's duration decides which days can hold them at all, so the
 * question "when could we come in" is genuinely a calendar question. A month
 * grid answers it at a glance — a day with nothing free is quiet and
 * untappable, which is the honest version of the endless-scroll list that
 * makes a user hunt for the first day that works.
 *
 * ### Times are grouped by daypart, not listed flat
 * Twenty-eight chips in one run is a wall. Morning / afternoon / evening is
 * how people actually say it, and it is the same grouping iOS uses wherever
 * times are offered in bulk. Each group renders only when it has something,
 * so an evening-only barber does not show two empty headings.
 *
 * ### The arrangement line is not decoration
 * With more than one person, the engine may serve the party in parallel or
 * back-to-back, and the user never picks a "mode" (owner ruling 2026-07-29).
 * What they DO need is to know which one they just chose — "both at 14:00"
 * and "you at 14:00, Maria at 14:45" are different afternoons. The line
 * states it plainly rather than making them infer it from a summary later.
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
    BookingStepLayout,
    BookingStepTitle,
    TranslocoDirective,
    UiButton,
    UiCalendarGrid,
    UiChip,
    UiDateBadge,
    UiFlow,
    UiIcon,
    UiForegroundStyleDirective,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiRadiusDirective,
    UiSpacer,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './booking-schedule-step.html',
  styleUrl: './booking-schedule-step.css',
  host: { 'data-testid': 'booking-schedule-step' },
})
export class BookingScheduleStep {
  private readonly transloco = inject(TranslocoService);
  private readonly clock = inject(CLOCK);
  private readonly availability = inject(AVAILABILITY_READER);

  protected readonly catalog = inject(CatalogContentService);
  protected readonly content = inject(CatalogPresenter);
  protected readonly store = inject(BookingFlowStore);

  private readonly observeDay = new ObserveDayAvailabilityUseCase(
    this.availability,
  );
  private readonly observeCapacity = new ObserveRangeCapacityUseCase(
    this.availability,
  );

  /**
   * Tenant policy arrives through a port with the staff editor; until then
   * the domain's own defaults are the single source, not a literal here.
   */
  private readonly policy = BookingPolicy.default();

  /**
   * Which month the grid is showing. Null until the clock and shop are known,
   * and re-anchored on whatever day the store still holds — coming back from
   * review must land on the month the user was looking at, not on today.
   */
  private readonly monthAnchor = signal<CalendarDay | null>(null);

  /**
   * The selection lives in the STORE, not here: this component is destroyed
   * every time the wizard advances, and a day the user has to re-pick after
   * glancing at the summary is friction the machine already avoids for the
   * location. It is also what makes the `slot_unavailable` bounce useful —
   * the day survives, the time does not.
   */
  protected readonly selectedDayKey = this.store.selectedDayKey;
  private readonly selectedStartMs = this.store.selectedStartMs;

  // ── Where ───────────────────────────────────────────────────────────

  protected readonly locations = computed(() => this.catalog.locations());

  /**
   * The shop the client chose on step 1, or `null` for "any shop".
   *
   * No picker here any more: WHERE is its own first step, where it can be
   * answered on a map. Asking again on a screen about WHEN was always the
   * wrong place for it.
   */
  protected readonly location = computed(() => {
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
  private readonly zone = computed(
    () =>
      this.location()?.timezone ??
      this.locations().at(0)?.timezone ??
      'Europe/Sofia',
  );

  /**
   * EVERY active barber — the ROSTER decides who works where, not the barber's
   * editorial `locationIds`.
   *
   * Pre-filtering on the catalog list looks like a cheap optimisation and is a
   * drift hazard: a barber whose roster covers Mladost but whose editorial list
   * has not caught up would silently disappear from that shop's grid. The
   * reader drops anyone with no window at the shop being asked about, which is
   * the same answer derived from the thing that is actually true.
   */
  protected readonly barberIds = computed<readonly BarberId[]>(() =>
    this.catalog.barbers().map((barber) => barber.id),
  );

  // ── When ────────────────────────────────────────────────────────────

  private readonly now = computed<ZonedDateTime | null>(() => {
    const result = this.clock.now(this.zone());
    return result.isSuccess() ? result.value : null;
  });

  private readonly today = computed<CalendarDay | null>(() => {
    const now = this.now();
    return now ? CalendarDay.fromZonedDateTime(now) : null;
  });

  /** The last day anyone may book — the policy horizon, walked in calendar days. */
  private readonly horizonEnd = computed<CalendarDay | null>(() => {
    let cursor = this.today();
    if (!cursor) return null;
    for (let index = 0; index < this.policy.horizonDays; index++) {
      cursor = cursor.next();
    }
    return cursor;
  });

  /**
   * The month to show: an explicit page turn wins, then the remembered day,
   * then today. Reading the remembered day here is what makes a step back
   * land where the user left off.
   */
  private readonly anchor = computed<CalendarDay | null>(() => {
    const explicit = this.monthAnchor();
    if (explicit) return explicit;
    const dayKey = this.selectedDayKey();
    if (dayKey) {
      const remembered = CalendarDay.create(dayKey, this.zone());
      if (remembered.isSuccess()) return remembered.value;
    }
    return this.today();
  });

  protected readonly month = computed(() => {
    const anchor = this.anchor();
    const today = this.today();
    const horizonEnd = this.horizonEnd();
    if (!anchor || !today || !horizonEnd) return null;
    return buildAvailabilityMonth({
      anchor,
      today,
      horizonEnd,
      capacityByDay: this.capacityByDay(),
    });
  });

  protected readonly monthLabel = computed(() => {
    const month = this.month();
    if (!month) return '';
    return new Intl.DateTimeFormat(this.content.locale(), {
      month: 'long',
      year: 'numeric',
      timeZone: this.zone(),
    }).format(new Date(month.anchor.startOfDay().toMillis()));
  });

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

  /** Can the grid step back? Never before the current month. */
  protected readonly canGoToPreviousMonth = computed(() => {
    const month = this.month();
    const today = this.today();
    if (!month || !today) return false;
    return !(
      month.anchor.year === today.year && month.anchor.month === today.month
    );
  });

  // ── Live reads ──────────────────────────────────────────────────────

  /**
   * Derived from the ANCHOR, never from `month()` — `month()` is built FROM
   * the capacity this query returns, so reading it here would make the query
   * depend on its own result.
   */
  private readonly capacityQuery = computed(() => {
    const today = this.today();
    const horizonEnd = this.horizonEnd();
    const barberIds = this.barberIds();
    if (!today || !horizonEnd || barberIds.length === 0) return null;
    const anchor = this.anchor() ?? today;
    const range = monthQueryRange(anchor, today, horizonEnd);
    return range
      ? { locationId: this.store.locationId(), range, barberIds }
      : null;
  });

  private readonly capacityResult = toSignal(
    toObservable(this.capacityQuery).pipe(
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

  private readonly dayQuery = computed(() => {
    const cart = this.store.cart();
    const now = this.now();
    const dayKey = this.selectedDayKey();
    if (!cart || !now || !dayKey) return null;
    const day = CalendarDay.create(dayKey, this.zone());
    if (day.isFailure()) return null;
    return {
      cart,
      services: this.catalog.services(),
      barberIds: this.barberIds(),
      locationId: this.store.locationId(),
      day: day.value,
      policy: this.policy,
      now,
    };
  });

  private readonly dayResult = toSignal(
    toObservable(this.dayQuery).pipe(
      switchMap((input) =>
        input === null ? of(null) : this.observeDay.execute(input),
      ),
    ),
    { initialValue: null },
  );

  protected readonly loadingDay = computed(
    () => this.selectedDayKey() !== null && this.dayResult() === null,
  );

  private readonly options = computed<readonly LocatedOption[]>(() => {
    const result = this.dayResult();
    return result?.isSuccess() ? result.value.options : [];
  });

  protected readonly dayparts = computed<readonly DaypartVm[]>(() => {
    const result = this.dayResult();
    if (!result?.isSuccess()) return [];

    // Named per shop only when the client did NOT pick one. With a shop chosen
    // every chip is at it, and repeating the name on 28 chips is noise.
    const nameShops = this.store.locationId() === null;

    const groups = new Map<DaypartVm['key'], StartVm[]>([
      ['morning', []],
      ['afternoon', []],
      ['evening', []],
    ]);

    for (const { locationId, option } of result.value.options) {
      const startMs = option.envelope.startMs;
      const start = ZonedDateTime.fromMillis(startMs, this.zone());
      if (start.isFailure()) continue;
      const hour = start.value.hour;
      const key: DaypartVm['key'] =
        hour < MORNING_ENDS_AT
          ? 'morning'
          : hour < AFTERNOON_ENDS_AT
            ? 'afternoon'
            : 'evening';
      groups.get(key)?.push({
        key: `${locationId.value}|${startMs}`,
        startMs,
        shopKey: locationId.value,
        label: this.formatTime(startMs),
        shopName: nameShops ? this.locationName(locationId) : null,
      });
    }

    // A heading with nothing under it is a promise the day cannot keep.
    return [...groups.entries()]
      .filter(([, starts]) => starts.length > 0)
      .map(([key, starts]) => ({ key, starts }));
  });

  protected readonly hasNoTimes = computed(
    () =>
      this.selectedDayKey() !== null &&
      !this.loadingDay() &&
      this.dayparts().length === 0,
  );

  /**
   * The arrangement the user is committing to, if they have picked a time.
   *
   * The engine's order is total, so "the first option at this start" is a
   * stable choice rather than whichever branch the search found first. Options
   * now carry their shop; this step always has one chosen, so a start is
   * unambiguous. When choosing a shop becomes optional, a chip will have to
   * carry the shop it belongs to as well as the time.
   */
  private readonly selectedOption = computed<LocatedOption | null>(() => {
    const startMs = this.selectedStartMs();
    const shopKey = this.store.selectedShopKey();
    if (startMs === null || shopKey === null) return null;
    return (
      this.options().find(
        (entry) =>
          entry.option.envelope.startMs === startMs &&
          entry.locationId.value === shopKey,
      ) ?? null
    );
  });

  protected readonly canContinue = computed(
    () => this.selectedOption() !== null,
  );

  /**
   * Who serves whom, and when — rendered only for a party, since one person
   * being served by one barber at the time they just tapped explains itself.
   */
  protected readonly arrangement = computed<readonly ArrangementLineVm[]>(
    () => {
      const option = this.selectedOption();
      if (!option || this.store.partySize() < 2) return [];

      const cart = this.store.cart();
      if (!cart) return [];

      const seatByLineId = new Map<string, string>();
      for (const [seatKey, lines] of cart.entries()) {
        for (const line of lines) {
          seatByLineId.set(line.id.value, seatKey);
        }
      }

      return option.option.assignments.map((assignment) => ({
        barberName: this.barberName(assignment.barberId),
        personLabel: this.personLabel(
          seatByLineId.get(assignment.lineId) ?? '',
        ),
        timeLabel: this.formatTime(assignment.slot.startMs),
      }));
    },
  );

  /**
   * Are the party's seats all at once, or one after another? Drives which
   * sentence heads the arrangement — the engine returns both kinds and the
   * user is told which one they picked.
   */
  protected readonly arrangementKind = computed<'parallel' | 'sequential'>(
    () => {
      const located = this.selectedOption();
      const option = located?.option;
      if (!option || option.assignments.length < 2) return 'parallel';
      const first = option.assignments[0]?.slot.startMs;
      return option.assignments.every(
        (assignment) => assignment.slot.startMs === first,
      )
        ? 'parallel'
        : 'sequential';
    },
  );

  // ── Commands ────────────────────────────────────────────────────────

  protected selectDay(cell: AvailabilityDayCell): void {
    if (cell.outOfRange || cell.freeMinutes === 0) return;
    this.store.selectDay(cell.dayKey);
  }

  protected selectStart(start: StartVm): void {
    this.store.selectStart(start.startMs, start.shopKey);
  }

  protected shiftMonth(delta: -1 | 1): void {
    const month = this.month();
    const today = this.today();
    if (!month || !today) return;
    const anchor = month.anchor;
    // Walk a whole month by stepping to the 1st and crossing the boundary,
    // never by adding 30 days.
    let cursor = anchor;
    if (delta === 1) {
      while (cursor.month === anchor.month) cursor = cursor.next();
    } else {
      cursor = anchor.previous();
      while (cursor.day !== 1) cursor = cursor.previous();
      if (cursor.isBefore(today)) cursor = today;
    }
    this.monthAnchor.set(cursor);
  }

  /** Hand the machine the whole arrangement — envelope and per-seat placement. */
  protected continue(): void {
    const located = this.selectedOption();
    if (!located) return;
    const option = located.option;

    const assignments: SeatAssignment[] = [];
    for (const assignment of option.assignments) {
      const slot = this.toTimeSlot(
        assignment.slot.startMs,
        assignment.slot.endMs,
      );
      const lineId = this.store.cartLineId(assignment.lineId);
      if (!slot || !lineId) return;
      assignments.push({ lineId, barberId: assignment.barberId, slot });
    }

    const envelope = this.toTimeSlot(
      option.envelope.startMs,
      option.envelope.endMs,
    );
    if (!envelope || assignments.length !== option.assignments.length) return;

    this.store.selectSchedule({
      // The shop comes from the OPTION, not from the picker: with "any shop"
      // they differ, and the appointment happens where the barbers are.
      locationId: located.locationId,
      timeSlot: envelope,
      assignments,
    });
  }

  // ── Formatting ──────────────────────────────────────────────────────

  protected isSelectedDay(cell: AvailabilityDayCell): boolean {
    return this.selectedDayKey() === cell.dayKey;
  }

  /**
   * Bookability outranks month membership.
   *
   * The grid's padding rows are not decoration — they are the first days of
   * the next month, and on the 30th they are most of what a client can
   * actually book. Rendering them `outside` put bookable and unbookable days
   * in the same grey, so the one question the grid exists to answer ("can I
   * come in that day?") had no visual answer in the last row. `outside` now
   * applies only where it costs nothing: a padding day nobody can book.
   */
  protected dayState(
    cell: AvailabilityDayCell,
  ): 'plain' | 'today' | 'selected' | 'outside' | 'unavailable' {
    if (this.isSelectedDay(cell)) return 'selected';
    if (cell.outOfRange) return 'outside';
    if (cell.freeMinutes === 0) return 'unavailable';
    return cell.isToday ? 'today' : 'plain';
  }

  protected isSelectedStart(start: StartVm): boolean {
    return (
      this.selectedStartMs() === start.startMs &&
      this.store.selectedShopKey() === start.shopKey
    );
  }

  protected formatTime(millis: number): string {
    return new Intl.DateTimeFormat(this.content.locale(), {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: this.zone(),
    }).format(new Date(millis));
  }

  protected locationName(locationId: LocationId): string {
    const location = this.locations().find((candidate) =>
      candidate.id.equals(locationId),
    );
    return location
      ? this.content.text({ en: location.name.en, bg: location.name.bg })
      : locationId.value;
  }

  private barberName(barberId: BarberId): string {
    const barber = this.catalog
      .barbers()
      .find((candidate) => candidate.id.equals(barberId));
    return barber
      ? this.content.text({ en: barber.name.en, bg: barber.name.bg })
      : barberId.value;
  }

  /** `seatKeyValue` is `'self'` or the bare `GuestId` — never a prefixed form. */
  private personLabel(seatKey: string): string {
    if (seatKey === 'self')
      return this.transloco.translate('booking.party.you');
    const guest = this.store
      .guests()
      .find((candidate) => candidate.id.value === seatKey);
    return guest?.label.value ?? seatKey;
  }

  private toTimeSlot(startMs: number, endMs: number): TimeSlot | null {
    const zone = this.zone();
    const start = ZonedDateTime.fromMillis(startMs, zone);
    const end = ZonedDateTime.fromMillis(endMs, zone);
    if (start.isFailure() || end.isFailure()) return null;
    const slot = TimeSlot.of(start.value, end.value);
    return slot.isSuccess() ? slot.value : null;
  }
}
