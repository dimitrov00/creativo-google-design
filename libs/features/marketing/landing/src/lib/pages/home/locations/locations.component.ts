import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  MapLibreLoader,
  UI_ICON_OVERRIDES,
  UiButton,
  UiIcon,
  UiIconRegistry,
  UiModalSheet,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiMaterialDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiSectionHeader,
  UiSheetActionBar,
  UiStatusIndicator,
} from '@creativo/ui/patterns';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { LocalDate, TimeZone, type UtcEpochMs } from '@core/primitives';
import { ShopOpening } from '@core/components';
import { RosterSystem, ZonedTimeSystem } from '@core/systems';
import { CLOCK_PORTS } from '@creativo/infrastructure/firebase-app';
import { ClockClosing, formatClock } from '@creativo/ui/wall-clock';
import { ThemeService } from '@creativo/features/shared/shell';
import {
  CatalogWording,
  ShowcaseGalleryComponent,
} from '@creativo/features/shared/catalog';
import { shopsHeadingKey } from './locations.presenter';
import type { ShopVm } from './locations.vm';

/** Theme-matched basemap styles (OpenFreeMap hosts both). */
const MAP_STYLE_URLS = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;
const STATUS_REFRESH_MS = 60_000;

/** Index convention: 0 is Sunday, 6 is Saturday — the ISO weekday mod 7. */
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
/** Display order for the week list — starts Monday, ends Sunday. */
const WEEK_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * What a shop's status line says: `RosterSystem.shopOpeningAt`'s tag
 * (`ShopOpening`, the field `shopOpening` — «Closes at 20:00», the
 * closing-soon warning, «Opens at 10:00», «Opens Tuesday at 10:00») and the
 * words it is printed with.
 */
interface ShopOpeningLine {
  readonly isOpen: boolean;
  readonly shopOpening: ShopOpening;
  readonly time: string;
  readonly dayIndex: number;
}

@Component({
  selector: 'cr-locations',
  imports: [
    ShowcaseGalleryComponent,
    TranslocoDirective,
    UiButton,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiMaterialDirective,
    UiModalSheet,
    UiSectionHeader,
    UiSheetActionBar,
    UiStack,
    UiStatusIndicator,
    UiTextDirective,
    UiVisuallyHiddenDirective,
    UiWeightDirective,
  ],
  templateUrl: './locations.component.html',
  styleUrl: './locations.component.css',
  // Unscoped like ui-modal-sheet (see its component note): the sheet's
  // shared-inset override must reach INTO ui-sheet's (None-encapsulated)
  // surface, and emulated scoping stamps `_ngcontent` on every selector
  // part — the surface never carries it, so the piercing rule would
  // silently match nothing. All selectors in the stylesheet stay
  // `locations`/`location-`-prefixed.
  encapsulation: ViewEncapsulation.None,
  host: {
    'data-testid': 'landing-locations',
  },
})
export class LocationsComponent implements AfterViewInit {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly transloco = inject(TranslocoService);
  private readonly theme = inject(ThemeService);
  private readonly clock = inject(CLOCK_PORTS);
  // The imperative MapLibre DOM below can't host <ui-icon>, but its glyphs
  // are still built by the SAME registry (plus any provideUiIcons
  // overrides), so a remap of 'location.pin' / 'location.recenter' — in
  // code or from the backend's manifest — reaches the map without touching
  // this file.
  private readonly icons = inject(UiIconRegistry);
  private readonly iconOverrides = inject(UI_ICON_OVERRIDES, {
    optional: true,
  });
  // The DS's one way to MapLibre — the library AND its stylesheet, which
  // left the global bundle (2026-09-26) and now arrives with the map.
  private readonly mapLibre = inject(MapLibreLoader);
  /** The catalogue's localized pairs, in the session's language. */
  protected readonly words = inject(CatalogWording);

  /**
   * The ACTIVE shops, in their `sortOrder` — the stored `locations`
   * (`shopVm`), never an authored list. The page draws this section only
   * once the read has answered with a shop, so the map is built on a list
   * that is there: its pins are placed once, when the map loads, while the
   * rows and the sheet follow the list as it changes.
   */
  readonly shops = input.required<readonly ShopVm[]>();
  /** «Лесно ще ни намериш.» for one shop, «Нашите локации.» for more. */
  protected readonly headingKey = computed(() => shopsHeadingKey(this.shops()));

