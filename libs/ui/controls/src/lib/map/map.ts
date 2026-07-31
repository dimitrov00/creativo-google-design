import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  ViewEncapsulation,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';

/**
 * The UMD namespace the dynamic import actually resolves to at RUNTIME.
 *
 * The published types declare named exports, but the bundle builds its exports
 * object inside a factory, so only `.default` is populated — see `initialise`.
 * Typed structurally against the one constructor this component needs from it.
 */
interface MapLibreModule {
  readonly Marker: new (options: {
    element: HTMLElement;
    anchor: 'bottom';
  }) => MapLibreMarker;
}
import { UI_ICON_OVERRIDES, resolveUiIcon } from '../icon/icon-registry';

/** One place on the map. `id` is what selection and the output are keyed by. */
export interface UiMapPin {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  /** Announced to AT on the pin's button. */
  readonly label: string;
}

export type UiMapColorScheme = 'light' | 'dark';

/** Theme-matched basemaps. OpenFreeMap hosts both, and needs no API key. */
const STYLE_URLS: Readonly<Record<UiMapColorScheme, string>> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

/** Off-screen indicator geometry — extra clearance at the bottom for the attribution strip. */
const EDGE_PADDING = 34;
const BOTTOM_EDGE_PADDING = 56;

/**
 * A map with pins — ≙ SwiftUI's `Map` with `Marker`s.
 *
 * Promoted out of the landing's locations section when `/book` needed the same
 * thing, and it carries all of that section's hard-won knowledge rather than
 * re-learning it: the UMD import shape, MapLibre's attribution that mounts
 * expanded, stacking containment for the cooperative-gesture veil, and why
 * pin transforms must never be transitioned.
 *
 * **Fails soft.** No WebGL — an old browser, a locked-down environment, a CSP
 * blocking MapLibre's worker — leaves an empty pane and logs. Every consumer
 * must therefore keep a non-map path to the same information; on `/book` that
 * is the list in the sheet, which is the primary surface anyway.
 *
 * **Selection is a two-way conversation.** `uiSelectedPinId` drives which pin
 * is filled and where the camera sits; tapping a pin emits `uiPinSelect` and
 * the owner decides. Nothing is selected implicitly.
 */
@Component({
  selector: 'ui-map',
  template: `
    <div class="ui-map__canvas" data-ui-map-canvas></div>
    <div
      class="ui-map__indicators"
      data-ui-map-indicators
      aria-hidden="true"
    ></div>
  `,
  styleUrl: './map.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and the
  // pin/indicator DOM below is created imperatively for MapLibre, so it never
  // receives Angular's `_ngcontent-*` attribute at all.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ui-map' },
})
export class UiMap {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly iconOverrides = inject(UI_ICON_OVERRIDES, {
    optional: true,
  });

  readonly uiPins = input<readonly UiMapPin[]>([]);
  readonly uiSelectedPinId = input<string | null>(null);
  readonly uiColorScheme = input<UiMapColorScheme>('light');
  /** Padding used when fitting every pin into view, in pixels. */
  readonly uiFitPadding = input(64);
  /** Zoom used when the camera moves to a selected pin. */
  readonly uiSelectedZoom = input(14);
  /**
   * Arrow chips that point at pins the current viewport has cut off, tapping
   * one brings it back. Worth it whenever the user can pan freely.
   */
  readonly uiOffscreenIndicators = input(true);
  /**
   * Require two fingers to pan (MapLibre's `cooperativeGestures`).
   *
   * Right for a map embedded in a SCROLLING page, where one-finger panning
   * would swallow the page's own scroll. Wrong for a map that fills a fixed
   * pane and is the primary thing on screen — there, two fingers is a tax on
   * the main interaction, and there is no page scroll to protect.
   */
  readonly uiCooperativeGestures = input(true);
  /**
   * How much of the map's bottom edge is covered by something else — a sheet
   * — as a fraction of its height.
   *
   * Fed into MapLibre's camera padding, so framing and every `flyTo` centre on
   * the VISIBLE part. Without it a full-bleed map under a sheet politely
   * centres its pins behind the sheet, which is the single most common way
   * this layout goes wrong.
   */
  readonly uiBottomInsetFraction = input(0);
  /**
   * Pixels of the map's TOP edge covered by something else — a toolbar
   * floating over it.
   *
   * A fixed height rather than a fraction, because chrome is a fixed height.
   * Without it a fit puts a pin exactly under the bar: measured, one landed at
   * y=52 with a 52px toolbar over it.
   */
  readonly uiTopInsetPx = input(0);

