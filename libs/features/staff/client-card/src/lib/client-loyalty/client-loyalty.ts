import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { CouponGrantId } from '@core/primitives';
import {
  UiAvatar,
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiGauge,
  UiGrid,
  UiIcon,
  UiListGroup,
  UiListRow,
  UiLogo,
  UiNotice,
  UiPassCard,
  UiQuickAction,
  UiQuickActions,
  UiSectionHeader,
  UiSkeleton,
  UiStack,
} from '@creativo/ui/controls';
import {
  UiFrameDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
} from '@creativo/ui/modifiers';
import { ActivityList } from '../activity-list/activity-list';
import { ClientCardRegion, WalletAnchor } from '../client-card.contracts';
import { ClientCardStore } from '../client-card.store';
import { WalletActionId, type WalletActionVm } from '../client-pages.vm';
import { LoadState } from '@creativo/shared/view-state';
import { RhythmCard } from '../rhythm-card/rhythm-card';
import { regularSheetWidth } from '../sheet-width';
import {
  WalletHoldings,
  type WalletHoldingsWords,
} from '../wallet-holdings/wallet-holdings';

/**
 * A section of the page that is headed, anchored or failed by id: a
 * wallet anchor's section (`WalletAnchor`, one tag family — pass D, D-11)
 * and the ledger's. Values: external contract (the heading ids
 * `<titleId>-<section>`).
 */
const WalletSection = { ...WalletAnchor, Ledger: 'ledger' } as const;
type WalletSection = (typeof WalletSection)[keyof typeof WalletSection];

/**
 * The placeholders' heights (§2.2.4 «Loading»): a heading row at the
 * small rung, a ticket, and each later section one block shaped like its
 * card. The pass is its own shape (`aspect-ratio`, in the stylesheet).
 */
const PLACEHOLDER_HEIGHTS = {
  heading: 'var(--control-size-small)',
  ticket: 'calc(var(--sys-space-unit) * 30)',
  rhythm: 'calc(var(--sys-space-unit) * 51)',
  status: 'calc(var(--sys-space-unit) * 45)',
  catalog: 'calc(var(--sys-space-unit) * 37)',
} as const;

/**
 * «ЛОЯЛНОСТ» — the page a loyalty card pushes, drawn as a WALLET
 * (client-card-revision-3 §2.2; owner, 2026-09-29: "could be made like a
 * wallet, inspire from Revolut"). The bar names the page from rest and
 * the page's own `h2` is kept for a reader only, so the first thing under
 * the bar is the PASS: the client's loyalty card, the page's one orange
 * slab, with the balance as its white display figure, the tier as its
 * one plate and the holder on its white foot. Under it the four DISCS
 * («Използвай» promoted, «Код», «Награди», «История»), only those that
 * work today. Then what the page answers, module by module, each a
 * heading over white elevated cards: «В портфейла» (every thing held, a
 * ticket on white paper), «Ритъм», «Статус» (a ring holding what remains
 * over the four tiers as steps), «Награди за точки» (a 2-up grid of
 * information) and «Движение» (the newest five events, «Всички ›» to the
 * ledger page).
 *
 * The page renders and computes nothing: the store's `wallet` slice is
 * already worded (`walletVm`). A module whose flag or data is absent is
 * absent, heading and all; a module that rides a read of its own (the
 * vouchers, the catalogue, the activity) keeps its heading over the one
 * retry notice when that read fails; the account failing whole is one
 * notice under the bar. A paused client's pass desaturates and says
 * «Замразено», the tickets go, no value is zeroed. Offline, the saved
 * values stay and the two verbs that write («Използвай», «Код») are
 * absent — the presenter decides, this body draws.
 *
 * ONE FACT, ONE ENCODING (§2.2.1): the stamps count themselves, the
 * rhythm is the figure and the track, the status a ring and a ladder;
 * «Злато» is on the pass and under the ladder's node, «Използвай» is the
 * disc, nowhere else.
 *
 * The host asks the sheet for the TIGHT fade (`data-sheet-fade="tight"`,
 * §3.3): a bar without a large title collapses on the first pixel of
 * scroll, and without it a white haze would lie over the orange pass.
 *
 * `anchor` (the card that pushed: the glance's loyalty card, a stamp
 * card, the rhythm, the status) scrolls that section's heading under the
 * bar and focuses it once what lies above it has painted; the sheet
 * focused the page container first, so this lands last. The «Награди»
 * disc lands on the catalogue the same way.
 */
@Component({
  selector: 'lib-client-loyalty',
  imports: [
    ActivityList,
    NgTemplateOutlet,
    RhythmCard,
    UiAvatar,
    UiBadge,
    UiButton,
    UiCard,
    UiEmptyState,
    UiFrameDirective,
    UiGauge,
    UiGrid,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiLogo,
    UiNotice,
    UiPassCard,
    UiQuickAction,
    UiQuickActions,
    UiSectionHeader,
    UiSkeleton,
    UiStack,
    UiTextDirective,
    UiVisuallyHiddenDirective,
    WalletHoldings,
  ],
  templateUrl: './client-loyalty.html',
  styleUrl: './client-loyalty.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-testid': 'rewards-page',
    // The bar's fade keeps to the bar: the pass passes under a crisp edge.
    'data-sheet-fade': 'tight',
    '[attr.data-wide]': "wide() ? '' : null",
  },
})
export class ClientLoyaltyPage {
  /** The `h2`'s id: the sheet's page container is labelled by it. */
  readonly titleId = input.required<string>();
  /** The section the pushing card names; `null` = the page top. */
  readonly anchor = input<WalletAnchor | null>(null);
  /** «Използвай» with ONE ready ticket: the sheet puts that grant on the bill and opens the discount page on it. */
  readonly openReward = output<CouponGrantId>();
  /** An applied ticket's «Премахни»: the sheet takes that grant off the bill, as the discount page's card does. */
  readonly removeReward = output<CouponGrantId>();
  /** «Код» (and «Използвай» with several tickets): the sheet pushes the discount page. */
  readonly openCode = output<void>();
  /** «История» and «Всички ›»: the sheet pushes the ledger page «Движение». */
  readonly openLedger = output<void>();

