import { ContactSheetComponent } from '@creativo/features/shared/catalog';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { PositionStatus } from '@core/components';
import type { PositionBody } from '@core/entities';
import {
  CATALOG_PORTS,
  POSITION_BODY_READ_PORTS,
  POSITION_READ_PORTS,
} from '@creativo/infrastructure/firebase-app';
import {
  SiteFooterComponent,
  SiteHeaderComponent,
} from '@creativo/features/shared/shell';
import { UiButton, UiIcon, UiSkeleton } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiCard,
  UiEmptyState,
  UiListGroup,
  UiListRow,
  UiSectionHeader,
} from '@creativo/ui/patterns';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { LoadSlice, LoadState } from '@creativo/shared/view-state';
import { positionRowsVm, positionSheetVm } from './marketing-careers.presenter';
import type { PositionRowVm } from './marketing-careers.vm';

const INSTAGRAM_URL = 'https://instagram.com/creativo.barbershop';

/** `/careers` — public browse page for open positions, replacing the
 *  landing hiring teaser's Instagram-only "Apply" CTA with a real
 *  destination. Structure mirrors `client-appointments`: a page-scoped
 *  `toSignal` over the live read (`POSITION_READ_PORTS`, open roles only),
 *  the shared `LoadSlice` read state, `ui-list-group` for the list
 *  body (no `ui-divider`s — the seam is the separator), a hand-composed
 *  empty state falling back to the shop's Instagram link. A tapped role
 *  opens its sheet and reads its description then (`POSITION_BODY_READ_PORTS`,
 *  one document), drawn under its summary. A row's words
 *  are the presenter's (`positionRowsVm`, OR-42): at a multi-shop tenant a
 *  role scoped to some shops names them under its summary, from the
 *  catalogue's ACTIVE shops read once beside the roles
 *  (`observeLocations`). Chrome is the real site header/footer
 *  (`@creativo/features/shared/shell`), solid (`uiOverHero=false`) since
 *  there's no hero underneath. */
@Component({
  selector: 'cr-marketing-careers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ContactSheetComponent,
    SiteFooterComponent,
    SiteHeaderComponent,
    TranslocoDirective,
    UiButton,
    UiCard,
    UiEmptyState,
    UiFrameDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiSectionHeader,
    UiSkeleton,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './marketing-careers.html',
  styleUrl: './marketing-careers.css',
  host: { 'data-testid': 'careers-page' },
})
export class MarketingCareers {
  private readonly positions = inject(POSITION_READ_PORTS);
  private readonly bodies = inject(POSITION_BODY_READ_PORTS);
  private readonly catalog = inject(CATALOG_PORTS);
  private readonly transloco = inject(TranslocoService);
  private readonly title = inject(Title);

  protected readonly instagramUrl = INSTAGRAM_URL;
  /** The row the sheet is open for; `null` while it is shut. */
  private readonly opened = signal<PositionRowVm | null>(null);
  /** The open role's description, once read — `null` for none or not yet. */
  private readonly openedBody = signal<PositionBody | null>(null);
  /** The dictionary, for the template's `@case`s (never bare literals). */
  protected readonly LoadState = LoadState;

  private readonly result = toSignal(
    this.positions.observePositions(PositionStatus.Open),
    { initialValue: undefined },
  );

  /** The active UI language — the rows re-word on a switch. */
  private readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  /** The ACTIVE shops, as read — `undefined` until they answer (OR-42). */
  private readonly shops = toSignal(this.catalog.observeLocations(), {
    initialValue: undefined,
  });

  protected readonly state = computed<LoadSlice<readonly PositionRowVm[]>>(
    () => {
      const result = this.result();
      if (result === undefined) return LoadSlice.loading;
      if (!result.ok) return LoadSlice.failed;
      return LoadSlice.ready(
        positionRowsVm({
          positions: result.value,
          shops: this.shops(),
          lang: this.lang(),
          fallbackHref: this.instagramUrl,
        }),
      );
    },
  );

  /** The open role as its sheet prints it; `null` while it is shut. */
  protected readonly contactFor = computed(() => {
    const row = this.opened();
    return row === null
      ? null
      : positionSheetVm({ row, body: this.openedBody(), lang: this.lang() });
  });

  /**
   * A role tapped: its sheet opens at once on its words and the ways to
   * answer, and its description is read — one document, only now — and
   * drawn when it answers. A role with none, or a read that failed, leaves
   * the sheet as it opened.
   */
  protected open(row: PositionRowVm): void {
    this.openedBody.set(null);
    this.opened.set(row);
    void this.bodies.loadPositionBody(row.id).then((result) => {
      if (result.ok && this.opened()?.id === row.id) {
        this.openedBody.set(result.value);
      }
    });
  }

  /** The sheet has left. */
  protected close(): void {
    this.opened.set(null);
    this.openedBody.set(null);
  }

  constructor() {
    this.title.setTitle('Careers · Creativo');
  }
}
