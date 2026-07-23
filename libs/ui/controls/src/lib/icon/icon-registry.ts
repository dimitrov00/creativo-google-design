import { InjectionToken, Provider } from '@angular/core';

/**
 * Semantic icon registry — the design system's icon VOCABULARY.
 *
 * Call sites name the INTENT (`'sheet.close'`, `'location.directions'`),
 * never the glyph (`'close'`, `'near_me'`). Two intents may share a glyph
 * today and diverge later by editing ONE line here — e.g. if
 * `'account.reservations'` should stop riding `event_available` and get
 * its own mark, no call site moves. This is the same indirection SF
 * Symbols' semantic names give SwiftUI (`systemName:` is already a
 * vocabulary, not a font codepoint).
 *
 * Naming: `domain.action` (dot-separated, intent-first). Add new keys for
 * new INTENTS even when the glyph already appears in the map — sharing a
 * key across unrelated intents is the exact coupling this registry exists
 * to prevent.
 *
 * `as const satisfies Record<string, string>` keeps every value a literal
 * (so `UiIconName` is the closed union of keys) while still type-checking
 * the shape.
 */
export const UI_ICON_REGISTRY = {
  /* ── Appointments / booking ─────────────────────────────────────── */
  /** Booking identity glyph — leading icon on "book" CTAs. */
  'appointment.book': 'calendar_month',
  /** Trailing departure affordance on booking CTAs (the flow leaves the
   *  landing surface for the client app). */
  'appointment.launch': 'arrow_outward',

  /* ── Account ────────────────────────────────────────────────────── */
  'account.reservations': 'event_available',
  'account.rewards': 'redeem',
  /** Guest-locked affordance — login pill, locked menu rows. */
  'auth.locked': 'lock',

  /* ── Site navigation (menu rows / anchors) ──────────────────────── */
  'nav.work': 'photo_library',
  'nav.team': 'group',
  'nav.services': 'layers',
  'nav.visit': 'location_on',
  'nav.careers': 'work',
  /** In-page "explore / open detail" affordance (team cards). */
  'nav.explore': 'arrow_forward',
  /** Marker on links that leave the site (footer external links). */
  'link.external': 'arrow_forward',
  /** Apply-via-Instagram CTA on the hiring section. */
  'hiring.apply': 'arrow_right_alt',

  /* ── Sheets / overlays ──────────────────────────────────────────── */
  'sheet.close': 'close',

  /* ── Locations ──────────────────────────────────────────────────── */
  /** Place/address identity glyph on location cards and sheet rows. */
  'location.place': 'location_on',
  'location.call': 'call',
  'location.directions': 'near_me',
  /** Map marker head (imperative MapLibre DOM). */
  'location.pin': 'storefront',
  /** Offscreen-location edge indicator arrow (imperative MapLibre DOM;
   *  rotated in code to point at the location, clicking recenters). */
  'location.recenter': 'arrow_upward',

  /* ── Galleries & layout toggles ─────────────────────────────────── */
  /** Showcase gallery: switch to the expanded grid. */
  'gallery.grid': 'grid_view',
  /** Showcase gallery: switch back to the film-strip carousel. */
  'gallery.strip': 'view_carousel',
  /** Generic list/grid layout toggle (service performers roster). */
  'layout.grid': 'grid_view',
  'layout.list': 'view_agenda',

  /* ── Services ───────────────────────────────────────────────────── */
  /** Bundle badge — a service composed of several services. */
  'service.bundle': 'layers',
  /** Fallback mark for a service tile without imagery (scissors — the
   *  craft itself). */
  'service.placeholder': 'content_cut',
  /** Duration meta rows (sheet summary, per-performer terms). */
  'service.duration': 'schedule',
  /** Variant-count meta on service tiles. */
  'service.variants': 'tune',

  /* ── Preferences ────────────────────────────────────────────────── */
  'prefs.language': 'language',
  'prefs.theme.light': 'light_mode',
  'prefs.theme.dark': 'dark_mode',

  /* ── Stats / media (reserved for known upcoming intents) ────────── */
  /** UiRating's star (today a raw ligature in rating.ts — migrate here). */
  'rating.star': 'star',
  /** Ambient-video / media play affordance. */
  'media.play': 'play_arrow',
} as const satisfies Record<string, string>;

/**
 * The closed, type-safe icon vocabulary — `uiName` accepts ONLY these.
 * A typo'd or unregistered intent is a compile error at the call site.
 */
export type UiIconName = keyof typeof UI_ICON_REGISTRY;

/** A partial remap of semantic keys to different Material Symbol glyphs. */
export type UiIconOverrides = Partial<Record<UiIconName, string>>;

/**
 * Injection hook for theme/app remaps. Multi-provider: several layers may
 * each remap a slice of the vocabulary; later providers win on conflicts
 * (standard DI ordering — app config after library defaults).
 */
export const UI_ICON_OVERRIDES = new InjectionToken<readonly UiIconOverrides[]>(
  'UI_ICON_OVERRIDES',
);

/**
 * Remap semantic icons for an app/route subtree WITHOUT forking the
 * registry — SwiftUI's "same semantic, different asset per theme" move.
 *
 * ```ts
 * // app.config.ts (or any route/component `providers`)
 * providers: [
 *   provideUiIcons({ 'location.pin': 'distance', 'sheet.close': 'cancel' }),
 * ]
 * ```
 *
 * Only KNOWN semantic keys can be remapped (typos are compile errors);
 * values are raw Material Symbols ligature names.
 */
export function provideUiIcons(overrides: UiIconOverrides): Provider {
  return { provide: UI_ICON_OVERRIDES, useValue: overrides, multi: true };
}

/**
 * Resolve a semantic name to its Material Symbols glyph: overrides
 * (last-wins) → registry → the name itself. The raw-name fallback is a
 * RUNTIME safety net only — un-migrated/dynamic call sites keep rendering
 * their ligature instead of a tofu box — the `UiIconName` input type is
 * what enforces the vocabulary at compile time.
 */
export function resolveUiIcon(
  name: UiIconName,
  overrides?: readonly UiIconOverrides[] | null,
): string {
  if (overrides) {
    for (let i = overrides.length - 1; i >= 0; i--) {
      const glyph = overrides[i]?.[name];
      if (glyph !== undefined) return glyph;
    }
  }
  return UI_ICON_REGISTRY[name] ?? name;
}
