import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, of, switchMap } from 'rxjs';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  CalendarDay,
  type ScheduleSelection,
  type SeatAssignment,
  TimeSlot,
  ZonedDateTime,
} from '@creativo/application/booking';
import { BarberId, LocationId } from '@creativo/application/catalog';
import { CLOCK } from '@creativo/application/shared';
import { SCHEDULING_READ_PORTS } from '@creativo/infrastructure/firebase-app';
import {
  type BarberId as BarberKey,
  type EndMinute,
  LocalDate,
  type LocationId as LocationKey,
  type MinuteOfDay,
  type TimeZone,
  UtcEpochMs,
} from '@core/primitives';
import { type BookingPolicy, Daypart, type ShopNow } from '@core/components';
import { type CartLocatedOption, ZonedTimeSystem } from '@core/systems';
import {
  CatalogContentService,
  CatalogPresenter,
} from '@creativo/features/shared/catalog';
import { UiButton, UiIcon, UiModalSheet } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import { SessionIdentityService } from '@creativo/features/shared/shell';
import { BookingFlowStore } from '../../booking-flow.store';
import {
  type DayQuery,
  dayDocsKey,
  dayOptions,
  observeDayDocs,
  sameDayDocsKey,
} from '../day-availability';

/** The catalogue's key segment of each part of the day (`booking.schedule.daypart.morning`, …). */
const DAYPART_KEY = {
  [Daypart.Morning]: 'morning',
  [Daypart.Afternoon]: 'afternoon',
  [Daypart.Evening]: 'evening',
} as const satisfies Record<Daypart, string>;

/** A run of start times sharing a part of the day (`Daypart.of`). */
interface DaypartVm {
  readonly key: (typeof DAYPART_KEY)[Daypart];
  readonly starts: readonly StartVm[];
}

