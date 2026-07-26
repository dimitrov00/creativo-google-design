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
import {
  ObservePastShopEventsUseCase,
  ObserveUpcomingShopEventsUseCase,
  SHOP_EVENT_REPOSITORY,
  ShopEvent,
} from '@creativo/application/programs';
import {
  SiteFooterComponent,
  SiteHeaderComponent,
} from '@creativo/features/marketing/shell';
import { UiButton, UiChip, UiIcon, UiSkeleton } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiCard,
  UiListGroup,
  UiListRow,
  UiSectionHeader,
} from '@creativo/ui/patterns';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';

type EventsTab = 'upcoming' | 'past';

type EventsListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly events: readonly ShopEvent[] };

const INSTAGRAM_URL = 'https://instagram.com/creativo.barbershop';

/** `/events` — public browse page for shop events, Upcoming/Past. Unlike
 *  `MarketingCourses`' single query split client-side by tab, upcoming and
 *  past are two distinct repository queries (`observeUpcoming`/
 *  `observePast`) — switching tabs re-subscribes via `toObservable(tab)
 *  .pipe(switchMap(...))`, the same pattern `AppointmentsStore` uses for
 *  its `userId` cursor. Chrome is the real site header/footer, solid
 *  (`uiOverHero=false`). */
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
  private readonly eventRepository = inject(SHOP_EVENT_REPOSITORY);
  private readonly observeUpcomingUseCase =
    new ObserveUpcomingShopEventsUseCase(this.eventRepository);
  private readonly observePastUseCase = new ObservePastShopEventsUseCase(
    this.eventRepository,
  );
  private readonly transloco = inject(TranslocoService);
  private readonly title = inject(Title);

  protected readonly instagramUrl = INSTAGRAM_URL;
  protected readonly tab = signal<EventsTab>('upcoming');

  private readonly result = toSignal(
    toObservable(this.tab).pipe(
      switchMap((tab) =>
        tab === 'upcoming'
          ? this.observeUpcomingUseCase.execute()
          : this.observePastUseCase.execute(),
      ),
    ),
    { initialValue: undefined },
  );

  protected readonly state = computed<EventsListState>(() => {
    const result = this.result();
    if (result === undefined) return { kind: 'loading' };
    if (result.isFailure()) return { kind: 'error' };
    return { kind: 'ready', events: result.value };
  });

  constructor() {
    this.title.setTitle('Events · Creativo');
  }

  protected setTab(next: EventsTab): void {
    this.tab.set(next);
  }

  protected text(localized: { get(locale: 'en' | 'bg'): string }): string {
    return localized.get(this.transloco.getActiveLang() as 'en' | 'bg');
  }

  protected applyHref(event: ShopEvent): string {
    return event.applyUrl ?? this.instagramUrl;
  }

  protected formatDate(event: ShopEvent): string {
    return event.startDate.toLocaleString(this.transloco.getActiveLang(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
