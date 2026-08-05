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
  AVAILABILITY_READER,
  BookingPolicy,
  CalendarDay,
  type LocatedOption,
  ObserveDayAvailabilityUseCase,
  type ScheduleSelection,
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
  private readonly availability = inject(AVAILABILITY_READER);

  protected readonly catalog = inject(CatalogContentService);
  protected readonly content = inject(CatalogPresenter);
  protected readonly store = inject(BookingFlowStore);

  private readonly observeDay = new ObserveDayAvailabilityUseCase(
    this.availability,
  );

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

  private readonly now = computed<ZonedDateTime | null>(() => {
    const result = this.clock.now(this.zone());
    return result.isSuccess() ? result.value : null;
  });

  private readonly barberIds = computed<readonly BarberId[]>(() =>
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

  private readonly dayQuery = computed(() => {
    const cart = this.store.cart();
    const now = this.now();
    if (!cart || !now) return null;
    return {
      cart,
      services: this.catalog.services(),
      barberIds: this.barberIds(),
      locationId: this.store.locationId(),
      day: this.day(),
      policy: this.policy(),
      now,
    };
  });

  private readonly dayResult = toSignal(
    toObservable(this.dayQuery).pipe(
      // Structural identity, exactly as the schedule step's streams: the
      // computed mints a fresh literal per recompute, and re-subscribing on
      // a no-op recompute re-bills this day's whole read (1 + 2×barbers
      // listeners). References suffice for cart/services/policy — they
      // change identity only on a real change now that the policy is
      // identity-stable at its source.
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
        input === null ? of(null) : this.observeDay.execute(input),
      ),
    ),
    { initialValue: null },
  );

  protected readonly loading = computed(() => this.dayResult() === null);

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
    () => !this.loading() && this.dayparts().length === 0,
  );

  /**
   * The arrangement the user is committing to, if they have picked a time.
   *
   * The engine's order is total, so "the first option at this start" is a
   * stable choice rather than whichever branch the search found first.
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
      const option = this.selectedOption()?.option;
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
    if (!located) return;
    const selection = toScheduleSelection(located, this.zone(), (raw) =>
      this.store.cartLineId(raw),
    );
    if (!selection) return;
    this.confirmed.emit(selection);
  }

  // ── Formatting ──────────────────────────────────────────────────────

  protected formatTime(millis: number): string {
    return this.timeFormatter().format(new Date(millis));
  }

  protected formatLongDate(day: CalendarDay): string {
    return this.longDateFormat().format(new Date(day.startOfDay().toMillis()));
  }

  protected locationName(locationId: LocationId): string {
    const location = this.catalog
      .locations()
      .find((candidate) => candidate.id.equals(locationId));
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
 * Free function rather than a method because BOTH sheets produce one: the
 * single-day picker and the flexible search offer arrangements from the same
 * engine, and they must hand the machine byte-identical selections or the
 * server's re-check can disagree with whichever one the user happened to use.
 *
 * Returns `null` when an assignment names a line the cart no longer holds —
 * refusing here beats sending a request the server rejects for a reason the
 * user cannot act on.
 */
export function toScheduleSelection(
  located: LocatedOption,
  zone: string,
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
      assignment.slot.startMs,
      assignment.slot.endMs,
      zone,
    );
    const lineId = resolveLineId(assignment.lineId);
    if (!slot || !lineId) return null;
    assignments.push({ lineId, barberId: assignment.barberId, slot });
  }

  const envelope = toTimeSlot(
    option.envelope.startMs,
    option.envelope.endMs,
    zone,
  );
  if (!envelope || assignments.length !== option.assignments.length)
    return null;

  return {
    // The shop comes from the OPTION, not from the picker: with "any shop"
    // they differ, and the appointment happens where the barbers are.
    locationId: located.locationId,
    timeSlot: envelope,
    assignments,
  };
}

function toTimeSlot(
  startMs: number,
  endMs: number,
  zone: string,
): TimeSlot | null {
  const start = ZonedDateTime.fromMillis(startMs, zone);
  const end = ZonedDateTime.fromMillis(endMs, zone);
  if (start.isFailure() || end.isFailure()) return null;
  const slot = TimeSlot.of(start.value, end.value);
  return slot.isSuccess() ? slot.value : null;
}
