import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { CursorService, CursorTargetDirective } from '@creativo/shared/cursor';
import { UiButton } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import {
  ModalSheetComponent,
  type ModalSheetScrollEvent,
} from '../../../shared/modal-sheet/modal-sheet.component';
import { ShowcaseGalleryComponent } from '../../../shared/showcase-gallery/showcase-gallery.component';

const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const STATUS_REFRESH_MS = 60_000;

/** Index convention matches `Date.getDay()` — 0 is Sunday, 6 is Saturday. */
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
/** Display order for the week list — starts Monday, ends Sunday. */
const WEEK_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

interface DayHours {
  readonly open: string;
  readonly close: string;
}

type WeekSchedule = readonly [
  DayHours | null,
  DayHours | null,
  DayHours | null,
  DayHours | null,
  DayHours | null,
  DayHours | null,
  DayHours | null,
];

interface LocationItem {
  readonly nameKey: string;
  readonly addressKey: string;
  readonly phoneKey?: string;
  readonly schedule: WeekSchedule;
  readonly gallery: readonly string[];
  readonly lat: number;
  readonly lng: number;
}

interface LocationStatus {
  readonly isOpen: boolean;
  readonly kind: 'closesAt' | 'closesSoon' | 'opensAt' | 'opensOn';
  readonly time: string;
  readonly dayIndex: number;
}

/** Below this many minutes-to-close, the status flips to the "closing soon" warning — mirrors Google's business panel convention. */
const CLOSES_SOON_THRESHOLD_MINUTES = 60;

const CENTER_SCHEDULE: WeekSchedule = [
  null,
  { open: '09:00', close: '20:00' },
  { open: '09:00', close: '20:00' },
  { open: '09:00', close: '20:00' },
  { open: '09:00', close: '20:00' },
  { open: '09:00', close: '21:00' },
  { open: '10:00', close: '18:00' },
];

const MLADOST_SCHEDULE: WeekSchedule = [
  null,
  null,
  { open: '10:00', close: '19:00' },
  { open: '10:00', close: '19:00' },
  { open: '10:00', close: '19:00' },
  { open: '10:00', close: '19:00' },
  { open: '09:00', close: '16:00' },
];

@Component({
  selector: 'cr-locations',
  imports: [
    CursorTargetDirective,
    ModalSheetComponent,
    ShowcaseGalleryComponent,
    TranslocoDirective,
    UiButton,
    UiTextDirective,
  ],
  templateUrl: './locations.component.html',
  styleUrl: './locations.component.css',
  host: {
    'data-testid': 'landing-locations',
  },
})
export class LocationsComponent implements AfterViewInit {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cursorService = inject(CursorService);
  private readonly transloco = inject(TranslocoService);

  private map: MapLibreMap | undefined;
  private markerElements: HTMLElement[] = [];
  private sheetMap: MapLibreMap | undefined;
  private sheetMarker: MapLibreMarker | undefined;
  private closeTimer: number | undefined;
  private indicatorElements: HTMLElement[] = [];
  // `ngAfterViewInit` is async (it awaits maplibre-gl's dynamic import, then
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

  protected readonly locations: readonly LocationItem[] = [
    {
      nameKey: 'marketing.locations.center.name',
      addressKey: 'marketing.locations.center.address',
      phoneKey: 'marketing.locations.center.phone',
      schedule: CENTER_SCHEDULE,
      gallery: [
        '/work/scissors-trim.jpg',
        '/work/modern-cut.jpg',
        '/work/finishing-touch.jpg',
      ],
      lat: 42.4271,
      lng: 25.6366,
    },
    {
      nameKey: 'marketing.locations.mladost.name',
      addressKey: 'marketing.locations.mladost.address',
      phoneKey: 'marketing.locations.mladost.phone',
      schedule: MLADOST_SCHEDULE,
      gallery: [
        '/work/fade-styling.jpg',
        '/work/classic-clippers.jpg',
        '/work/beard-shave.jpg',
      ],
      lat: 42.46,
      lng: 25.685,
    },
  ];

