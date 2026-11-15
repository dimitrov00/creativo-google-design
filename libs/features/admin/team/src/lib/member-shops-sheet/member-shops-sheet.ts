import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import type { Barber } from '@core/entities';
import type { LocalDate, LocationId } from '@core/primitives';
import { LocationScopeSystem, TeamSystem } from '@core/systems';
import { CatalogContentService } from '@creativo/features/shared/catalog';
import { UiButton, UiModalSheet, UiSwitch } from '@creativo/ui/controls';
import { UiIcon } from '@creativo/ui/icons';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiNotice,
  UiSheetActionBar,
  UiSheetHeadline,
} from '@creativo/ui/patterns';
import { shopRows } from '../shops.presenter';
import type { ShopRowVm } from '../shops.vm';
import { TeamMemberStore } from '../team-member.store';
import { TeamWording } from '../team-wording.service';

/**
 * «САЛОНИ» — where a barber works (team onboarding D5): every shop, or the
 * ones ticked. «Всички салони» is its own answer, not a list of every
 * shop: it also means any shop added later, as the stored empty list does.
 *
 * The sheet holds a draft and decides nothing. A shop the roster still has
 * hours at keeps its tick (`TeamSystem.rosteredShops`): the hours go first.
 * Whether the draft may be saved is `TeamSystem.setShops`' answer, the rule
 * the server asks, and whether it changes anything is
 * `LocationScopeSystem.sameScope`'s. Mounted while it is open, so every
 * opening starts from the record.
 */
@Component({
  selector: 'lib-member-shops-sheet',
  imports: [
    TranslocoDirective,
    UiButton,
    UiForegroundStyleDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiModalSheet,
    UiNotice,
    UiSheetActionBar,
    UiSheetHeadline,
    UiStack,
    UiSwitch,
    UiTextDirective,
  ],
  templateUrl: './member-shops-sheet.html',
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `team-page`-prefixed.
  encapsulation: ViewEncapsulation.None,
})
export class MemberShopsSheet implements OnInit {
  protected readonly store = inject(TeamMemberStore);
  private readonly wording = inject(TeamWording);
  private readonly content = inject(CatalogContentService);

  /** The record the sheet edits. */
  readonly uiBarber = input.required<Barber>();
  /** The shop's today: a roster's versions are still in force from it on. */
  readonly uiToday = input<LocalDate | null>(null);
  /** The sheet is leaving: its close animation runs. */
  readonly uiClosing = input(false);
  /** ✕, Escape, the scrim — or a save that landed. */
  readonly dismissed = output<void>();
  /** The close animation ended. */
  readonly closeFinished = output<void>();

  /** The catalogue's shops, in its own order. */
  private readonly shops = this.content.locations;
  /** «Всички салони», as drafted. */
  protected readonly everyShop = signal(true);
  /** The shops ticked, as drafted — read while «Всички салони» is off. */
  private readonly picked = signal<readonly LocationId[]>([]);

  /** The shops the roster still has hours at: their ticks are held. */
  private readonly rostered = computed<readonly LocationId[]>(() => {
    const today = this.uiToday();
    return today === null
      ? []
      : TeamSystem.rosteredShops(this.store.roster(), today);
  });

  /**
   * What «Запази» would send: `[]` for every shop, else the ticked shops in
   * the catalogue's order — `null` while none is ticked, which is no answer.
   */
  private readonly drafted = computed<readonly LocationId[] | null>(() => {
    if (this.everyShop()) return [];
    const picked = this.picked();
    const ticked = this.shops()
      .map((shop) => shop.id)
      .filter((locationId) => picked.includes(locationId));
    return ticked.length === 0 ? null : ticked;
  });

  /** «Всички салони» is off and no shop is ticked yet. */
  protected readonly noneTicked = computed(() => this.drafted() === null);

  /** The record would take the draft, and it changes where they work. */
  protected readonly canSave = computed(() => {
    const drafted = this.drafted();
    const today = this.uiToday();
    if (drafted === null || today === null) return false;
    const barber = this.uiBarber();
    const next = TeamSystem.setShops(
      barber,
      drafted,
      {
        listedShops: this.shops(),
        schedule: this.store.roster(),
        today,
      },
      null,
    );
    return (
      next.ok &&
      !LocationScopeSystem.sameScope(next.value.locationIds, barber.locationIds)
    );
  });

  protected readonly rows = computed<readonly ShopRowVm[]>(() =>
    shopRows({
      shops: this.shops(),
      picked: this.picked(),
      rostered: this.rostered(),
      locale: this.wording.locale(),
    }),
  );

  /** Why the save was refused, in the catalogue's words. */
  protected readonly refusal = computed(() => {
    const error = this.store.refusal();
    return error === null ? null : this.wording.refusalOf(error);
  });

  /**
   * The record as it stands when the sheet opens: read once. A record that
   * works everywhere starts with every shop ticked, so switching «Всички
   * салони» off and taking one tick away is the whole edit.
   */
  ngOnInit(): void {
    const barber = untracked(this.uiBarber);
    const everywhere = LocationScopeSystem.homeOf(barber) === null;
    this.everyShop.set(everywhere);
    this.picked.set(
      everywhere
        ? untracked(this.shops).map((shop) => shop.id)
        : barber.locationIds,
    );
  }

  /** A shop's tick, turned — unless the roster's hours hold it. */
  protected toggle(row: ShopRowVm): void {
    if (row.held || this.store.pending()) return;
    this.picked.update((picked) =>
      picked.includes(row.locationId)
        ? picked.filter((locationId) => locationId !== row.locationId)
        : [...picked, row.locationId],
    );
  }

  protected async save(): Promise<void> {
    const drafted = this.drafted();
    if (drafted === null || !this.canSave() || this.store.pending()) return;
    if (await this.store.saveShops(drafted)) this.dismissed.emit();
  }
}