  private map: MapLibreMap | undefined;
  private markerElements: HTMLElement[] = [];
  private sheetMap: MapLibreMap | undefined;
  private sheetMarker: MapLibreMarker | undefined;
  private indicatorElements: HTMLElement[] = [];
  // `ngAfterViewInit` is async (it awaits MapLibre's lazy load, then
  // waits on the map's own async 'load' event) — on a slow connection, or if
  // Safari reloads a backgrounded tab, the component can be destroyed before
  // that work resumes. Any DestroyRef.onDestroy() call made after the fact
  // throws NG0911 (uncaught, from inside MapLibre's render loop / Angular's
  // CD cycle) — confirmed live to also stall unrelated reveal animations
  // elsewhere on the page. This flag guards every post-await/async
  // continuation so they bail out instead of touching an already-torn-down
  // DestroyRef.
  private destroyed = false;

  protected readonly weekdayKeys = WEEKDAY_KEYS;
  protected readonly weekOrder = WEEK_DISPLAY_ORDER;
  /** The dictionary, for the template's status lines (never bare literals). */
  protected readonly ShopOpening = ShopOpening;

  protected readonly activeIndex = signal(0);
  protected readonly sheetOpen = signal(false);
  protected readonly sheetClosing = signal(false);
  /** The clock's instant, re-read every minute — the status lines' "now". */
  private readonly now = signal<UtcEpochMs>(this.clock.nowUtcMs());
  /**
   * The open sheet's bold row: today on the ACTIVE shop's own calendar (the
   * UTC calendar while the list is somehow empty).
   */
  protected readonly todayIndex = computed(
    () => this.wallAt(this.activeLocation()?.timeZone ?? TimeZone.UTC).day,
  );
  protected readonly activeLocation = computed<ShopVm | undefined>(
    () => this.shops()[this.activeIndex()] ?? this.shops()[0],
  );

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });

    // Basemap follows the app theme — setStyle swaps tiles in place (DOM
    // markers and indicators survive; they're positioned by projection, not
    // by style layers).
    effect(() => {
      const style = MAP_STYLE_URLS[this.theme.theme()];
      this.map?.setStyle(style);
      this.sheetMap?.setStyle(style);
    });

    if (isPlatformBrowser(this.platformId)) {
      const timer = window.setInterval(
        () => this.now.set(this.clock.nowUtcMs()),
        STATUS_REFRESH_MS,
      );
      this.destroyRef.onDestroy(() => window.clearInterval(timer));
    }
  }

  async ngAfterViewInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const host = this.elementRef.nativeElement;

    // The library and its stylesheet, lazily and once for every map in the
    // app, already pointed at its worker (see
    // `MapLibreLoader`). Chunks that cannot be fetched (offline, a deploy
    // that replaced them) fail as soft as no WebGL does below: logged, both
    // maps left empty, the location list untouched.
    const maplibregl = await this.mapLibre.load().catch((error: unknown) => {
      console.error('[cr-locations] map failed to load:', error);
      return null;
    });
    if (!maplibregl || this.destroyed) return;

    const mapContainer = host.querySelector<HTMLElement>(
      '[data-locations-map]',
    );
    const shops = this.shops();
    const [first] = shops;
    if (mapContainer && first) {
      try {
        // Several shops frame their bounds; one shop has no bounds to
        // frame (a zero-area box fits at the deepest zoom), so the map
        // centres on its pin instead.
        const view =
          shops.length > 1
            ? {
                bounds: this.computeBounds(),
                fitBoundsOptions: { padding: 56, duration: 0 },
              }
            : {
                center: [first.longitude, first.latitude] as [number, number],
                zoom: 13,
              };
        const map = new maplibregl.Map({
          container: mapContainer,
          style: MAP_STYLE_URLS[this.theme.theme()],
          ...view,
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
        this.map = map;
        this.collapseAttribution(map, mapContainer);
        map.on('error', (event) =>
          console.error('[cr-locations] map error:', event.error),
        );

        map.on('load', () => {
          if (this.destroyed) return;
          shops.forEach((location, index) => {
            const element = this.createMarkerElement(index);
            new maplibregl.Marker({ element, anchor: 'bottom' })
              .setLngLat([location.longitude, location.latitude])
              .addTo(map);
            element.addEventListener('click', () => this.openLocation(index));
            this.markerElements.push(element);
          });
          this.updateActiveMarker();

          const indicatorsContainer = host.querySelector<HTMLElement>(
            '[data-locations-map-indicators]',
          );
          if (indicatorsContainer) {
            this.setupOffscreenIndicators(map, indicatorsContainer, shops);
          }
        });

        this.destroyRef.onDestroy(() => this.map?.remove());
      } catch (error) {
        // No WebGL available (older browser, locked-down environment, etc.)
        // — the location list remains fully usable without the map. Logged
        // (not swallowed) since this can also mask a real, fixable bug,
        // e.g. a CSP blocking the worker MapLibre needs — see
        // csp-baseline.md.
        console.error('[cr-locations] map failed to initialize:', error);
      }
    }

    // The sheet's own small map. Its container sits inside <ui-sheet>, which
    // this component hides via `visibility: hidden` (not `display: none`)
    // while closed, so the container already has real, stable layout
    // dimensions here regardless of whether the sheet is currently open —
    // no need to defer this until the sheet's first open.
    const sheetMapContainer = host.querySelector<HTMLElement>(
      '[data-location-sheet-map]',
    );
    const initialLocation = this.activeLocation();
    if (sheetMapContainer && initialLocation) {
      const location = initialLocation;
      try {
        const sheetMap = new maplibregl.Map({
          container: sheetMapContainer,
          style: MAP_STYLE_URLS[this.theme.theme()],
          center: [location.longitude, location.latitude],
          zoom: 14.5,
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
        this.sheetMap = sheetMap;
        this.collapseAttribution(sheetMap, sheetMapContainer);
        sheetMap.on('error', (event) =>
          console.error('[cr-locations] sheet map error:', event.error),
        );
        sheetMap.on('load', () => {
          if (this.destroyed) return;
          const element = this.createMarkerElement(this.activeIndex());
          element.setAttribute('data-active', '');
          this.sheetMarker = new maplibregl.Marker({
            element,
            anchor: 'bottom',
          })
            .setLngLat([location.longitude, location.latitude])
            .addTo(sheetMap);
        });

        this.destroyRef.onDestroy(() => this.sheetMap?.remove());
      } catch (error) {
        console.error('[cr-locations] sheet map failed to initialize:', error);
      }
    }
  }

  /**
   * MapLibre's compact attribution control mounts EXPANDED, so every map
   * opened with the full "OpenFreeMap © OpenMapTiles · Data from
   * OpenStreetMap" strip lying across its bottom edge. Collapsing it to
   * the (i) puck is exactly what MapLibre itself does on drag
   * (`_updateCompactMinimize`): drop the `maplibregl-compact-show` class.
   *
   * It can't be done at construction time: the control mounts EMPTY
   * (`maplibregl-attrib-empty`, no style loaded yet) and only stamps the
   * expanded classes once the first `styledata` fills the credits in — so
   * this waits for the class to appear, collapses once, and then detaches.
   * Detaching matters: a theme swap re-runs `setStyle`, and re-collapsing
   * behind a user who deliberately opened the credits would be rude.
   * Nothing is lost either way — the puck still expands on tap.
   */
  private collapseAttribution(map: MapLibreMap, container: HTMLElement): void {
    const collapse = (): void => {
      const attribution = container.querySelector(
        '.maplibregl-ctrl-attrib.maplibregl-compact-show',
      );
      if (!attribution) return;
      attribution.classList.remove('maplibregl-compact-show');
      map.off('styledata', collapse);
    };
    // Listener teardown rides `map.remove()` (already registered by the
    // caller) for the case where the style never resolves.
    map.on('styledata', collapse);
    collapse();
  }

  protected onCardKeydown(index: number, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.openLocation(index);
  }

  protected openLocation(index: number): void {
    this.activeIndex.set(index);
    this.updateActiveMarker();
    this.sheetOpen.set(true);
    this.sheetClosing.set(false);
    // Scroller reset on open is ui-modal-sheet's own contract now.

    const location = this.shops()[index];
    if (!location) return;

    const reducedMotion = isPlatformBrowser(this.platformId)
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    const center: [number, number] = [location.longitude, location.latitude];

    if (this.map) {
      if (reducedMotion) {
        this.map.jumpTo({ center, zoom: 13 });
      } else {
        this.map.flyTo({ center, zoom: 13, duration: 900 });
      }
    }

    if (this.sheetMap) {
      this.sheetMap.jumpTo({ center, zoom: 14.5 });
      this.sheetMarker?.setLngLat(center);
    }
  }

  /**
   * Pans/zooms the main map to a location and marks it active, without
   * opening the detail sheet — used by the off-screen arrow indicators,
   * which are about bringing a hidden pin back into view, not drilling into
   * its details (that's what clicking the pin itself is for).
   */
  protected centerOnLocation(index: number): void {
    this.activeIndex.set(index);
    this.updateActiveMarker();

    const location = this.shops()[index];
    if (!location || !this.map) return;

    const reducedMotion = isPlatformBrowser(this.platformId)
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    const center: [number, number] = [location.longitude, location.latitude];

    if (reducedMotion) {
      this.map.jumpTo({ center, zoom: 13 });
    } else {
      this.map.flyTo({ center, zoom: 13, duration: 900 });
    }
  }

  protected closeLocation(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.sheetOpen() || this.sheetClosing()) return;
    // No timer: close completion arrives as the shell's `closeFinished`
    // (its own exit-transition listener), so the CSS motion tokens stay
    // the single source of truth for the exit duration.
    this.sheetClosing.set(true);
  }

  /**
   * Whether `location` is open right now, plus what to say about it — "Closes
   * at 20:00" while open, "Opens at 10:00" if today's hours haven't started
   * yet, or "Opens Tuesday at 10:00" scanning forward when today's closed
   * (or already past closing): `RosterSystem.shopOpeningAt`'s answer, read
   * on the SHOP's wall clock — the location's zone, never the visitor's
   * device (Law 7.2).
   */
  protected statusFor(location: ShopVm): ShopOpeningLine {
    const { localDate, minute } = ZonedTimeSystem.toLocal(
      this.now(),
      location.timeZone,
    );
    const opening = RosterSystem.shopOpeningAt(
      location.week,
      localDate,
      minute,
    );
    return {
      isOpen:
        opening.shopOpening === ShopOpening.ClosesAt ||
        opening.shopOpening === ShopOpening.ClosesSoon,
      shopOpening: opening.shopOpening,
      time:
        opening.atMinutes === null
          ? ''
          : formatClock(opening.atMinutes, ClockClosing.EndOfDay),
      // The `WEEKDAY_KEYS` index (Sunday = 0 — the ISO weekday mod 7).
      dayIndex: LocalDate.weekday(opening.localDate) % 7,
    };
  }

  /**
   * The shop's wall clock now, in its `timeZone`: the weekday as a
   * `WEEKDAY_KEYS` index (Sunday = 0 — the ISO weekday mod 7).
   */
  private wallAt(timeZone: TimeZone): { readonly day: number } {
    const { localDate } = ZonedTimeSystem.toLocal(this.now(), timeZone);
    return { day: LocalDate.weekday(localDate) % 7 };
  }

  /** Completes the close on the shell's exit-transition callback. */
  protected finishClosing(): void {
    this.sheetOpen.set(false);
    this.sheetClosing.set(false);
  }

  private updateActiveMarker(): void {
    const active = this.activeIndex();
    this.markerElements.forEach((element, index) => {
      element.toggleAttribute('data-active', index === active);
    });
    this.indicatorElements.forEach((element, index) => {
      element.toggleAttribute('data-active', index === active);
    });
  }

  private computeBounds(): [[number, number], [number, number]] {
    const lngs = this.shops().map((location) => location.longitude);
    const lats = this.shops().map((location) => location.latitude);
    return [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];
  }

  /**
   * Builds a map pin: a rounded head carrying a shop icon plus a pointed
   * tail so the marker's `anchor: 'bottom'` lands exactly on the
   * coordinate. Created imperatively for MapLibre, outside Angular's view
   * tree — hover feedback is plain CSS (the legacy custom-cursor wiring
   * was removed: its cursor dot never mounts in apps/web, case study §2.5).
   */
  private createMarkerElement(_index: number): HTMLElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'locations-map__pin';

    const head = document.createElement('span');
    head.className = 'locations-map__pin-head';
    // The sanctioned hover/press grammar (modifiers.css is global, so the
    // attribute alone suffices on MapLibre-created DOM). Stamped on the
    // HEAD, not the button: the ::after state layer inherits the head's
    // 50% radius (on the button it would be an unclipped square over
    // head + tail), and the press scale must not fight the inline
    // `transform` MapLibre rewrites on the button every `move` event.
    head.setAttribute('data-interactive', '');

    const icon = this.icons.createElement(
      document,
      'location.pin',
      this.iconOverrides,
    );
    if (icon) {
      icon.classList.add('locations-map__pin-icon');
      head.appendChild(icon);
    }

    const tail = document.createElement('span');
    tail.className = 'locations-map__pin-tail';

    element.append(head, tail);
    // No scope-attribute stamping needed: pin/indicator chrome lives in the
    // GLOBAL locations-map.css (imported by styles.css), because these
    // elements are MapLibre-created and never receive Angular's
    // `_ngcontent-*` attribute — see that file's header.
    return element;
  }

  /**
   * Builds one edge-hugging arrow chip per location and keeps it pinned to
   * whichever side of the map the location currently sits off through —
   * pointing back at it — so panning/zooming away doesn't just make a shop
   * silently disappear. Recomputed on every `move` since MapLibre fires
   * that continuously through pans, zooms, and flyTo/jumpTo animations
   * alike, so this stays in sync with the same events that move markers.
   */
  private setupOffscreenIndicators(
    map: MapLibreMap,
    container: HTMLElement,
    shops: readonly ShopVm[],
  ): void {
    const EDGE_PADDING = 34;
    const BOTTOM_EDGE_PADDING = 56;

    const indicators = shops.map((location, index) => {
      const indicator = document.createElement('button');
      indicator.type = 'button';
      indicator.className = 'locations-map__indicator';
      // Shared state-layer grammar; the ::after clips to the chip's 50%
      // radius. The grammar's :active press scale never applies here —
      // the inline `transform` MapLibre positioning writes wins — which
      // is the desired outcome (see locations-map.css on why transforms
      // must not be animated on these elements).
      indicator.setAttribute('data-interactive', '');
      indicator.setAttribute(
        'aria-label',
        this.transloco.translate('landing.location.showOnMap', {
          location: this.words.text(location.name),
        }),
      );

      const arrow = this.icons.createElement(
        document,
        'location.recenter',
        this.iconOverrides,
      );
      if (arrow) {
        arrow.classList.add('locations-map__indicator-arrow');
        indicator.appendChild(arrow);
      }

      indicator.addEventListener('click', () => this.centerOnLocation(index));
      container.appendChild(indicator);
      return { element: indicator, arrow, location };
    });
    this.indicatorElements = indicators.map(({ element }) => element);
    this.updateActiveMarker();

    const update = (): void => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      const centerX = width / 2;
      const centerY = height / 2;
      // Bottom gets extra clearance so the chip clears MapLibre's own
      // attribution strip instead of sitting on top of it.
      const minX = EDGE_PADDING;
      const maxX = width - EDGE_PADDING;
      const minY = EDGE_PADDING;
      const maxY = height - BOTTOM_EDGE_PADDING;

      for (const { element, arrow, location } of indicators) {
        const point = map.project([location.longitude, location.latitude]);
        const isVisible =
          point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;

        element.toggleAttribute('data-visible', !isVisible);
        if (isVisible) continue;

        const dx = point.x - centerX;
        const dy = point.y - centerY;
        // Walk the ray from the container's center toward the true
        // (off-screen) point and stop at the first padded-box edge it
        // crosses — the smallest of the four per-axis crossing fractions.
        let t = 1;
        if (dx < 0) t = Math.min(t, (minX - centerX) / dx);
        if (dx > 0) t = Math.min(t, (maxX - centerX) / dx);
        if (dy < 0) t = Math.min(t, (minY - centerY) / dy);
        if (dy > 0) t = Math.min(t, (maxY - centerY) / dy);
        t = Math.max(t, 0);

        const clampedX = centerX + dx * t;
        const clampedY = centerY + dy * t;
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;

        element.style.transform = `translate(-50%, -50%) translate(${clampedX}px, ${clampedY}px)`;
        if (arrow) arrow.style.transform = `rotate(${angleDeg}deg)`;
      }
    };

    update();
    map.on('move', update);
    this.destroyRef.onDestroy(() => map.off('move', update));
  }
}
