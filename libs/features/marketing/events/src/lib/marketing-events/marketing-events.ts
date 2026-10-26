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
  CATALOG_PORTS,
  CLOCK_PORTS,
  SHOP_EVENT_READ_PORTS,
} from '@creativo/infrastructure/firebase-app';
import {
  SiteFooterComponent,
  SiteHeaderComponent,
} from '@creativo/features/shared/shell';
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
import { eventRowsVm } from './marketing-events.presenter';
import type { EventRowVm } from './marketing-events.vm';

/**
 * Which events `/events` lists — the page's field `tab`, the ONLY source of
 * these strings (Law 1). Internal: the chips' test ids (`events-tab-upcoming`,
 * `events-tab-past`) are written out in the template, never built from a
 * value.
 */
const EventsTab = {
  /** The events still to come (`observeEvents({ upcoming: true })`). */
  Upcoming: 'UPCOMING',
  /** The events that have happened. */
  Past: 'PAST',
} as const;
type EventsTab = (typeof EventsTab)[keyof typeof EventsTab];

const INSTAGRAM_URL = 'https://instagram.com/creativo.barbershop';

/** `/events` — public browse page for shop events, Upcoming/Past. Unlike
 *  `MarketingCourses`' single query split client-side by tab, upcoming and
 *  past are two distinct reads of `SHOP_EVENT_READ_PORTS` (`observeEvents`
 *  with `upcoming: true | false`, split on the instant the clock answers
 *  once per tab subscription) — switching tabs re-subscribes via
 *  `toObservable(tab).pipe(switchMap(...))`, the same pattern
 *  `AppointmentsStore` uses for its `userId` cursor. A row's words are the
 *  presenter's (`eventRowsVm`, OR-37): its date on the shop's wall clock as
 *  stored (flip-4 F4-11), then — at a multi-shop tenant — the shop it is
 *  at, from the catalogue's ACTIVE shops read once beside the events
 *  (`observeLocations`); unread or failed, the date alone. Chrome is the
 *  real site header/footer, solid (`uiOverHero=false`). */
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
  private readonly catalog = inject(CATALOG_PORTS);
  private readonly clock = inject(CLOCK_PORTS);
  private readonly transloco = inject(TranslocoService);
  private readonly title = inject(Title);

  protected readonly instagramUrl = INSTAGRAM_URL;
  /** The dictionary, for the template's `@case`s (never bare literals). */
  protected readonly LoadState = LoadState;
  /** The tabs, for the template's chips (never bare literals). */
  protected readonly EventsTab = EventsTab;
  protected readonly tab = signal<EventsTab>(EventsTab.Upcoming);

  private readonly result = toSignal(
    toObservable(this.tab).pipe(
      switchMap((tab) =>
        this.events.observeEvents({
          nowUtcMs: this.clock.nowUtcMs(),
          upcoming: tab === EventsTab.Upcoming,
        }),
      ),
    ),
    { initialValue: undefined },
  );

  /** The active UI language — the rows re-word on a switch. */
  private readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  /** The ACTIVE shops, as read — `undefined` until they answer (OR-37). */
  private readonly shops = toSignal(this.catalog.observeLocations(), {
    initialValue: undefined,
  });

  protected readonly state = computed<LoadSlice<readonly EventRowVm[]>>(() => {
    const result = this.result();
    if (result === undefined) return LoadSlice.loading;
    if (!result.ok) return LoadSlice.failed;
    return LoadSlice.ready(
      eventRowsVm({
        events: result.value,
        shops: this.shops(),
        lang: this.lang(),
        fallbackHref: this.instagramUrl,
      }),
    );
  });

  constructor() {
    this.title.setTitle('Events · Creativo');
  }

  protected setTab(next: EventsTab): void {
    this.tab.set(next);
  }
}
