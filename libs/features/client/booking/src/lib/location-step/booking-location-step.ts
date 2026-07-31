import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { LocationId } from '@creativo/application/catalog';
import {
  CatalogContentService,
  CatalogPresenter,
} from '@creativo/features/shared/catalog';
import { ThemeService } from '@creativo/features/shared/shell';
import { UiButton, UiIcon, UiMap, type UiMapPin } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UI_DETENT_FRACTION,
  type UiDetent,
  UiDetentSheet,
  UiListGroup,
  UiListRow,
  UiPageActionBar,
} from '@creativo/ui/patterns';
import { BookingFlowStore } from '../booking-flow.store';

/** One shop as the sheet lists it. `id` is `null` for the "any shop" row. */
interface ShopRowVm {
  readonly key: string;
  readonly id: LocationId | null;
  readonly name: string;
  readonly detail: string;
  readonly selected: boolean;
}

/** The row that means "don't filter by shop". */
const ANY_SHOP_KEY = 'any';

/**
 * Step 1 — where.
 *
 * ### Why the map fills the screen and the list rides over it
 * "Which of these places?" is a spatial question, so it gets a spatial answer.
 * Apple's own pattern for this — Maps, Find My, the Store — is a full-bleed map
 * with the list on a sheet that drags between detents: pull it up to read, push
 * it down to look. There is deliberately **no map/list mode switch**, because
 * the two are not modes; they are the same question at two zoom levels, and the
 * sheet's height is how the user says which one they are currently thinking
 * with. A segmented control would make them pick a tool before answering.
 *
 * The map and the list are also the same selection: tapping a pin highlights
 * its row, tapping a row flies the camera. Neither is the primary — which is
 * why the map failing (no WebGL, a blocked worker) costs nothing here. The
 * list is fully usable on its own.
 *
 * ### Why this step is FIRST, and optional
 * First because it changes everything after it: which barbers exist, which
 * services are offered, which hours apply. Optional because "any shop" is a
 * real answer — someone optimising for the soonest appointment rather than the
 * nearest chair should not be made to pick, and with barbers whose weeks span
 * both shops, not picking genuinely widens what is on offer.
 *
 * It is offered as a first-class **row**, not a "Skip" link: a row that says
 * *Any shop — wherever is soonest* names what will happen. "Skip" only names
 * what you are avoiding, and makes an ordinary choice feel like a shortcut.
 */
@Component({
  selector: 'lib-booking-location-step',
  imports: [
    TranslocoDirective,
    UiButton,
    UiDetentSheet,
    UiForegroundStyleDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiMap,
    UiPageActionBar,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './booking-location-step.html',
  styleUrl: './booking-location-step.css',
  host: { 'data-testid': 'booking-location-step' },
})
export class BookingLocationStep {
  private readonly transloco = inject(TranslocoService);
  private readonly theme = inject(ThemeService);

  protected readonly catalog = inject(CatalogContentService);
  protected readonly content = inject(CatalogPresenter);
  protected readonly store = inject(BookingFlowStore);

  /**
   * Opens at `medium` — the working height. Tall enough to show both shops and
   * the "any shop" row without hiding the map that explains where they are.
   *
   * No `small` peek here: the action bar occupies the pane's bottom edge, so a
   * 20% sheet would be almost entirely behind it — a detent that shows nothing
   * is a detent that wastes a drag. `medium` already leaves half the map
   * visible, which is what the peek was for.
   */
  protected readonly detent = signal<UiDetent>('medium');
  protected readonly detents: readonly UiDetent[] = ['medium', 'large'];

  protected readonly colorScheme = computed(() => this.theme.theme());

  /**
   * How much of the map the sheet is covering, so the camera frames the pins
   * in the part that is actually visible rather than politely centring them
   * behind the list.
   */
  /**
   * The toolbar floats OVER the map (scrim chrome), so the camera has to keep
   * pins out from under it — `--control-size-large`, the bar's own height.
   */
  protected readonly toolbarInset = 52;

  protected readonly mapInset = computed(
    // eslint-disable-next-line security/detect-object-injection -- closed union.
    () => UI_DETENT_FRACTION[this.detent()],
  );

  protected readonly pins = computed<readonly UiMapPin[]>(() =>
    this.catalog.locations().map((shop) => ({
      id: shop.id.value,
      lat: shop.geo.lat,
      lng: shop.geo.lng,
      label: this.content.text({ en: shop.name.en, bg: shop.name.bg }),
    })),
  );

  /** Which pin is filled. `null` under "any shop" — nothing is singled out. */
  protected readonly selectedPinId = computed(
    () => this.store.locationId()?.value ?? null,
  );

  protected readonly rows = computed<readonly ShopRowVm[]>(() => {
    const chosen = this.store.locationId();

    const any: ShopRowVm = {
      key: ANY_SHOP_KEY,
      id: null,
      name: this.transloco.translate('booking.location.any.title'),
      detail: this.transloco.translate('booking.location.any.detail'),
      selected: chosen === null,
    };

    return [
      any,
      ...this.catalog.locations().map((shop) => ({
        key: shop.id.value,
        id: shop.id,
        name: this.content.text({ en: shop.name.en, bg: shop.name.bg }),
        detail: this.content.text({
          en: shop.address.en,
          bg: shop.address.bg,
        }),
        selected: chosen?.equals(shop.id) ?? false,
      })),
    ];
  });

  /** What the CTA says — naming the outcome, not the mechanism. */
  protected readonly continueLabel = computed(() =>
    this.store.locationId() === null
      ? this.transloco.translate('booking.location.continueAny')
      : this.transloco.translate('booking.continue'),
  );

  protected select(row: ShopRowVm): void {
    this.store.selectLocation(row.id);
    // Picking a specific shop is a request to SEE it: drop the sheet to the
    // shorter detent so the camera flight is actually visible. Choosing "any
    // shop" has nothing to look at, so the sheet stays where it is.
    if (row.id !== null) this.detent.set('medium');
  }

  /** A pin tap selects its row — the map and the list are one selection. */
  protected selectPin(pinId: string): void {
    const shop = this.catalog
      .locations()
      .find((candidate) => candidate.id.value === pinId);
    if (!shop) return;
    this.store.selectLocation(shop.id);
    this.detent.set('medium');
  }
}
