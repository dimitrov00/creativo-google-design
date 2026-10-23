import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { Title } from '@angular/platform-browser';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { LocalizedText } from '@core/components';
import type { ShopEvent } from '@core/entities';
import { Locale } from '@core/primitives';
import {
  CLOCK_PORTS,
  SHOP_EVENT_READ_PORTS,
} from '@creativo/infrastructure/firebase-app';
import {
  SiteFooterComponent,
  SiteHeaderComponent,
} from '@creativo/features/shared/shell';
import { formatWallClock } from '@creativo/ui/wall-clock';
import { UiButton, UiChip, UiIcon, UiSkeleton } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiCard,
  UiListGroup,
  UiListRow,
  UiSectionHeader,
} from '@creativo/ui/patterns';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { LoadSlice, LoadState } from '@creativo/shared/view-state';

type EventsTab = 'upcoming' | 'past';

const INSTAGRAM_URL = 'https://instagram.com/creativo.barbershop';

/** A row's date — «Mon, Oct 5, 07:00 PM» / «пн, 5.10, 19:00». */
const EVENT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
};

/** `/events` — public browse page for shop events, Upcoming/Past. Unlike
 *  `MarketingCourses`' single query split client-side by tab, upcoming and
 *  past are two distinct reads of `SHOP_EVENT_READ_PORTS` (`observeEvents`
 *  with `upcoming: true | false`, split on the instant the clock answers
 *  once per tab subscription) — switching tabs re-subscribes via
 *  `toObservable(tab).pipe(switchMap(...))`, the same pattern
 *  `AppointmentsStore` uses for its `userId` cursor. A row's date is the
 *  shop's wall clock as stored (`formatWallClock`, flip-4 F4-11). Chrome is
 *  the real site header/footer, solid (`uiOverHero=false`). */
@Component({
  selector: 'cr-marketing-events',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SiteFooterComponent,
    SiteHeaderComponent,
    TranslocoDirective,
    UiButton,
    UiCard,
    UiChip,
    UiFrameDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiSectionHeader,
    UiSkeleton,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './marketing-events.html',
  styleUrl: './marketing-events.css',
  host: { 'data-testid': 'events-page' },
})
export class MarketingEvents {
  private readonly events = inject(SHOP_EVENT_READ_PORTS);
  private readonly clock = inject(CLOCK_PORTS);
  private readonly transloco = inject(TranslocoService);
  private readonly title = inject(Title);

  protected readonly instagramUrl = INSTAGRAM_URL;
  /** The dictionary, for the template's `@case`s (never bare literals). */
  protected readonly LoadState = LoadState;
  protected readonly tab = signal<EventsTab>('upcoming');

  private readonly result = toSignal(
    toObservable(this.tab).pipe(
      switchMap((tab) =>
        this.events.observeEvents({
          nowUtcMs: this.clock.nowUtcMs(),
          upcoming: tab === 'upcoming',
        }),
      ),
    ),
    { initialValue: undefined },
  );

  protected readonly state = computed<LoadSlice<readonly ShopEvent[]>>(() => {
    const result = this.result();
    if (result === undefined) return LoadSlice.loading;
    if (!result.ok) return LoadSlice.failed;
    return LoadSlice.ready(result.value);
  });

  constructor() {
    this.title.setTitle('Events · Creativo');
  }

  protected setTab(next: EventsTab): void {
    this.tab.set(next);
  }

  /** The active language's string — `bg` for every language but `en`. */
  protected text(localized: LocalizedText): string {
    return LocalizedText.pick(
      localized,
      this.transloco.getActiveLang() === Locale.En ? Locale.En : Locale.Bg,
    );
  }

  protected applyHref(event: ShopEvent): string {
    return event.applyUrl ?? this.instagramUrl;
  }

  /** The event's day and time on the shop's wall clock, in the active language. */
  protected formatDate(event: ShopEvent): string {
    return formatWallClock(
      event.localDate,
      event.startMinutes,
      this.transloco.getActiveLang(),
      EVENT_DATE_FORMAT,
    );
  }
}
