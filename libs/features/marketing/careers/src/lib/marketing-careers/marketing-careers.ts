import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  ObserveOpenPositionsUseCase,
  POSITION_REPOSITORY,
  Position,
  PositionStatus,
} from '@creativo/application/programs';
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
  UiListGroup,
  UiListRow,
  UiSectionHeader,
} from '@creativo/ui/patterns';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';

type PositionsListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly positions: readonly Position[] };

const INSTAGRAM_URL = 'https://instagram.com/creativo.barbershop';

const STATUS_TONES: Record<PositionStatus, UiBadgeTone> = {
  open: 'accent',
  closed: 'neutral',
};

/** `/careers` — public browse page for open positions, replacing the
 *  landing hiring teaser's Instagram-only "Apply" CTA with a real
 *  destination. Structure mirrors `client-appointments`: a page-scoped
 *  `toSignal(useCase.execute())`, a `loading | error | ready` state union,
 *  `ui-list-group` for the list body (no `ui-divider`s — the seam is the
 *  separator), a hand-composed empty state falling back to the shop's
 *  Instagram link. Chrome is the real site header/footer
 *  (`@creativo/features/shared/shell`), solid (`uiOverHero=false`) since
 *  there's no hero underneath. */
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
  private readonly positionRepository = inject(POSITION_REPOSITORY);
  private readonly observeOpenPositionsUseCase =
    new ObserveOpenPositionsUseCase(this.positionRepository);
  private readonly transloco = inject(TranslocoService);
  private readonly title = inject(Title);

  protected readonly instagramUrl = INSTAGRAM_URL;

  private readonly result = toSignal(
    this.observeOpenPositionsUseCase.execute(),
    {
      initialValue: undefined,
    },
  );

  protected readonly state = computed<PositionsListState>(() => {
    const result = this.result();
    if (result === undefined) return { kind: 'loading' };
    if (result.isFailure()) return { kind: 'error' };
    return { kind: 'ready', positions: result.value };
  });

  constructor() {
    this.title.setTitle('Careers · Creativo');
  }

  protected text(localized: { get(locale: 'en' | 'bg'): string }): string {
    return localized.get(this.transloco.getActiveLang() as 'en' | 'bg');
  }

  protected applyHref(position: Position): string {
    return position.applyUrl ?? this.instagramUrl;
  }

  protected statusTone(status: PositionStatus): UiBadgeTone {
    return STATUS_TONES[status];
  }
}