  private readonly store = inject(ClientCardStore);
  protected readonly words = this.store.words;
  /** Where each section's read stands, for the template's switches. */
  protected readonly LoadState = LoadState;
  /** The sections and the regions they retry, for the template's headings. */
  protected readonly WalletSection = WalletSection;
  protected readonly ClientCardRegion = ClientCardRegion;
  protected readonly online = this.store.online;
  protected readonly wallet = this.store.wallet;

  /** The centred dialog is up (≥ 761 px): the discs beside the pass, the holdings 2-up, the rewards 3 across. */
  protected readonly wide = regularSheetWidth();

  protected readonly heights = PLACEHOLDER_HEIGHTS;
  protected readonly placeholderDiscs = [0, 1, 2, 3] as const;
  protected readonly placeholderTickets = [0, 1] as const;
  /** The later sections every flagged page is likely to show. */
  protected readonly placeholderSections = [
    WalletSection.Rhythm,
    WalletSection.Status,
    WalletSection.Catalog,
  ] as const;
  protected readonly placeholderRows = [0, 1, 2] as const;

  /** The two words the holdings print that no view model carries. */
  protected readonly holdingWords = computed<WalletHoldingsWords | null>(() => {
    const words = this.words();
    return words === null
      ? null
      : { stampCard: words.loyaltyPage.stampCard, remove: words.reward.remove };
  });

  private readonly walletHeading =
    viewChild<ElementRef<HTMLElement>>('walletHeading');
  private readonly rhythmHeading =
    viewChild<ElementRef<HTMLElement>>('rhythmHeading');
  private readonly statusHeading =
    viewChild<ElementRef<HTMLElement>>('statusHeading');
  private readonly catalogHeading =
    viewChild<ElementRef<HTMLElement>>('catalogHeading');

  /** The anchor already honoured: a later render never takes the focus back. */
  private anchored: WalletAnchor | null = null;

  constructor() {
    afterRenderEffect(() => {
      const anchor = this.anchor();
      if (anchor === null) {
        this.anchored = null;
        return;
      }
      if (anchor === this.anchored) return;
      const slice = this.wallet();
      if (slice?.loadState !== LoadState.Ready) return;
      const vm = slice.data;
      // What lies above a section still grows while its reads land: the
      // holdings before every section under them, the status card before
      // the catalogue. Land once they have painted.
      if (
        anchor !== WalletAnchor.Wallet &&
        anchor !== WalletAnchor.Stamps &&
        vm.holdings.loadState === LoadState.Loading
      ) {
        return;
      }
      if (
        anchor === WalletAnchor.Catalog &&
        vm.tier?.loadState === LoadState.Loading
      ) {
        return;
      }
      this.anchored = anchor;
      this.landOn(anchor);
    });
  }

  /** A section heading's id, unique per page (the title's id leads it). */
  protected headingId(section: WalletSection): string {
    return `${this.titleId()}-${section}`;
  }

  /** The run's columns: one per verb; a 2 × 2 beside the pass in the dialog. */
  protected discColumns(count: number): number {
    return this.wide() ? Math.min(2, count) : count;
  }

  /** A disc's verb (§2.2.3). */
  protected act(action: WalletActionVm): void {
    switch (action.id) {
      case WalletActionId.Use:
        if (action.grantId !== null) this.openReward.emit(action.grantId);
        else this.openCode.emit();
        return;
      case WalletActionId.Code:
        this.openCode.emit();
        return;
      case WalletActionId.Catalog:
        this.landOn(WalletAnchor.Catalog);
        return;
      case WalletActionId.History:
        this.openLedger.emit();
        return;
    }
  }

  /** «Опитай пак» under a section or the whole page: that region's failed reads again. */
  protected retry(region: ClientCardRegion): void {
    this.store.retry(region);
  }

  /** Scrolls a section's heading under the bar and focuses it; a section the flags leave out keeps the focus where it is. */
  private landOn(anchor: WalletAnchor): void {
    const heading = this.headingOf(anchor)?.nativeElement;
    if (heading === undefined) return;
    if (typeof heading.scrollIntoView === 'function') {
      heading.scrollIntoView({ block: 'start' });
    }
    heading.focus({ preventScroll: true });
  }

  private headingOf(anchor: WalletAnchor): ElementRef<HTMLElement> | undefined {
    switch (anchor) {
      case WalletAnchor.Wallet:
      case WalletAnchor.Stamps:
        return this.walletHeading();
      case WalletAnchor.Rhythm:
        return this.rhythmHeading();
      case WalletAnchor.Status:
        return this.statusHeading();
      case WalletAnchor.Catalog:
        return this.catalogHeading();
    }
  }
}