  readonly uiPinSelect = output<string>();

  private map: MapLibreMap | null = null;
  private maplibre: MapLibreModule | null = null;
  private markers = new Map<
    string,
    { marker: MapLibreMarker; element: HTMLElement }
  >();
  private indicators = new Map<
    string,
    { element: HTMLElement; arrow: HTMLElement }
  >();
  private destroyed = false;
  /** The map exists and its style has loaded — markers may be attached. */
  private readonly ready = signal(false);
  /** The camera has been framed on a real pin set at least once. */
  private fitted = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.map?.remove();
    });

    afterNextRender(() => void this.initialise());

    /**
     * Markers follow the pin set, not the constructor.
     *
     * A live catalog arrives AFTER the map is built, so a component that only
     * placed markers during `initialise` renders an empty world map and stays
     * that way. Verified: zero pins at world zoom while the catalog resolved a
     * moment later. This syncs whenever either the pins or readiness changes.
     */
    effect(() => {
      const pins = this.uiPins();
      if (!this.ready()) return;
      untracked(() => this.syncPins(pins));
    });

    /**
     * Selection drives both the fill and the camera.
     *
     * `ready()` is a dependency on purpose: a selection made before the style
     * loads would otherwise fly a map that is about to be re-framed by the
     * first pin sync, and the framing would win. Depending on readiness makes
     * the effect re-run once there is actually a map to move, which is why
     * changing the choice now moves the camera every time rather than most
     * times.
     */
    effect(() => {
      const selectedId = this.uiSelectedPinId();
      if (!this.ready()) return;
      untracked(() => {
        this.paintSelection(selectedId);
        this.moveTo(selectedId);
      });
    });

    effect(() => {
      const scheme = this.uiColorScheme();
      // eslint-disable-next-line security/detect-object-injection -- closed union.
      this.map?.setStyle(STYLE_URLS[scheme]);
    });

    /**
     * Re-frame when the sheet's coverage changes.
     *
     * The coverage is expressed EXACTLY ONCE, per camera call — as asymmetric
     * `padding` on `fitBounds` and as a vertical `offset` on `flyTo`. The
     * first pass also set it as the transform's persistent padding, which
     * double-counted it and pushed the pins above the visible strip; removing
     * the per-call padding instead went the other way, because `fitBounds`
     * computes its camera from `options.padding` alone and never consults the
     * transform. One mechanism, stated at every call site, is the only version
     * that behaves the same every time.
     */
    effect(() => {
      const fraction = this.uiBottomInsetFraction();
      if (!this.ready()) return;
      untracked(() => {
        void fraction;
        // Only the "all of them" framing depends on the coverage; a selected
        // pin is re-centred by its own flight.
        if (this.uiSelectedPinId() === null) this.frameAll(this.uiPins(), 0);
      });
    });
  }

  private async initialise(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const container = this.hostRef.nativeElement.querySelector<HTMLElement>(
      '[data-ui-map-canvas]',
    );
    if (!container) return;

    // maplibre-gl ships a UMD bundle, not a real ESM module (it builds its
    // exports object dynamically inside a factory, so esbuild cannot detect
    // named exports) — the dynamic import's named properties come back
    // undefined and only `.default` is populated. Confirmed live: using
    // `maplibregl.Map` off the named import threw "not a constructor".
    const { default: maplibregl } = await import('maplibre-gl');
    if (this.destroyed) return;
    this.maplibre = maplibregl;

    const pins = this.uiPins();

    try {
      const map = new maplibregl.Map({
        container,
        // eslint-disable-next-line security/detect-object-injection -- closed union.
        style: STYLE_URLS[this.uiColorScheme()],
        // Framed here only if the pins are already known; otherwise `syncPins`
        // frames them the moment they arrive.
        ...(pins.length > 0
          ? {
              bounds: boundsOf(pins),
              fitBoundsOptions: {
                padding: this.uiFitPadding(),
                maxZoom: 15,
                duration: 0,
              },
            }
          : { center: [0, 0] as [number, number], zoom: 1 }),
        attributionControl: { compact: true },
        cooperativeGestures: this.uiCooperativeGestures(),
      });
      this.map = map;
      collapseAttribution(map, container);
      map.on('error', (event) =>
        console.error('[ui-map] map error:', event.error),
      );

      // A map in a flexible pane is routinely constructed before its
      // container has its final size — here the pane starts at zero and grows
      // once layout settles, and MapLibre sizes its canvas ONCE at
      // construction. Without this the canvas stays at its initial box and
      // paints black forever. Verified: canvas 371x300 inside a 371x762 pane.
      const resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(container);
      this.destroyRef.onDestroy(() => resizeObserver.disconnect());

      map.on('load', () => {
        if (this.destroyed) return;
        if (this.uiOffscreenIndicators()) this.setupIndicators(map);
        // Flips the sync effect on; it places whatever pins exist by then.
        this.ready.set(true);
      });
    } catch (error) {
      // No WebGL, or a CSP blocking the worker. Logged rather than swallowed:
      // it can also mask a real, fixable bug. Consumers keep a list.
      console.error('[ui-map] failed to initialise:', error);
    }
  }

  /**
   * Bring the markers in line with the pin set: add what is new, drop what is
   * gone, leave the rest alone so a re-render does not make every pin blink.
   */
  private syncPins(pins: readonly UiMapPin[]): void {
    const map = this.map;
    const maplibregl = this.maplibre;
    if (!map || !maplibregl) return;

    const wanted = new Set(pins.map((pin) => pin.id));
    for (const [id, entry] of this.markers) {
      if (wanted.has(id)) continue;
      entry.marker.remove();
      this.markers.delete(id);
    }

    for (const pin of pins) {
      if (this.markers.has(pin.id)) continue;
      const element = this.createPinElement(pin);
      const marker = new maplibregl.Marker({ element, anchor: 'bottom' })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map);
      this.markers.set(pin.id, { marker, element });
    }

    if (this.uiOffscreenIndicators()) this.syncIndicators();

    // Frame the pins the FIRST time there are any. Re-framing on every later
    // change would yank the camera out from under someone who had panned.
    if (!this.fitted && pins.length > 0) {
      this.fitted = true;
      // A selection made while the catalog was still loading owns the camera —
      // framing everything here would silently override the choice the user
      // already made.
      if (this.uiSelectedPinId() === null) {
        this.frameAll(pins, 0);
      } else {
        this.moveTo(this.uiSelectedPinId());
      }
    }

    this.paintSelection(this.uiSelectedPinId());
  }

  /**
   * A rounded head carrying a place glyph plus a pointed tail, so the marker's
   * `anchor: 'bottom'` lands exactly on the coordinate. Built imperatively for
   * MapLibre, outside Angular's view tree — its chrome lives in the GLOBAL
   * `map.css` for exactly that reason.
   */
  /** Fit every pin into the part of the map that is not covered. */
  private frameAll(pins: readonly UiMapPin[], duration: number): void {
    if (pins.length === 0) return;
    const edge = this.uiFitPadding();
    this.map?.fitBounds(boundsOf(pins), {
      padding: {
        top: edge + this.uiTopInsetPx(),
        left: edge,
        right: edge,
        bottom: edge + this.bottomInsetPx(this.uiBottomInsetFraction()),
      },
      maxZoom: 15,
      duration,
    });
  }

  private bottomInsetPx(fraction: number): number {
    if (fraction <= 0) return 0;
    const height = this.hostRef.nativeElement.getBoundingClientRect().height;
    // Always keep HALF the map to frame into. A sheet at its tallest detent
    // covers ~92%, and fitting bounds into the 8% sliver that remains threw
    // the pins off-screen — and left them there, because the camera keeps that
    // state when the sheet comes back down. Framing against a half viewport
    // puts them in the top half, which is exactly where they should be the
    // moment the sheet is lowered.
    return Math.min(height * fraction, height * 0.5);
  }

  private createPinElement(pin: UiMapPin): HTMLElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'ui-map__pin';
    element.setAttribute('aria-label', pin.label);

    const head = document.createElement('span');
    head.className = 'ui-map__pin-head';
    // The one sanctioned hover/press grammar. Stamped on the HEAD, not the
    // button: the ::after state layer inherits the head's 50% radius, and the
    // press scale must not fight the inline `transform` MapLibre rewrites on
    // the button on every `move` event.
    head.setAttribute('data-interactive', '');

    const icon = document.createElement('span');
    icon.className = 'ui-map__pin-icon material-symbols-rounded';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = resolveUiIcon('location.pin', this.iconOverrides);
    head.appendChild(icon);

    const tail = document.createElement('span');
    tail.className = 'ui-map__pin-tail';

    element.append(head, tail);
    element.addEventListener('click', () => this.uiPinSelect.emit(pin.id));
    return element;
  }

  private paintSelection(selectedId: string | null): void {
    for (const [id, { element }] of this.markers) {
      element.toggleAttribute('data-active', id === selectedId);
    }
    for (const [id, { element }] of this.indicators) {
      element.toggleAttribute('data-active', id === selectedId);
    }
  }

  /**
   * Move the camera to match the selection.
   *
   * Selecting a pin flies IN to it; clearing the selection pulls back OUT to
   * frame every pin. The symmetry matters: "any of them" is a statement about
   * the whole set, so the map should show the whole set — leaving it zoomed on
   * whichever pin was last chosen contradicts what was just chosen.
   */
  private moveTo(selectedId: string | null): void {
    const map = this.map;
    if (!map) return;
    const pins = this.uiPins();

    if (selectedId === null) {
      if (pins.length === 0) return;
      this.frameAll(pins, prefersReducedMotion() ? 0 : 700);
      return;
    }

    const pin = pins.find((candidate) => candidate.id === selectedId);
    if (!pin) return;

    const center: [number, number] = [pin.lng, pin.lat];
    const zoom = this.uiSelectedZoom();
    // Lift the target by half the covered height so the pin lands in the
    // MIDDLE of the visible strip rather than the middle of the whole map,
    // which would put it behind the sheet.
    const offset: [number, number] = [
      0,
      (this.uiTopInsetPx() - this.bottomInsetPx(this.uiBottomInsetFraction())) /
        2,
    ];
    if (prefersReducedMotion()) {
      // `jumpTo` takes no offset — `easeTo` with zero duration is the same
      // instant move and does.
      map.easeTo({ center, zoom, offset, duration: 0 });
    } else {
      map.flyTo({ center, zoom, offset, duration: 700 });
    }
  }

  /**
   * Chips on the viewport edge pointing at pins that are currently off-screen.
   *
   * Each chip's position walks the ray from the pane's centre toward the true
   * point and stops at the first padded edge it crosses, so the chip sits on
   * the bearing of the thing it refers to.
   */
  private setupIndicators(map: MapLibreMap): void {
    const update = (): void => this.positionIndicators(map);
    this.indicatorUpdate = update;
    update();
    map.on('move', update);
    this.destroyRef.onDestroy(() => map.off('move', update));
  }

  /** Rebuild the edge chips for the current pin set. */
  private syncIndicators(): void {
    const container = this.hostRef.nativeElement.querySelector<HTMLElement>(
      '[data-ui-map-indicators]',
    );
    if (!container) return;

    for (const { element } of this.indicators.values()) element.remove();
    this.indicators.clear();

    for (const pin of this.uiPins()) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'ui-map__indicator';
      element.setAttribute('data-interactive', '');
      element.setAttribute('aria-label', pin.label);

      const arrow = document.createElement('span');
      arrow.className = 'ui-map__indicator-arrow material-symbols-rounded';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = resolveUiIcon(
        'location.recenter',
        this.iconOverrides,
      );
      element.appendChild(arrow);

      element.addEventListener('click', () => this.uiPinSelect.emit(pin.id));
      container.appendChild(element);
      this.indicators.set(pin.id, { element, arrow });
    }

    this.indicatorUpdate?.();
  }

  private indicatorUpdate: (() => void) | null = null;

  private positionIndicators(map: MapLibreMap): void {
    const container = this.hostRef.nativeElement.querySelector<HTMLElement>(
      '[data-ui-map-indicators]',
    );
    if (!container) return;
    {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      const centerX = width / 2;
      const centerY = height / 2;
      const minX = EDGE_PADDING;
      const maxX = width - EDGE_PADDING;
      const minY = EDGE_PADDING;
      const maxY = height - BOTTOM_EDGE_PADDING;

      for (const pin of this.uiPins()) {
        const entry = this.indicators.get(pin.id);
        if (!entry) continue;
        const point = map.project([pin.lng, pin.lat]);
        const visible =
          point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;

        entry.element.toggleAttribute('data-visible', !visible);
        if (visible) continue;

        const dx = point.x - centerX;
        const dy = point.y - centerY;
        let t = 1;
        if (dx < 0) t = Math.min(t, (minX - centerX) / dx);
        if (dx > 0) t = Math.min(t, (maxX - centerX) / dx);
        if (dy < 0) t = Math.min(t, (minY - centerY) / dy);
        if (dy > 0) t = Math.min(t, (maxY - centerY) / dy);
        t = Math.max(t, 0);

        entry.element.style.transform = `translate(-50%, -50%) translate(${
          centerX + dx * t
        }px, ${centerY + dy * t}px)`;
        entry.arrow.style.transform = `rotate(${
          (Math.atan2(dy, dx) * 180) / Math.PI + 90
        }deg)`;
      }
    }
  }
}

function boundsOf(
  pins: readonly UiMapPin[],
): [[number, number], [number, number]] {
  const lngs = pins.map((pin) => pin.lng);
  const lats = pins.map((pin) => pin.lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * MapLibre's compact attribution control mounts EXPANDED, so every map opens
 * with the full credits strip across its bottom edge. Collapsing it to the (i)
 * puck is exactly what MapLibre does on drag (`_updateCompactMinimize`).
 *
 * It cannot be done at construction: the control mounts EMPTY and only stamps
 * the expanded classes once the first `styledata` fills the credits in. So
 * this waits for the class, collapses once, and detaches — re-collapsing
 * behind a user who deliberately opened the credits would be rude, and a theme
 * swap re-runs `setStyle`. Nothing is lost: the puck still expands on tap.
 */
function collapseAttribution(map: MapLibreMap, container: HTMLElement): void {
  const collapse = (): void => {
    const attribution = container.querySelector(
      '.maplibregl-ctrl-attrib.maplibregl-compact-show',
    );
    if (!attribution) return;
    attribution.classList.remove('maplibregl-compact-show');
    map.off('styledata', collapse);
  };
  map.on('styledata', collapse);
  collapse();
}
