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
  /** Add someone to the booking party. Distinct from `account.profile`:
   *  this is a companion being brought along, not the signed-in person. */
  'party.addGuest': 'person_add',
  /** Take a guest back out of the party. Shares the `close` glyph with
   *  `sheet.close` today; the intents are unrelated and may diverge. */
  'party.removeGuest': 'close',
  /** Drop something already committed — a cart line, a saved choice. Distinct
   *  from `party.removeGuest`: that dismisses a row being assembled, this
   *  destroys a thing the user already has. */
  'booking.removeLine': 'delete',
  /** Rename a guest in place — the pencil, not `account.profile`'s dial. */
  'party.renameGuest': 'edit',
  /** The booking bag — the running selection across the whole party. */
  'booking.bag': 'shopping_bag',
  /** One bookable time. Distinct from `appointment.book` (the CTA mark). */
  'booking.slot': 'schedule',
  /** "Anyone available" — the barber preference that names no one. */
  'booking.anyBarber': 'groups',
  /** A service that cannot combine with what is already selected. */
  'booking.blocked': 'block',
  /** Go back and change what was chosen — the summary's own pencil. Distinct
   *  from `party.renameGuest`: that edits a label in place, this rewinds the
   *  flow to the step that owns the answer. */
  'booking.edit': 'edit',

  /* ── Account ────────────────────────────────────────────────────── */
  'account.reservations': 'event_available',
  'account.rewards': 'redeem',
  /** Personal-information surface — the menu's profile chip, the row that
   *  opens it. Distinct from `prefs.*` on purpose: this is WHO you are, not
   *  how the app behaves. */
  'account.profile': 'manage_accounts',
  /** Someone whose name we do not have yet — the avatar's own fallback. */
  'account.anonymous': 'person',
  /** Profile photo affordances — pick/replace, and drop back to the monogram. */
  'account.photo': 'photo_camera',
  'account.photoRemove': 'delete',
  /** The notification inbox — what has been delivered TO you, as opposed
   *  to `account.reservations` (what you booked) or `account.rewards`
   *  (what you earned). Its own key so an unread/read mark can diverge
   *  later without touching a call site. */
  'account.notifications': 'notifications',
  /** Profile-completion checklist: item done / still pending. */
  'checklist.done': 'check',
  'checklist.pending': 'radio_button_unchecked',
  /** Guest-locked affordance — login pill, locked menu rows. */
  'auth.locked': 'lock',

  /* ── Auth flow (/auth + /onboarding) ────────────────────────────── */
  /** Email OTP channel identity glyph (identify screen, code lede). */
  'auth.email': 'mail',
  /** Phone OTP channel identity glyph (phone deployments, phone field). */
  'auth.phone': 'call',
  /** "Resend code" affordance on the OTP screen. */
  'auth.resend': 'refresh',
  /** "Edit" affordance next to the sent-to identifier on the OTP screen. */
  'auth.editIdentifier': 'edit',
  'auth.signOut': 'logout',

  /* ── Site navigation (menu rows / anchors) ──────────────────────── */
  'nav.work': 'photo_library',
  'nav.team': 'group',
  'nav.services': 'layers',
  'nav.visit': 'location_on',
  'nav.careers': 'work',
  /** In-page "explore / open detail" affordance (team cards). */
  'nav.explore': 'arrow_forward',
  /** In-flow back affordance (auth code screen → identify). */
  'nav.back': 'chevron_left',
  /** Trailing disclosure on interactive list rows (iOS chevron). */
  'nav.disclosure': 'chevron_right',
  /** Marker on links that leave the site (footer external links). */
  'link.external': 'arrow_forward',
  /** Apply-via-Instagram CTA on the hiring section. */
  'hiring.apply': 'arrow_right_alt',

  /* ── Sheets / overlays ──────────────────────────────────────────── */
  'sheet.close': 'close',

  /* ── Composite fields ───────────────────────────────────────────── */
  /** Disclosure caret on a field-embedded picker trigger (the "▾" on
   *  ui-phone-field's country trigger). */
  'field.expand': 'arrow_drop_down',

  /* ── Views / additive actions ───────────────────────────────────── */
  /** The two ways to read one set of dated things — a segmented pair, so the
   *  glyphs have to be legible against EACH OTHER, not merely on their own. */
  'view.list': 'format_list_bulleted',
  'view.calendar': 'calendar_month',
  /** "One more of these" — the additive action at a bar's trailing edge. */
  'action.add': 'add',
  /** Narrow what a list shows. The funnel, not the sliders: sliders promise
   *  several dials, a funnel promises one choice. */
  'action.filter': 'filter_list',

  /* ── A booked visit's own verbs and facts ───────────────────────────── */
  /** Put this visit in the device's calendar (an `.ics` hand-off). */
  'visit.calendar': 'event_available',
  /** What the client asked the shop to know before the chair. */
  'visit.note': 'sticky_note_2',
  /** What it comes to — money, stated not charged. */
  'visit.price': 'payments',
  /** "The same again" — book a past visit's services with the same barber. */
  'visit.repeat': 'replay',
  /** Move THIS booking to another time — the same visit, not a new one. */
  'visit.reschedule': 'edit_calendar',

  /* ── Calendars / paging ─────────────────────────────────────────── */
  'calendar.previous': 'chevron_left',
  'calendar.next': 'chevron_right',
  /** Jump the scrolling calendar back to the current month. */
  'calendar.today': 'today',
  /** "Search several days for me" — the booking flow's multi-day declaration.
   *  A search-flavoured glyph rather than a calendar one (owner ruling
   *  2026-08-01): the mode's promise is the SEARCH across days, and next to a
   *  month grid a calendar icon disappears into its surroundings. */
  'calendar.flexible': 'manage_search',
  /** A standing waitlist request: we are watching these days for you. */
  'calendar.watching': 'notifications_active',

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
  /** "Any location" — the booking flow's first-class "wherever is soonest". */
  'location.any': 'travel_explore',

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
  /** Per-variant marks on the options chips — a hair-length choice reads
   *  as a measure, a skin/fade choice as the face it's cut against. */
  'service.variant.length': 'straighten',
  'service.variant.skin': 'face',
  /** Quiet details affordance on selectable service cards (onboarding). */
  'service.details': 'info',

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