/** One arrangement, at its shop, and the instant its party starts. */
interface TimedOption {
  readonly located: CartLocatedOption;
  readonly startMs: number;
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

/**
 * The times available on ONE chosen day.
 *
 * ### Why a sheet and not the page
 * The calendar is the page now. Times were previously a list under a small
 * grid, which meant the screen asked "which day?" and "which time?" at once
 * and gave neither enough room — and the list pushed the grid off-screen the
 * moment a busy day produced twenty-eight chips. As a sheet the times arrive
 * over the day you tapped, which is also the shape the services step already
 * uses for its own detail decision.
 *
 * ### ONE day, one sheet
 * There were briefly two sheets and a multi-date search behind a toggle on the
 * page bar. It is gone (owner ruling 2026-08-01): it earned a mode, a second
 * sheet layout and a per-day window editor for a question most people never
 * ask, and every control it touched had to branch on it. What survives is the
 * bell in the bar, watching this one day.
 *
 * ### Times are grouped by daypart, never listed flat
 * Twenty-eight starts in one run is a wall. Morning / afternoon / evening is
 * how people actually say it, and it is the grouping iOS uses wherever times
 * are offered in bulk. Each group renders only when it has something, so an
 * evening-only barber does not show two empty headings.
 *
 * ### The arrangement line is not decoration
 * With more than one person the engine may serve the party in parallel or
 * back-to-back, and the user never picks a "mode" (owner ruling 2026-07-29).
 * What they DO need is to know which one they just chose — "both at 14:00" and
 * "you at 14:00, Maria at 14:45" are different afternoons. The line states it
 * plainly rather than making them infer it from a summary later.
 */
@Component({
  selector: 'lib-booking-time-sheet',
  imports: [
    TranslocoDirective,
    UiButton,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiModalSheet,
    UiSheetActionBar,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './booking-time-sheet.html',
  styleUrl: './booking-time-sheet.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped for the same reason the bag sheet is: the rows reach DS
  // internals stamped by `UiListRow`'s own template, which never carry this
  // component's `_ngcontent` attribute. Every selector stays `booking-time`-
  // prefixed for it.
  encapsulation: ViewEncapsulation.None,
})
export class BookingTimeSheet {
  private readonly transloco = inject(TranslocoService);
  private readonly identity = inject(SessionIdentityService);
  private readonly clock = inject(CLOCK);
  // The policy arrives as an INPUT now: the step already observes it for the
  // horizon its calendar runs to, and a sheet re-subscribing to the same port
  // could render one horizon while the grid behind it renders another.
  private readonly scheduling = inject(SCHEDULING_READ_PORTS);

  protected readonly catalog = inject(CatalogContentService);
  protected readonly content = inject(CatalogPresenter);
  protected readonly store = inject(BookingFlowStore);

  readonly day = input.required<CalendarDay>();
  readonly zone = input.required<string>();
  readonly policy = input.required<BookingPolicy>();
  readonly dismissed = output<void>();

  /**
   * The confirmed arrangement. The sheet CONFIGURES and the step ADVANCES —
   * the same split the services step keeps with its detail sheet. Dispatching
   * `select_schedule` from here would make Confirm the step's exit and leave
   * the bar's own CTA with nothing to do.
   */
  readonly confirmed = output<ScheduleSelection>();

  /** The bell: watch the one day this sheet is about. */
  readonly watch = output<void>();

  private readonly selectedStartMs = this.store.selectedStartMs;

  /** The shop's zone as the time systems read it — `null` only for a zone `Intl` refuses. */
  private readonly timeZone = computed<TimeZone | null>(() => {
    const zone = ZonedTimeSystem.checkZone(this.zone());
    return zone.ok ? zone.value : null;
  });

  /** "Now" on the shop's wall clock — the lead time's floor. */
  private readonly now = computed<ShopNow | null>(() => {
    const zone = this.timeZone();
    const result = this.clock.now(this.zone());
    if (!zone || result.isFailure()) return null;
    const instant = UtcEpochMs.of(result.value.toMillis());
    return instant.ok ? ZonedTimeSystem.shopNow(instant.value, zone) : null;
  });

  /** The day this sheet is about, as the shop's civil day. */
  private readonly localDate = computed<LocalDate | null>(() => {
    const day = LocalDate.parse(this.day().key());
    return day.ok ? day.value : null;
  });

  private readonly barberIds = computed<readonly BarberKey[]>(() =>
    this.catalog.barbers().map((barber) => barber.id),
  );

  /**
   * Formatters, built ONCE per locale/zone and reused — the same lesson the
   * calendar learned: `Intl.DateTimeFormat` construction is the expensive half
   * of the API, and these run per group per change-detection cycle.
   */
  private readonly longDateFormat = computed(
    () =>
      new Intl.DateTimeFormat(this.content.locale(), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: this.zone(),
      }),
  );

  private readonly timeFormatter = computed(
    () =>
      new Intl.DateTimeFormat(this.content.locale(), {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: this.zone(),
      }),
  );

  /** The subtitle: the day this sheet is about. */
  protected readonly dayLabel = computed(() => this.formatLongDate(this.day()));

  // ── Live read ───────────────────────────────────────────────────────

  /** The day's question — the bag, the catalogue, the clock, a move's facts. */
  private readonly dayQuery = computed<DayQuery | null>(() => {
    const cart = this.store.cartData();
    const now = this.now();
    const localDate = this.localDate();
    const timeZone = this.timeZone();
    if (!cart || !now || !localDate || !timeZone) return null;
    return {
      cart,
      services: this.catalog.services(),
      barberIds: this.barberIds(),
      locationId: this.store.shopId(),
      localDate,
      timeZone,
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
      shops: this.catalog.locations(),
    };
  });

  /** The day's raw documents, live (`SCHEDULING_READ_PORTS`). */
  private readonly dayDocs = toSignal(
    toObservable(
      computed(() => {
        const query = this.dayQuery();
        return query === null ? null : dayDocsKey(query);
      }),
    ).pipe(
      // Structural identity, the schedule step's own: re-subscribing on a
      // no-op recompute re-bills this day's whole read.
      distinctUntilChanged(sameDayDocsKey),
      switchMap((key) =>
        key === null ? of(null) : observeDayDocs(this.scheduling, key),
      ),
    ),
    { initialValue: null },
  );

  /**
   * The day's arrangements — derived from its documents by the systems
   * (`dayOptions`), each with the instant its party starts on the shop's
   * clock. `null` while the documents for THIS question are on their way;
   * a read that failed offers nothing.
   */
  private readonly timedOptions = computed<readonly TimedOption[] | null>(
    () => {
      const query = this.dayQuery();
      const docs = this.dayDocs();
      if (query === null || docs === null) return null;
      if (!docs.ok) return [];
      if (!sameDayDocsKey(docs.value.key, dayDocsKey(query))) return null;
      const timed: TimedOption[] = [];
      for (const located of dayOptions(query, docs.value)) {
        const startMs = this.instantAt(located.option.startMinutes);
        if (startMs !== null) timed.push({ located, startMs });
      }
      return timed;
    },
  );

  protected readonly loading = computed(() => this.timedOptions() === null);

  private readonly options = computed<readonly TimedOption[]>(
    () => this.timedOptions() ?? [],
  );

  protected readonly dayparts = computed<readonly DaypartVm[]>(() => {
    // Named per shop only when the client did NOT pick one. With a shop chosen
    // every chip is at it, and repeating the name on 28 chips is noise.
    const nameShops = this.store.shopId() === null;

    const groups = new Map<Daypart, StartVm[]>(
      Daypart.ALL.map((part) => [part, []]),
    );

    for (const { located, startMs } of this.options()) {
      const { locationId, option } = located;
      // The shop's clock face, not the device's: «сутрин» is the shop's
      // morning — the option's own minute of the shop day.
      groups.get(Daypart.of(option.startMinutes))?.push({
        key: `${locationId}|${startMs}`,
        startMs,
        shopKey: locationId,
        label: this.formatTime(startMs),
        shopName: nameShops ? this.locationName(locationId) : null,
      });
    }

    // A heading with nothing under it is a promise the day cannot keep.
    return (
      [...groups.entries()]
        .filter(([, starts]) => starts.length > 0)
        // eslint-disable-next-line security/detect-object-injection -- closed union.
        .map(([part, starts]) => ({ key: DAYPART_KEY[part], starts }))
    );
  });

  protected readonly hasNoTimes = computed(
    () => !this.loading() && this.dayparts().length === 0,
  );

  /**
   * The arrangement the user is committing to, if they have picked a time.
   *
   * The engine's order is total, so "the first option at this start" is a
   * stable choice rather than whichever branch the search found first.
   */
  private readonly selectedOption = computed<CartLocatedOption | null>(() => {
    const startMs = this.selectedStartMs();
    const shopKey = this.store.selectedShopKey();
    if (startMs === null || shopKey === null) return null;
    return (
      this.options().find(
        (entry) =>
          entry.startMs === startMs && entry.located.locationId === shopKey,
      )?.located ?? null
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

      return option.option.assignments.map((assignment) => {
        const startMs = this.instantAt(assignment.startMinutes);
        return {
          barberName: this.barberName(assignment.barberId),
          personLabel: this.personLabel(
            seatByLineId.get(assignment.lineId) ?? '',
          ),
          timeLabel: startMs === null ? '' : this.formatTime(startMs),
        };
      });
    },
  );

  /**
   * Are the party's seats all at once, or one after another? Drives which
   * sentence heads the arrangement — the engine returns both kinds and the
   * user is told which one they picked.
   */
  protected readonly arrangementKind = computed<'parallel' | 'sequential'>(
    () => {
      const option = this.selectedOption()?.option;
      if (!option || option.assignments.length < 2) return 'parallel';
      const first = option.assignments[0]?.startMinutes;
      return option.assignments.every(
        (assignment) => assignment.startMinutes === first,
      )
        ? 'parallel'
        : 'sequential';
    },
  );

  // ── Commands ────────────────────────────────────────────────────────

  protected isSelectedStart(start: StartVm): boolean {
    return (
      this.selectedStartMs() === start.startMs &&
      this.store.selectedShopKey() === start.shopKey
    );
  }

  protected selectStart(start: StartVm): void {
    this.store.selectStart(start.startMs, start.shopKey);
  }

  /**
   * Emit the whole arrangement — envelope and per-seat placement.
   *
   * Shared with the flexible sheet through {@link toScheduleSelection}: both
   * turn a `LocatedOption` into the same shape, and two copies of that mapping
   * would be two answers to "what exactly did the user agree to".
   */
  protected confirm(): void {
    const located = this.selectedOption();
    const localDate = this.localDate();
    const timeZone = this.timeZone();
    if (!located || !localDate || !timeZone) return;
    const selection = toScheduleSelection(located, localDate, timeZone, (raw) =>
      this.store.cartLineId(raw),
    );
    if (!selection) return;
    this.confirmed.emit(selection);
  }

  /** A minute of this sheet's shop day as an instant — `null` in a spring-forward gap. */
  private instantAt(minute: MinuteOfDay): number | null {
    const localDate = this.localDate();
    const timeZone = this.timeZone();
    if (!localDate || !timeZone) return null;
    const instant = ZonedTimeSystem.toUtc(localDate, minute, timeZone);
    return instant.ok ? instant.value : null;
  }

  // ── Formatting ──────────────────────────────────────────────────────

  protected formatTime(millis: number): string {
    return this.timeFormatter().format(new Date(millis));
  }

  protected formatLongDate(day: CalendarDay): string {
    return this.longDateFormat().format(new Date(day.startOfDay().toMillis()));
  }

  protected locationName(locationId: LocationKey): string {
    const location = this.catalog
      .locations()
      .find((candidate) => candidate.id === locationId);
    return location
      ? this.content.text({ en: location.name.en, bg: location.name.bg })
      : locationId;
  }

  private barberName(barberId: BarberKey): string {
    const barber = this.catalog
      .barbers()
      .find((candidate) => candidate.id === barberId);
    return barber
      ? this.content.text({ en: barber.name.en, bg: barber.name.bg })
      : barberId;
  }

  /** `seatKeyValue` is `'self'` or the bare `GuestId` — never a prefixed form. */
  private personLabel(seatKey: string): string {
    // The booker by NAME once we know it — three steps said "You" to a
    // signed-in user whose name was sitting in the session the whole time
    // (owner ruling 2026-07-31). "You" is the fallback, not the rule.
    if (seatKey === 'self')
      return (
        this.identity.displayName() ||
        this.transloco.translate('booking.party.you')
      );
    const guest = this.store
      .guests()
      .find((candidate) => candidate.id.value === seatKey);
    return guest?.label.value ?? seatKey;
  }
}

/**
 * A located option → the event the machine takes.
 *
 * Free function rather than a method because every sheet that offers an
 * arrangement must hand the machine byte-identical selections, or the
 * server's re-check can disagree with whichever one the user happened to
 * use. The option is on the shop day's wall clock; the selection the flow
 * machine holds (Phase 4) is in instants, so each minute is placed on the
 * absolute timeline ONCE, here, with the shop's zone (the ingestion
 * boundary of the wire's `startIso`).
 *
 * Returns `null` when an assignment names a line the cart no longer holds —
 * refusing here beats sending a request the server rejects for a reason the
 * user cannot act on.
 */
export function toScheduleSelection(
  located: CartLocatedOption,
  localDate: LocalDate,
  timeZone: TimeZone,
  resolveLineId: (raw: string) => SeatAssignment['lineId'] | null,
): {
  readonly locationId: LocationId;
  readonly timeSlot: TimeSlot;
  readonly assignments: readonly SeatAssignment[];
} | null {
  const option = located.option;
  const assignments: SeatAssignment[] = [];

  for (const assignment of option.assignments) {
    const slot = toTimeSlot(
      localDate,
      assignment.startMinutes,
      assignment.endMinutes,
      timeZone,
    );
    const lineId = resolveLineId(assignment.lineId);
    const barberId = BarberId.create(assignment.barberId);
    if (!slot || !lineId || barberId.isFailure()) return null;
    assignments.push({ lineId, barberId: barberId.value, slot });
  }

  const envelope = toTimeSlot(
    localDate,
    option.startMinutes,
    option.endMinutes,
    timeZone,
  );
  // The shop comes from the OPTION, not from the picker: with "any shop"
  // they differ, and the appointment happens where the barbers are.
  const locationId = LocationId.create(located.locationId);
  if (
    !envelope ||
    locationId.isFailure() ||
    assignments.length !== option.assignments.length
  ) {
    return null;
  }

  return { locationId: locationId.value, timeSlot: envelope, assignments };
}

/** A span of the shop day → the instants it covers, on the shop's own clock. */
function toTimeSlot(
  localDate: LocalDate,
  startMinutes: MinuteOfDay,
  endMinutes: EndMinute,
  timeZone: TimeZone,
): TimeSlot | null {
  const startMs = ZonedTimeSystem.toUtc(localDate, startMinutes, timeZone);
  if (!startMs.ok) return null;
  const endMs = UtcEpochMs.plusMs(
    startMs.value,
    (endMinutes - startMinutes) * 60_000,
  );
  const start = ZonedDateTime.fromMillis(startMs.value, timeZone);
  const end = ZonedDateTime.fromMillis(endMs, timeZone);
  if (start.isFailure() || end.isFailure()) return null;
  const slot = TimeSlot.of(start.value, end.value);
  return slot.isSuccess() ? slot.value : null;
}
