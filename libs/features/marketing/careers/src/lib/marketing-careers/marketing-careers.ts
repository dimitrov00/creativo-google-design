import { positionStatusWords } from '@creativo/infrastructure/i18n';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { LocalizedText, PositionStatus } from '@core/components';
import type { Position } from '@core/entities';
import { Locale } from '@core/primitives';
import { POSITION_READ_PORTS } from '@creativo/infrastructure/firebase-app';
import {
  SiteFooterComponent,
  SiteHeaderComponent,
} from '@creativo/features/shared/shell';
import {
  UiBadge,
  UiBadgeTone,
  UiButton,
  UiIcon,
  UiSkeleton,
} from '@creativo/ui/controls';
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

const INSTAGRAM_URL = 'https://instagram.com/creativo.barbershop';

const STATUS_TONES = {
  [PositionStatus.Open]: 'accent',
  [PositionStatus.Closed]: 'neutral',
} as const satisfies Record<PositionStatus, UiBadgeTone>;

/** `/careers` — public browse page for open positions, replacing the
 *  landing hiring teaser's Instagram-only "Apply" CTA with a real
 *  destination. Structure mirrors `client-appointments`: a page-scoped
 *  `toSignal` over the live read (`POSITION_READ_PORTS`, open roles only),
 *  the shared `LoadSlice` read state, `ui-list-group` for the list
 *  body (no `ui-divider`s — the seam is the separator), a hand-composed
 *  empty state falling back to the shop's Instagram link. Chrome is the
 *  real site header/footer (`@creativo/features/shared/shell`), solid
 *  (`uiOverHero=false`) since there's no hero underneath. */
@Component({
  selector: 'cr-marketing-careers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SiteFooterComponent,
    SiteHeaderComponent,
    TranslocoDirective,
    UiBadge,
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
  private readonly transloco = inject(TranslocoService);
  private readonly title = inject(Title);

  protected readonly instagramUrl = INSTAGRAM_URL;
  /** The dictionary, for the template's `@case`s (never bare literals). */
  protected readonly LoadState = LoadState;

  private readonly result = toSignal(
    this.positions.observePositions(PositionStatus.Open),
    { initialValue: undefined },
  );

  protected readonly state = computed<LoadSlice<readonly Position[]>>(() => {
    const result = this.result();
    if (result === undefined) return LoadSlice.loading;
    if (!result.ok) return LoadSlice.failed;
    return LoadSlice.ready(result.value);
  });

  constructor() {
    this.title.setTitle('Careers · Creativo');
  }

  /** The active language's string — `bg` for every language but `en`. */
  protected text(localized: LocalizedText): string {
    return LocalizedText.pick(
      localized,
      this.transloco.getActiveLang() === Locale.En ? Locale.En : Locale.Bg,
    );
  }

  protected applyHref(position: Position): string {
    return position.applyUrl ?? this.instagramUrl;
  }

  protected statusTone(positionStatus: PositionStatus): UiBadgeTone {
    // eslint-disable-next-line security/detect-object-injection -- closed union.
    return STATUS_TONES[positionStatus];
  }

  protected statusWord(positionStatus: PositionStatus): string {
    // eslint-disable-next-line security/detect-object-injection -- closed union.
    return positionStatusWords[positionStatus];
  }
}