  protected readonly activeIndex = signal(0);
  protected readonly sheetOpen = signal(false);
  protected readonly sheetClosing = signal(false);
  protected readonly sheetHeaderCondensed = signal(false);
  protected readonly sheetToolbarVisible = signal(false);
  protected readonly now = signal(new Date());
  protected readonly todayIndex = computed(() => this.now().getDay());
  protected readonly activeLocation = computed(
    () => this.locations[this.activeIndex()] ?? this.locations[0],
  );

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      if (isPlatformBrowser(this.platformId) && this.closeTimer !== undefined) {
        window.clearTimeout(this.closeTimer);
      }
    });

    if (isPlatformBrowser(this.platformId)) {
      const timer = window.setInterval(
        () => this.now.set(new Date()),
        STATUS_REFRESH_MS,
      );
      this.destroyRef.onDestroy(() => window.clearInterval(timer));
    }
  }

  async ngAfterViewInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const host = this.elementRef.nativeElement;

    // maplibre-gl ships a UMD bundle, not a real ESM module (it builds its
    // exports object dynamically inside a factory function, so esbuild can't
    // statically detect named exports off it) — the dynamic import()'s named
    // properties (e.g. `.Map`) come back undefined; only `.default` (the
    // whole UMD `module.exports` object) is populated. Confirmed live: using
    // named properties directly threw "maplibregl.Map is not a constructor".
    const { default: maplibregl } = await import('maplibre-gl');
    if (this.destroyed) return;

    const mapContainer = host.querySelector<HTMLElement>(
      '[data-locations-map]',
    );
    if (mapContainer) {
      try {
        const map = new maplibregl.Map({
          container: mapContainer,
          style: MAP_STYLE_URL,
          bounds: this.computeBounds(),
          fitBoundsOptions: { padding: 56, duration: 0 },
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
        this.map = map;
        map.on('error', (event) =>
          console.error('[cr-locations] map error:', event.error),
        );

        map.on('load', () => {
          if (this.destroyed) return;
          this.locations.forEach((location, index) => {
            const element = this.createMarkerElement(index);
            new maplibregl.Marker({ element, anchor: 'bottom' })
              .setLngLat([location.lng, location.lat])
              .addTo(map);
            element.addEventListener('click', () => this.openLocation(index));
            this.markerElements.push(element);
          });
          this.updateActiveMarker();

          const indicatorsContainer = host.querySelector<HTMLElement>(
            '[data-locations-map-indicators]',
          );
          if (indicatorsContainer) {
            this.setupOffscreenIndicators(map, indicatorsContainer);
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

    // The sheet's own small map. Its container sits inside <cr-modal-sheet>,
    // which hides its content via `visibility: hidden` (not `display: none`)
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
          style: MAP_STYLE_URL,
          center: [location.lng, location.lat],
          zoom: 14.5,
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
        this.sheetMap = sheetMap;
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
            .setLngLat([location.lng, location.lat])
            .addTo(sheetMap);
        });

        this.destroyRef.onDestroy(() => this.sheetMap?.remove());
      } catch (error) {
        console.error('[cr-locations] sheet map failed to initialize:', error);
      }
    }
  }

  protected directionsUrl(location: LocationItem): string {
    return `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
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
    this.sheetHeaderCondensed.set(false);
    this.sheetToolbarVisible.set(false);

    const location = this.locations[index];
    if (!location) return;

    const reducedMotion = isPlatformBrowser(this.platformId)
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    const center: [number, number] = [location.lng, location.lat];

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

    const location = this.locations[index];
    if (!location || !this.map) return;

    const reducedMotion = isPlatformBrowser(this.platformId)
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    const center: [number, number] = [location.lng, location.lat];

    if (reducedMotion) {
      this.map.jumpTo({ center, zoom: 13 });
    } else {
      this.map.flyTo({ center, zoom: 13, duration: 900 });
    }
  }

  protected closeLocation(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.sheetOpen() || this.sheetClosing()) return;

    this.sheetClosing.set(true);
    if (this.closeTimer !== undefined) window.clearTimeout(this.closeTimer);
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    this.closeTimer = window.setTimeout(
      () => this.finishClosing(),
      reducedMotion ? 0 : 380,
    );
  }

  /**
   * Whether `location` is open right now, plus what to say about it — "Closes
   * at 20:00" while open, "Opens at 10:00" if today's hours haven't started
   * yet, or "Opens Tuesday at 10:00" scanning forward when today's closed
   * (or already past closing).
   */
  protected statusFor(location: LocationItem): LocationStatus {
    const now = this.now();
    const day = now.getDay();
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const today = location.schedule[day];

    if (today) {
      const openMinutes = this.toMinutes(today.open);
      const closeMinutes = this.toMinutes(today.close);
      if (minutesNow >= openMinutes && minutesNow < closeMinutes) {
        const closingSoon =
          closeMinutes - minutesNow <= CLOSES_SOON_THRESHOLD_MINUTES;
        return {
          isOpen: true,
          kind: closingSoon ? 'closesSoon' : 'closesAt',
          time: today.close,
          dayIndex: day,
        };
      }
      if (minutesNow < openMinutes) {
        return {
          isOpen: false,
          kind: 'opensAt',
          time: today.open,
          dayIndex: day,
        };
      }
    }

    for (let offset = 1; offset <= 7; offset++) {
      const dayIndex = (day + offset) % 7;
      const hours = location.schedule[dayIndex];
      if (hours) {
        return { isOpen: false, kind: 'opensOn', time: hours.open, dayIndex };
      }
    }

    return { isOpen: false, kind: 'opensAt', time: '', dayIndex: day };
  }

  protected phoneHref(phone: string): string {
    return `tel:${phone.replace(/[^+\d]/g, '')}`;
  }

  protected onSheetScroll({ scroller }: ModalSheetScrollEvent): void {
    const sheet = scroller.closest<HTMLElement>('.modal-sheet');
    const title = scroller.querySelector<HTMLElement>(
      '.location-sheet__profile h2',
    );
    const toolbar = sheet?.querySelector<HTMLElement>('.modal-sheet__toolbar');
    if (title && toolbar) {
      const condensed =
        title.getBoundingClientRect().bottom <=
        toolbar.getBoundingClientRect().bottom + 4;
      if (condensed !== this.sheetHeaderCondensed()) {
        this.sheetHeaderCondensed.set(condensed);
      }
    }

    const heroCta = scroller.querySelector<HTMLElement>(
      '.location-sheet__book',
    );
    if (heroCta && toolbar) {
      const toolbarVisible =
        heroCta.getBoundingClientRect().bottom <=
        toolbar.getBoundingClientRect().bottom;
      if (toolbarVisible !== this.sheetToolbarVisible()) {
        this.sheetToolbarVisible.set(toolbarVisible);
      }
    }
  }

  private toMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return (hours ?? 0) * 60 + (minutes ?? 0);
  }

  private finishClosing(): void {
    this.closeTimer = undefined;
    this.sheetOpen.set(false);
    this.sheetClosing.set(false);
    this.sheetHeaderCondensed.set(false);
    this.sheetToolbarVisible.set(false);
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
    const lngs = this.locations.map((location) => location.lng);
    const lats = this.locations.map((location) => location.lat);
    return [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];
  }

  /**
   * Builds a map pin: a rounded head carrying a shop icon plus a pointed
   * tail so the marker's `anchor: 'bottom'` lands exactly on the
   * coordinate. The head is wired into the shared cursor system so
   * hovering it morphs the custom cursor into a primary black/white fill,
   * matching the rest of the site's buttons — this element is created
   * imperatively for MapLibre, outside Angular's view tree, so it can't
   * pick up `crCursorTarget` declaratively and instead replicates
   * `useCursorTarget()`'s pointerenter/pointerleave wiring by hand.
   */
  private createMarkerElement(_index: number): HTMLElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'locations-map__pin';

    const head = document.createElement('span');
    head.className = 'locations-map__pin-head';
    head.setAttribute('data-cr-cursor-style', 'fill');

    const icon = document.createElement('span');
    icon.className = 'locations-map__pin-icon material-symbols-rounded';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'storefront';
    head.appendChild(icon);

    const tail = document.createElement('span');
    tail.className = 'locations-map__pin-tail';

    element.addEventListener('pointerenter', () => {
      if (!this.cursorService.isEnabled()) return;
      head.setAttribute('data-cr-cursor-hover', '');
      this.cursorService.activeTarget.set({ element: head, style: 'fill' });
    });
    element.addEventListener('pointerleave', () => {
      head.removeAttribute('data-cr-cursor-hover');
      if (this.cursorService.activeTarget()?.element === head) {
        this.cursorService.activeTarget.set(null);
      }
    });

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
  ): void {
    const EDGE_PADDING = 34;
    const BOTTOM_EDGE_PADDING = 56;

    const indicators = this.locations.map((location, index) => {
      const indicator = document.createElement('button');
      indicator.type = 'button';
      indicator.className = 'locations-map__indicator';
      indicator.setAttribute(
        'aria-label',
        this.transloco.translate('marketing.locations.showOnMap', {
          location: this.transloco.translate(location.nameKey),
        }),
      );

      const arrow = document.createElement('span');
      arrow.className =
        'locations-map__indicator-arrow material-symbols-rounded';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = 'arrow_upward';
      indicator.appendChild(arrow);

      indicator.addEventListener('click', () => this.centerOnLocation(index));
      indicator.addEventListener('pointerenter', () => {
        if (!this.cursorService.isEnabled()) return;
        this.cursorService.activeTarget.set({
          element: indicator,
          style: 'scale',
        });
      });
      indicator.addEventListener('pointerleave', () => {
        if (this.cursorService.activeTarget()?.element === indicator) {
          this.cursorService.activeTarget.set(null);
        }
      });
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
        const point = map.project([location.lng, location.lat]);
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
        arrow.style.transform = `rotate(${angleDeg}deg)`;
      }
    };

    update();
    map.on('move', update);
    this.destroyRef.onDestroy(() => map.off('move', update));
  }
}
