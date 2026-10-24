import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { CLOCK_PORTS } from '@creativo/infrastructure/firebase-app';
import { type DaypartWord, daypartWords } from '@creativo/infrastructure/i18n';
import type {
  BarberId,
  CartLineId,
  LocalDate,
  LocationId,
  MinuteOfDay,
  TimeZone,
} from '@core/primitives';
import {
  type BookingPolicy,
  Daypart,
  ScheduleSelection,
  type SeatAssignment,
  SeatKey,
  type ShopNow,
} from '@core/components';
import {
  BookingCartSystem,
  type CartLocatedOption,
  type DayQuery,
  ZonedTimeSystem,
} from '@core/systems';
import {
  CatalogContentService,
  CatalogWording,
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
import { BookingDayStore } from '../booking-day.store';
import { formatBookingDay, formatBookingTime } from '../../booking-wall-clock';
import { SEAT_ARRANGEMENT_WORDS } from '../../booking-words';

/** A run of start times sharing a part of the day (`Daypart.of`). */
interface DaypartVm {
  /** Its catalogue key segment (`booking.schedule.daypart.morning`, …) — the one i18n table's word. */
  readonly key: DaypartWord;
  readonly starts: readonly StartVm[];
}

/**
 * One arrangement, at its shop, and the instant its party starts — the
 * `data-start` the e2e suite reads the booked instant from.
 */
interface TimedOption {
  readonly located: CartLocatedOption;
  readonly startMs: number;
}

interface StartVm {
  readonly key: string;
  /** The party's start, a minute of the shop day — what the pick holds. */
  readonly startMinutes: MinuteOfDay;
  /** The same start as an instant — the DOM's `data-start`, nothing else. */
  readonly startMs: number;
  readonly locationId: LocationId;
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
  private readonly clock = inject(CLOCK_PORTS);
  // The policy arrives as an INPUT now: the step already observes it for the
  // horizon its calendar runs to, and a sheet re-subscribing to the same port
  // could render one horizon while the grid behind it renders another. The
  // day's documents come through the flow's shop-day reads.
  private readonly days = inject(BookingDayStore);

  protected readonly catalog = inject(CatalogContentService);
  protected readonly content = inject(CatalogWording);
  protected readonly store = inject(BookingFlowStore);

  /** The shop day this sheet is about. */
  readonly day = input.required<LocalDate>();
  /** The shop's zone — "now" for the lead time, and the `data-start` instants. */
  readonly zone = input.required<TimeZone>();
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

  /** "Now" on the shop's wall clock — the lead time's floor. */
  private readonly now = computed<ShopNow>(() =>
    ZonedTimeSystem.shopNow(this.clock.nowUtcMs(), this.zone()),
  );

  private readonly barberIds = computed<readonly BarberId[]>(() =>
    this.catalog.barbers().map((barber) => barber.id),
  );

  /** The subtitle: the day this sheet is about. */
  protected readonly dayLabel = computed(() =>
    formatBookingDay(this.day(), this.content.locale()),
  );

  // ── Live read ───────────────────────────────────────────────────────

  /** The day's question — the bag, the catalogue, the clock, a move's facts. */
  private readonly dayQuery = computed<DayQuery | null>(() => {
    const cart = this.store.cart();
    if (!cart) return null;
    return {
      cart,
      services: this.catalog.services(),
      barberIds: this.barberIds(),
      locationId: this.store.locationId(),
      localDate: this.day(),
      policy: this.policy(),
      now: this.now(),
      // Everybody a MOVE carries, pinned to the party's start, for the
      // engine's rider check (`AvailabilityQuery.riders`): a start where one
      // of them cannot sit is not offered, because the server would refuse
      // it (`BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE`).
      riders: this.store.availabilityRiders(),
      // …and the visit's own chairs, handed back: its own seats never block
      // its own move, for the cart's lines and the riders alike.
      release: this.store.moveRelease(),
      releaseLocalDate: this.store.moveLocalDate(),
      shops: this.catalog.locations(),
    };
  });

  /** The day's raw documents, live — re-subscribed only when WHICH documents changes (`BookingDayStore`). */
  private readonly dayDocs = this.days.dayDocs(
    computed(() => {
      const query = this.dayQuery();
      return query === null ? null : BookingCartSystem.dayDocsKey(query);
    }),
  );

  /**
   * The day's arrangements — derived from its documents by the systems
   * (`BookingCartSystem.dayOptions`), each with the instant its party starts on the shop's
   * clock. A start inside a spring-forward gap names no instant and is not
   * offered — the commit would refuse it (`DST_GAP_INVALID_TIME`). `null`
   * while the documents for THIS question are on their way; a read that
   * failed offers nothing.
   */
  private readonly timedOptions = computed<readonly TimedOption[] | null>(
    () => {
      const query = this.dayQuery();
      const docs = this.dayDocs();
      if (query === null || docs === null) return null;
      if (!docs.ok) return [];
      if (
        !BookingCartSystem.sameDayDocsKey(
          docs.value.key,
          BookingCartSystem.dayDocsKey(query),
        )
      ) {
        return null;
      }
      const timed: TimedOption[] = [];
      for (const located of BookingCartSystem.dayOptions(query, docs.value)) {
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
    const nameShops = this.store.locationId() === null;

    const groups = new Map<Daypart, StartVm[]>(
      Daypart.ALL.map((part) => [part, []]),
    );

    for (const { located, startMs } of this.options()) {
      const { locationId, option } = located;
      // The shop's clock face, not the device's: «сутрин» is the shop's
      // morning — the option's own minute of the shop day.
      groups.get(Daypart.of(option.startMinutes))?.push({
        key: `${locationId}|${startMs}`,
        startMinutes: option.startMinutes,
        startMs,
        locationId,
        label: formatBookingTime(
          this.day(),
          option.startMinutes,
          this.content.locale(),
        ),
        shopName: nameShops ? this.locationName(locationId) : null,
      });
    }

    // A heading with nothing under it is a promise the day cannot keep.
    return (
      [...groups.entries()]
        .filter(([, starts]) => starts.length > 0)
        // eslint-disable-next-line security/detect-object-injection -- closed union.
        .map(([part, starts]) => ({ key: daypartWords[part], starts }))
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
    const start = this.store.selectedStartMinutes();
    const locationId = this.store.selectedLocationId();
    if (start === null || locationId === null) return null;
    return (
      this.options().find(
        (entry) =>
          entry.located.option.startMinutes === start &&
          entry.located.locationId === locationId,
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

      const seatByLineId = new Map<CartLineId, string>();
      for (const seat of cart.cartSeats) {
        for (const line of seat.lines) {
          seatByLineId.set(line.lineId, seat.seatKey);
        }
      }

      return option.option.assignments.map((assignment) => ({
        barberName: this.barberName(assignment.barberId),
        personLabel: this.personLabel(
          seatByLineId.get(assignment.lineId) ?? '',
        ),
        timeLabel: formatBookingTime(
          this.day(),
          assignment.startMinutes,
          this.content.locale(),
        ),
      }));
    },
  );

  /**
   * Are the party's seats all at once, or one after another
   * (`BookingCartSystem.arrangementOf`)? Drives which sentence heads the
   * arrangement — the engine returns both kinds and the user is told which
   * one they picked. The catalogue key's word, from the one table
   * (`SEAT_ARRANGEMENT_WORDS`).
   */
  protected readonly arrangementKind = computed(
    () =>
      SEAT_ARRANGEMENT_WORDS[
        BookingCartSystem.arrangementOf(
          this.selectedOption()?.option.assignments ?? [],
        )
      ],
  );

  // ── Commands ────────────────────────────────────────────────────────

  protected isSelectedStart(start: StartVm): boolean {
    return (
      this.store.selectedStartMinutes() === start.startMinutes &&
      this.store.selectedLocationId() === start.locationId
    );
  }

  protected selectStart(start: StartVm): void {
    this.store.selectStart(start.startMinutes, start.locationId);
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
    if (!located) return;
    const selection = toScheduleSelection(located, this.day(), (raw) =>
      this.store.cartLineId(raw),
    );
    if (!selection) return;
    this.confirmed.emit(selection);
  }

  /**
   * A minute of this sheet's shop day as an instant, in the shop's zone —
   * `null` in a spring-forward gap. Only the DOM's `data-start` reads it.
   */
  private instantAt(minute: MinuteOfDay): number | null {
    const instant = ZonedTimeSystem.toUtc(this.day(), minute, this.zone());
    return instant.ok ? instant.value : null;
  }

  // ── Formatting ──────────────────────────────────────────────────────

  protected locationName(locationId: LocationId): string {
    const location = this.catalog
      .locations()
      .find((candidate) => candidate.id === locationId);
    return location
      ? this.content.text({ en: location.name.en, bg: location.name.bg })
      : locationId;
  }

  private barberName(barberId: BarberId): string {
    const barber = this.catalog
      .barbers()
      .find((candidate) => candidate.id === barberId);
    return barber
      ? this.content.text({ en: barber.name.en, bg: barber.name.bg })
      : barberId;
  }

  /** A cart seat key (`SeatKey.text`) — `'self'`, or the bare guest id. */
  private personLabel(seatKey: string): string {
    // The booker by NAME once we know it — three steps said "You" to a
    // signed-in user whose name was sitting in the session the whole time
    // (owner ruling 2026-07-31). "You" is the fallback, not the rule.
    if (seatKey === SELF_SEAT)
      return (
        this.identity.displayName() ||
        this.transloco.translate('booking.party.you')
      );
    const guest = this.store
      .guests()
      .find((candidate) => candidate.guestId === seatKey);
    return guest?.guestLabel ?? seatKey;
  }
}

/** The booker's own cart seat key. */
const SELF_SEAT: string = SeatKey.text(SeatKey.self());

/**
 * A located option → the event the machine takes.
 *
 * Free function rather than a method because every sheet that offers an
 * arrangement must hand the machine byte-identical selections, or the
 * server's re-check can disagree with whichever one the user happened to
 * use. The option and the selection are both the shop day's wall clock
 * (Law 7.3): the commit's pipeline places them on the absolute timeline
 * once, with the location's zone.
 *
 * Returns `null` when an assignment names a line the cart no longer holds —
 * refusing here beats sending a request the server rejects for a reason the
 * user cannot act on.
 */
export function toScheduleSelection(
  located: CartLocatedOption,
  localDate: LocalDate,
  resolveLineId: (raw: string) => CartLineId | null,
): ScheduleSelection | null {
  const assignments: SeatAssignment[] = [];
  for (const assignment of located.option.assignments) {
    const lineId = resolveLineId(assignment.lineId);
    if (!lineId) return null;
    assignments.push({
      lineId,
      barberId: assignment.barberId,
      startMinutes: assignment.startMinutes,
      endMinutes: assignment.endMinutes,
    });
  }
  // The shop comes from the OPTION, not from the picker: with "any shop"
  // they differ, and the appointment happens where the barbers are.
  return ScheduleSelection.of(located.locationId, localDate, assignments);
}
