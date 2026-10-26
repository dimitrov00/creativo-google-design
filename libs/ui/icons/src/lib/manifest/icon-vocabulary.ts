import {
  UI_ICON_MANIFEST_SCHEMA_VERSION,
  UiIconAsset,
  normalizeIconEntry,
  type UiIconManifest,
  type UiLogoEntry,
  type UiVectorAsset,
} from './icon-manifest';

/**
 * Semantic icon vocabulary — the BUNDLED manifest's icon table.
 *
 * Pure data, no Angular: `tools/icons/build-material-glyphs.mjs` imports
 * this module under Node's type stripping to know which glyphs to fetch, and
 * `icon-vocabulary.spec.ts` checks every value against the generated table.
 * Angular wiring (DI overrides, the registry service) lives in
 * `../registry`.
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
 * the shape. Every value is a Material Symbols Rounded glyph NAME; the
 * artwork itself is the generated `material-glyphs.generated.ts`, fetched
 * at a pinned revision by `pnpm icons:glyphs` — a name that revision does
 * not carry fails generation loudly instead of rendering its own name in
 * capitals the way the old ligature font did.
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
  /**
   * Placed, but outside the hours it belongs in — a booking that runs past
   * closing or lands on a day off.
   *
   * NOT `booking.blocked`: that glyph means the thing cannot happen, and this
   * one has already happened. It is the shop's own book, so a barber working
   * late is recorded rather than argued with; the mark says so out loud so
   * nobody reads it as an ordinary hour.
   */
  'schedule.outsideShift': 'running_with_errors',
  /** Go back and change what was chosen — the summary's own pencil. Distinct
   *  from `party.renameGuest`: that edits a label in place, this rewinds the
   *  flow to the step that owns the answer. */
  'booking.edit': 'edit',

  /* ── Account ────────────────────────────────────────────────────── */
  'account.reservations': 'event_available',
  'account.rewards': 'redeem',
  /** A coupon or a promo code — the ticket on an offer's card. */
  'promo.coupon': 'confirmation_number',
  'promo.percent': 'percent',
  'promo.sum': 'sell',
  'promo.voucher': 'redeem',
  /** Read a QR code or a barcode with the camera. */
  'action.scan': 'qr_code_scanner',
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
  /** A CLIENT'S own address and number — the contact details on a booking.
   *  Distinct from `auth.*`, which identifies an OTP channel: the same two
   *  marks today, but they answer different questions and must be free to
   *  diverge. */
  'contact.email': 'mail',
  'contact.phone': 'call',
  /** Text this client — the client card's `sms:` tile. */
  'contact.sms': 'sms',
  /**
   * Message this client on Viber — the card's `viber://` tile.
   *
   * Two bubbles, not a brand mark: Material carries no Viber glyph, and a
   * hand-drawn logo would be a vector entry to keep in step with someone
   * else's brand book. `forum` is told apart from `contact.sms` by SHAPE (one
   * bubble against two), so the pair still reads without their captions.
   */
  'contact.viber': 'forum',
  /** The person themselves — the third part an omnibox can detect. */
  'contact.person': 'person',
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
  /** The menu's admin entry for the loyalty programme's rules («Ритъм»).
   *  Shares `loyalty` with `loyalty.program` (the programme as the client
   *  card shows it): this one is the place an admin MANAGES it from. */
  'admin.loyalty': 'loyalty',
  /** Marker on links that leave the site (footer external links). */
  'link.external': 'arrow_forward',
  /** Apply-via-Instagram CTA on the hiring section. */
  'hiring.apply': 'arrow_right_alt',

  /* ── Sheets / overlays ──────────────────────────────────────────── */
  'sheet.close': 'close',
  /** Send a toast away before its clock runs out. Its own intent: a toast is
   *  not a sheet, and the two marks may diverge (a sheet's ✕ could become a
   *  circled one without the toast following). Shares `close` today. */
  'toast.dismiss': 'close',

  /* ── Composite fields ───────────────────────────────────────────── */
  /** Disclosure caret on a field-embedded picker trigger (the "▾" on
   *  ui-phone-field's country trigger). */
  /**
   * ONE chevron family, owner ruling 2026-08-26.
   *
   * This was `arrow_drop_down` — a FILLED TRIANGLE — while every other
   * direction glyph in the registry (`nav.back`, `nav.disclosure`,
   * `calendar.previous`, `calendar.next`) is a STROKE CHEVRON. Two shapes for
   * one idea read as two systems, which is exactly what the owner saw. The
   * meanings still differ and must: `field.expand` drops a menu where you
   * stand, `nav.disclosure` takes you somewhere and brings you back. Only the
   * drawing is now consistent.
   */
  /**
   * ⚠ `keyboard_arrow_down`, not `expand_more`. Both draw the same chevron,
   * and only one of them is in the PINNED font: `material-symbols@0.45.8`
   * ships no `expand_more`, and an unresolvable ligature does not tofu or
   * throw — it renders its own NAME in capitals. It happened to look right
   * in the browser because the CDN face is newer than the pinned package.
   * `icon.spec.ts` checks every value against the package's own `index.d.ts`
   * and is the only thing that catches this.
   *
   * It now shares a glyph with `frame.handleEnd`, which is fine and is the
   * reason the registry is keyed on INTENT: the chevron-rotation rule in
   * icon.css matches `data-name='field.expand'`, so the frame's drag handles
   * — which mean a direction, not a menu — are untouched by it.
   */
  'field.expand': 'keyboard_arrow_down',
  /**
   * THE POP-UP BUTTON'S MARK — HIG's `chevron.up.chevron.down`: a control
   * whose value is CHOSEN from a short list (a `ui-choice-menu` trigger, a
   * country picker, a booking select). Distinct from `field.expand`, which
   * discloses something in place and rotates when open, and from
   * `nav.disclosure`, which travels (owner, 2026-09-15: "the dropdown/choice
   * inputs should have the chevron up-and-down icon"). `unfold_more` is the
   * pinned font's stacked pair; it never rotates.
   */
  'field.popUp': 'unfold_more',
  /** The search field's own clear — the circled ✕ of the platform's field. */
  'field.clear': 'cancel',

  /* ── The visit frame's resize handles ───────────────────────────── */
  /**
   * The two chevrons on the edges of a draggable time block.
   *
   * Their own keys rather than a reuse of `nav.back`/`field.expand`: these
   * are the ONLY glyphs in the vocabulary that name a DIRECTION A GESTURE
   * MOVES rather than a place navigation goes or a menu that drops. The
   * distinction is what lets the handle's arrow diverge from the disclosure
   * chevron later without moving a call site — and it keeps the same
   * stroke-chevron family the 2026-08-26 ruling above settled on.
   */
  'frame.handleStart': 'keyboard_arrow_up',
  'frame.handleEnd': 'keyboard_arrow_down',

  /* ── Views / additive actions ───────────────────────────────────── */
  /** The two ways to read one set of dated things — a segmented pair, so the
   *  glyphs have to be legible against EACH OTHER, not merely on their own. */
  'view.list': 'format_list_bulleted',
  'view.calendar': 'calendar_month',
  /** The same set as a map — the other half of a map | list pill. */
  'view.map': 'map',
  /** "One more of these" — the additive action at a bar's trailing edge. */
  'action.add': 'add',
  /** One fewer — the count stepper's minus. */
  'action.remove': 'remove',
  /** Narrow what a list shows. The funnel, not the sliders: sliders promise
   *  several dials, a funnel promises one choice. */
  'action.filter': 'filter_list',
  /** Find something in a list the eye cannot scan — the staff book's search.
   *  Distinct from `calendar.flexible`'s `manage_search`, which promises a
   *  search ACROSS DAYS rather than a plain lookup. */
  'action.search': 'search',

  /* ── A booked visit's own verbs and facts ───────────────────────────── */
  /** Put this visit in the device's calendar (an `.ics` hand-off). */
  'visit.calendar': 'event_available',
  /**
   * The staff day sheet — the shop's own book. A calendar page WITH written
   * entries, which is what a day sheet is; `calendar_month` (a bare grid) is
   * already `view.calendar` and would say the wrong thing here anyway.
   *
   * NOT `contact_calendar`, however well it fits: that glyph does not exist
   * in the pinned `material-symbols` package, and a ligature the font cannot
   * resolve renders as its own NAME in 24px caps — the row read
   * "CONTACT_CALENDAR" in the live menu. Ligature fonts fail loudly but
   * silently at build time, so any new value here has to be checked against
   * the installed set. `icon.spec.ts` now does that for every entry.
   */
  'staff.day': 'event_note',
  /** A chair standing empty ALL DAY — the barber is off. Not `visit.noShow`
   *  (that is a client who did not come) and not `visit.cancelled` (that is
   *  one booking): this is the whole day, and it was never booked.
   *  A cup rather than the sofa this started as: at 16px a sofa is a broad
   *  blob, and `beach_access` — the other candidate — claims a HOLIDAY, which
   *  an ordinary Monday off is not. (`palm_tree` does not ship in the pinned
   *  font; `coffee`, `beach_access`, `sunny` and `deck` all do.) */
  'staff.off': 'coffee',
  /** A chair whose day the sheet could not read in full — its read failed,
   *  or it holds visits that cannot be shown (OR-2): the error mark in the
   *  all-day row's disc, where `staff.off` puts its cup. Not
   *  `schedule.outsideShift`, which shares the glyph today: that marks a
   *  booking placed out of hours, this a day the sheet cannot vouch for. */
  'staff.dayHealth': 'running_with_errors',
  /** What the client asked the shop to know before the chair. */
  'visit.note': 'sticky_note_2',
  /** The chair was held and nobody came. Distinct from a cancellation, which
   *  freed the time — this one consumed it. */
  'visit.noShow': 'person_off',
  /**
   * The rest of a row's verbs, behind an overflow trigger.
   *
   * Its own intent rather than a reuse of `service.details`: this opens a
   * MENU of actions, not a description, and the two would diverge the first
   * time either wanted its own mark.
   */
  'action.more': 'more_horiz',
  /** What it comes to — money, stated not charged. */
  'visit.price': 'payments',
  /** "The same again" — book a past visit's services with the same barber. */
  'visit.repeat': 'replay',
  /** Move THIS booking to another time — the same visit, not a new one. */
  'visit.reschedule': 'edit_calendar',
  /**
   * The agenda's row VERBS, as marks rather than words.
   *
   * A schedule card is read at arm's length between cuts, and a run of
   * "Готово"/"Дойде" pills spends the card's width restating a small set of
   * acts the reader learns once. These are the same three acts as glyphs —
   * distinct silhouettes, not three variations on a tick, so they separate
   * without being read.
   */
  /** The person is HERE — check-in, not completion. */
  'visit.arrived': 'how_to_reg',
  /** A visit happening now, by the book — inside its window, no stamp yet. */
  'visit.now': 'timelapse',
  /** When a person was last here — the add-client page's «посл. 22.09» line. */
  'visit.last': 'history',
  /** The work is done. A filled mark, so it reads as an end rather than a tick. */
  'visit.completed': 'task_alt',
  /** The shop accepts a booking it had been vetting. */
  'visit.confirmed': 'check',
  /** A booking that was withdrawn — a calendar with the day struck out,
   *  distinct from `visit.noShow`, where the chair was held and nobody came. */
  'visit.cancelled': 'event_busy',
  /** Requested, not yet accepted — the state that is waiting on someone. */
  'visit.pending': 'hourglass_top',
  /** Take a no-show back — the lifecycle's one correction edge. */
  'visit.reopen': 'undo',

  /* ── A client, as the staff sees them (the client card) ─────────── */
  /** Take this person off THIS visit — the card's destructive row. Not
   *  `party.removeGuest` (a ✕ on a row still being assembled): this undoes a
   *  seat that is already booked, so it names the person it removes. */
  'client.remove': 'person_remove',
  /** A client's past cuts — the card's photo rail heading AND the history
   *  row's photo mark. One concept, one key: the two must never disagree.
   *  Shares `photo_library` with `media.library` (the phone's own photos)
   *  and `nav.work` (the shop's portfolio) today; the intents differ. */
  'client.photos': 'photo_library',
  /** A client's birthday, as the staff meets it: the disc on the occasion
   *  band («Рожден ден днес») and the notice of one coming up. Shares
   *  `cake` with `loyalty.badge.birthday`, the birthday MEDAL's face: that
   *  one is an achievement, this one is a day. */
  'client.birthday': 'cake',
  /* `client.visits` is an ALIAS of `account.reservations` — see
     UI_ICON_ALIASES. */

  /* ── Calendars / paging ─────────────────────────────────────────── */
  'calendar.previous': 'chevron_left',
  'calendar.next': 'chevron_right',
  /* Full screen and the way back — Apple's diagonal arrows, in Material. */
  'frame.expand': 'open_in_full',
  'frame.collapse': 'close_fullscreen',
  /** Jump the scrolling calendar back to the current month. */
  'calendar.today': 'today',
  /** "Search several days for me" — the booking flow's multi-day declaration.
   *  A search-flavoured glyph rather than a calendar one (owner ruling
   *  2026-08-01): the mode's promise is the SEARCH across days, and next to a
   *  month grid a calendar icon disappears into its surroundings. */
  'calendar.flexible': 'manage_search',
  /** A standing waitlist request: we are watching these days for you. */
  'calendar.watching': 'notifications_active',
  /* The staff schedule's four renderings. Separate intents rather than one
     `calendar.view` key, because the switcher shows the CURRENT one and the
     four must be distinguishable at a glance in a 44pt target. */
  /** The complete run as a list — visits and sellable gaps in clock order. */
  'calendar.viewAgenda': 'view_agenda',
  /** One day, one column per barber. */
  'calendar.viewDay': 'calendar_view_day',
  /** Three days side by side. */
  'calendar.viewThreeDay': 'view_column',
  /** A Monday-first week. */
  'calendar.viewWeek': 'calendar_view_week',

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
  /* `gallery.grid` is an ALIAS of `layout.grid` — see UI_ICON_ALIASES. */
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
  /** Two doors to a picture: the camera, and what the phone already holds. */
  'media.camera': 'photo_camera',
  'media.library': 'photo_library',
  /** The shop's own pictures — the catalogue's covers and work. An album,
   *  not `collections`: that name exists in the legacy Material Icons set only,
   *  and the ligature font rendered it as the WORD in capitals on the visit
   *  editor's photo door. The glyph generator now refuses such a name. */
  'media.gallery': 'photo_album',

  /* ── Connection ─────────────────────────────────────────────────── */
  /** What the reader sees is the last copy this device saved, not a live
   *  read — the offline notice on a page that could not reach the server. */
  'connection.offline': 'cloud_off',

  /* ── Loyalty: the programme, its currency, its rhythm ───────────── */
  /**
   * The loyalty module as a whole — its row and its page.
   *
   * The house bans three marks here, and a new key must not reach for them:
   * `local_fire_department` (a streak is a rhythm, not a flame to keep
   * alive), `crown` (it ranks PEOPLE; the programme ranks nothing but a
   * client's own history) and `auto_awesome` (its path at the pin sits on a
   * 24-unit viewBox, which the generator refuses — the prototype's blank
   * glyphs came from it).
   */
  'loyalty.program': 'loyalty',
  /** The points balance — the figure beside the gauge. */
  'loyalty.points': 'stars',
  /* No `loyalty.streak`: the «Лоялност» page's «Ритъм» section is titled
     with the achievements shelf's own `loyalty.category.rhythm` — one name,
     one glyph — and `event_repeat` stays the «В ритъм» medal's face
     (`loyalty.badge.streak`), never a heading's (wave D r4). */
  /** A period the streak is protected over, or frozen through. */
  'loyalty.freeze': 'ac_unit',
  /** The tier capsule on the balance. */
  'loyalty.tier': 'workspace_premium',
  /** Something the points buy. Shares `redeem` with `account.rewards` (the
   *  client's own menu row) and `promo.voucher`; the staff card's catalogue
   *  row is its own intent. */
  'loyalty.reward': 'redeem',
  /**
   * A reward the balance cannot buy yet — ONLY on an unaffordable catalogue
   * row.
   *
   * Never on a medal: one not started yet is its own emblem, greyed inside a
   * dashed ring — nothing is locked, it is simply not done. Shares `lock`
   * with `auth.locked`, which gates a guest out of a feature — a different
   * question.
   */
  'loyalty.locked': 'lock',
  /** The stamp cards — «every tenth visit», counted by stamps. */
  'loyalty.stampCard': 'approval',
  /** The points activity — what was earned and spent, line by line. */
  'loyalty.ledger': 'receipt_long',
  /** The wallet's «Код»: type or scan a code, which opens the discount
   *  page. Shares `qr_code_scanner` with `action.scan`, the scan button
   *  there; this one is a verb on the wallet, not the scanner's own mark. */
  'loyalty.enterCode': 'qr_code_scanner',

  /* ── Loyalty: records ───────────────────────────────────────────── */
  /**
   * «Рекорди» — a client's own bests and habits. The first four are the
   * record CARDS' emblems (one per `PersonalRecord` kind), the rest the
   * rows of the records page.
   *
   * A record is not a medal: none of these keys sits under
   * `loyalty.badge.`, so a record may share a glyph with a medal's face
   * (`event_repeat`, `waving_hand`, `content_cut`) without cloning it on a
   * shelf — the two are never drawn in one row.
   */
  'loyalty.record.longestRhythm': 'event_repeat',
  'loyalty.record.mostVisitsInYear': 'calendar_month',
  /** Drawn only when the favourite service has no cover of its own. */
  'loyalty.record.favouriteService': 'favorite',
  'loyalty.record.firstVisit': 'waving_hand',
  'loyalty.record.currentRhythm': 'event_repeat',
  'loyalty.record.totalVisits': 'event_available',
  'loyalty.record.last12Months': 'history',
  /** The row's disc when the barber has no picture. */
  'loyalty.record.preferredBarber': 'person',
  /** The row's disc when the service has no cover. */
  'loyalty.record.usualServices': 'content_cut',

  /* ── Loyalty: the activity feed («Движение») ────────────────────── */
  /**
   * One key per `ActivityKind`: the glyph on a row of the wallet's
   * activity and of the ledger page. They replace the first cut's
   * borrowed marks (`visit.completed`, `loyalty.badge`, `visit.reopen`),
   * so a row's glyph names what HAPPENED to the balance and can change
   * without touching a visit's own states.
   */
  'loyalty.activity.visit': 'content_cut',
  'loyalty.activity.level': 'military_tech',
  'loyalty.activity.redeemed': 'redeem',
  'loyalty.activity.granted': 'confirmation_number',
  'loyalty.activity.tier': 'workspace_premium',
  'loyalty.activity.adjusted': 'tune',
  /** Points or a grant that ran out: the sand is at the bottom. Not
   *  `hourglass_top` (`visit.pending`, `loyalty.soon`), which is waiting. */
  'loyalty.activity.expired': 'hourglass_bottom',
  'loyalty.activity.reversed': 'undo',

  /* ── Loyalty: achievements, seasons and events ──────────────────── */
  /** Achievements as a whole — the medal strip and its page. */
  'loyalty.badge': 'military_tech',
  /** The «Скоро» heading: the levels closest to being earned. Shares
   *  `hourglass_top` with `visit.pending`; a heading, not a state. */
  'loyalty.soon': 'hourglass_top',
  /** The «Последни» heading: the levels earned most recently. Shares
   *  `history` with `visit.last`. */
  'loyalty.latest': 'history',
  /**
   * The current season — the «Есен 2026» heading, «Още от …» on a season
   * family's detail. A time-boxed stretch of the calendar, never the
   * season track medal's face right under it (a heading that wore the face
   * of the medal it heads cloned it, wave D r4).
   */
  'loyalty.season': 'calendar_clock',
  /** A limited-time event — the «Събития» heading. Not `celebration`, the event medals' own face. */
  'loyalty.event': 'festival',
  /** Past seasons — the archive row at the foot of the achievements page. */
  'loyalty.archive': 'inventory_2',

  /**
   * The achievement shelves — one heading per `BadgeCategoryKind`.
   *
   * Their own keys AND their own glyphs, never an emblem below: a shelf
   * names a KIND of achievement and a medal names one family, so a heading
   * that wore its leading family's face (the first cut's `flag`,
   * `event_repeat`, `content_cut`, `person_heart`) cloned the first medal
   * under it — and the art-less medals of other shelves too. The spec pins
   * the two glyph sets disjoint, and every other heading of the pages
   * (`loyalty.soon` · `.latest` · `.season` · `.event` · `.archive`) off
   * the emblems too.
   *
   * `barbers` is `groups` because that glyph already means «the barbers»
   * here (`booking.anyBarber`). `milestones` is `signpost`, an open mark
   * like its neighbours: FILL 1's `stairs` is a solid rounded tile with
   * the steps knocked out, an app badge among open glyphs (wave D r4);
   * never a flag, the visits family's face.
   */
  'loyalty.category.milestones': 'signpost',
  'loyalty.category.mastery': 'design_services',
  'loyalty.category.barbers': 'groups',
  'loyalty.category.rhythm': 'timeline',
  'loyalty.category.special': 'star_shine',
  'loyalty.category.records': 'trophy',

  /**
   * The medal emblems — one key per `BadgeEmblem` in the engagement domain.
   *
   * A closed map in the client-card lib (`BADGE_EMBLEM_ICONS:
   * Record<BadgeEmblem, UiIconName>`) turns each emblem into one of these,
   * with no fallback, so a new emblem is a compile error until it has a key
   * here. The service, barber and shop families usually draw ART instead;
   * their keys are the fallback when no art was supplied.
   *
   * `visits` is `flag`, not the scissors the first draft gave it: the
   * scissors now mean a SERVICE (`service`), and a count of visits is a
   * milestone.
   */
  'loyalty.badge.visits': 'flag',
  'loyalty.badge.streak': 'event_repeat',
  'loyalty.badge.referral': 'group_add',
  'loyalty.badge.selfService': 'touch_app',
  'loyalty.badge.birthday': 'cake',
  'loyalty.badge.welcome': 'waving_hand',
  'loyalty.badge.service': 'content_cut',
  'loyalty.badge.barber': 'person_heart',
  'loyalty.badge.shop': 'storefront',
  'loyalty.badge.anniversary': 'hotel_class',
  'loyalty.badge.earlyBird': 'wb_twilight',
  'loyalty.badge.weekend': 'weekend',
  'loyalty.badge.onTime': 'alarm_on',
  'loyalty.badge.waitlist': 'notifications_active',
  'loyalty.badge.profile': 'person_check',
  'loyalty.badge.party': 'group',
  'loyalty.badge.explorer': 'explore',
  /*
   * A shelf's or a season's families each wear their own glyph: the
   * rhythm shelf is `event_repeat` · `cycle` · `u_turn_left`, never three
   * calendars, and a season's families never repeat its track's face.
   */
  /** «Цяла година» — a visit in each month of a year: the year's cycle. */
  'loyalty.badge.yearRound': 'cycle',
  /** «Завръщане» — back in rhythm after a break: the turn back. */
  'loyalty.badge.comeback': 'u_turn_left',
  /** An event — its row in the archive. */
  'loyalty.badge.event': 'celebration',
  /*
   * Seasons and events wear faces of their own (wave D r6): a season its
   * season of the year — so «Лято 2026» III in the archive is never the
   * running «Есен 2026», where both wore one rosette (`award_star`,
   * retired with `season`) — and a season's or an event's family a glyph
   * no perennial family wears, never the sunrise, the sofa or the
   * service's cover it counts like (`date_range`, «every month» of every
   * season, retired with `seasonMonthly`).
   */
  'loyalty.badge.summer': 'sunny',
  'loyalty.badge.autumn': 'eco',
  /** «Преди отпуска» — visits before the holidays. */
  'loyalty.badge.vacation': 'luggage',
  /** «Всеки летен месец». */
  'loyalty.badge.sailing': 'sailing',
  /** «Лятна събота». */
  'loyalty.badge.icecream': 'icecream',
  /** «Всеки есенен месец» — rain or shine. */
  'loyalty.badge.umbrella': 'umbrella',
  /** «Есенно утро» — the morning mist. */
  'loyalty.badge.fog': 'foggy',
  /** «Приятел наесен». */
  'loyalty.badge.handshake': 'handshake',
  /** «Есенна брада» — the mirror and the comb. */
  'loyalty.badge.grooming': 'self_care',
  /** «Брада на седмицата» — the oil and the comb. */
  'loyalty.badge.beardOil': 'health_and_beauty',
  /** «Пълна грижа на седмицата». */
  'loyalty.badge.spa': 'spa',
} as const satisfies Record<string, string>;

/* ── Vector icons — marks Material Symbols does not carry ────────────── */
/**
 * Brand and signature marks as inert path data. Same rendering path as a
 * remote override, so this table is also the worked example of what a
 * backend may send for a key (see `icon-manifest.ts`).
 */
export const UI_ICON_VECTORS = {
  /** Instagram — Material carries no brand glyphs. The v2 stroke mark:
   *  rounded square, lens, dot; 2-unit strokes on a 24-unit box. */
  'social.instagram': {
    iconAsset: UiIconAsset.Vector,
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      {
        d: 'M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
      },
      {
        d: 'M18 6.5a.5.5 0 1 1-1 0a.5.5 0 1 1 1 0z',
        fill: 'currentColor',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinejoin: 'round',
      },
    ],
  },
} as const satisfies Record<string, UiVectorAsset>;

/* ── Aliases — one intent DEFINED as another ─────────────────────────── */
/**
 * `key → key`. An alias is not "the same glyph today" (that is what two
 * registry keys sharing a value express, and they are FREE to diverge); an
 * alias says the first intent IS an instance of the second and should
 * follow it wherever it goes. The type forbids aliasing an alias, so the
 * bundled table never holds a chain — only a remote manifest can build one,
 * and the resolver bounds and cycle-checks those at runtime.
 *
 * The other job of this table is vocabulary renames: retire a key by
 * aliasing the old name to the new one for a release, migrate call sites,
 * delete the alias.
 */
export const UI_ICON_ALIASES = {
  /** The showcase gallery's grid toggle IS the generic list/grid toggle. */
  'gallery.grid': 'layout.grid',
  /** A client's visits, as the staff card lists them, ARE their reservations:
   *  if the client's own «Моите резервации» mark changes, this one follows. */
  'client.visits': 'account.reservations',
} as const satisfies Record<string, keyof typeof UI_ICON_REGISTRY>;

/**
 * The closed, type-safe icon vocabulary — `uiName` accepts ONLY these.
 * A typo'd or unregistered intent is a compile error at the call site.
 */
export type UiIconName =
  | keyof typeof UI_ICON_REGISTRY
  | keyof typeof UI_ICON_VECTORS
  | keyof typeof UI_ICON_ALIASES;

/**
 * Key grammar: `domain.action` or `domain.action.qualifier`, camelCase
 * segments, lower-case first letter. Dots mark semantic keys; a raw glyph
 * name never contains one, which is what lets the lint rules and the
 * runtime tell the two apart without a lookup.
 */
export const UI_ICON_KEY_PATTERN =
  /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,2}$/;

export function isUiIconName(value: unknown): value is UiIconName {
  return (
    typeof value === 'string' &&
    (value in UI_ICON_REGISTRY ||
      value in UI_ICON_VECTORS ||
      value in UI_ICON_ALIASES)
  );
}

/* ── The logo ────────────────────────────────────────────────────────── */
/**
 * The Creativo wordmark, as path data in `currentColor` — ONE asset that
 * follows the ink it sits in, where the old `logo-black.svg` /
 * `logo-white.svg` pair needed the header to pick a file. Geometry is the
 * 1920×419.82 artboard the files were drawn on; the two polygons became
 * closed paths.
 *
 * A future logo may be an `IMAGE` asset (raster, multi-colour) with a
 * separate `dark` variant — the manifest's logo shape carries both, and
 * `ui-logo` shows the one the active theme asks for.
 */
export const UI_LOGO: UiLogoEntry = {
  light: {
    iconAsset: UiIconAsset.Vector,
    viewBox: '0 0 1920 419.82',
    paths: [
      {
        d: 'M1715.83,69.24c-77.57,0-140.67,63.11-140.67,140.67s63.11,140.67,140.67,140.67,140.67-63.11,140.67-140.67-63.11-140.67-140.67-140.67ZM1715.83,303.69c-51.71,0-93.77-42.07-93.77-93.77s42.07-93.77,93.77-93.77,93.77,42.07,93.77,93.77-42.07,93.77-93.77,93.77Z',
      },
      {
        d: 'M937.63,69.24c-77.57,0-140.67,63.11-140.67,140.67s63.11,140.67,140.67,140.67c36,0,68.87-13.61,93.77-35.93v31.11h46.9v-133.47h-.06c.01-.8.06-1.58.06-2.38,0-77.57-63.11-140.67-140.67-140.67ZM937.63,303.69c-51.71,0-93.77-42.07-93.77-93.77s42.07-93.77,93.77-93.77,93.77,42.07,93.77,93.77-42.07,93.77-93.77,93.77Z',
      },
      { d: 'M1207.44 74.05L1322.55 345.77L1373.03 345.77L1257.92 74.05Z' },
      {
        d: 'M1544.52 74.05L1452.59 291.04L1360.66 74.05L1310.18 74.05L1425.29 345.77L1429.4 345.77L1475.77 345.77L1479.88 345.77L1595 74.05Z',
      },
      {
        d: 'M204.17,116.14c40.09,0,74.36,25.29,87.75,60.75h48.97c-14.9-61.68-70.53-107.65-136.72-107.65-77.57,0-140.67,63.11-140.67,140.67s63.11,140.67,140.67,140.67c66.19,0,121.82-45.97,136.72-107.65h-48.97c-13.39,35.46-47.67,60.75-87.75,60.75-51.71,0-93.77-42.07-93.77-93.77s42.07-93.77,93.77-93.77Z',
      },
      {
        d: 'M514.08,74.2c-10.02-2.78-20.41-4.19-30.89-4.19h-.42c-63.66,0-115.44,51.79-115.44,115.44v160.31h46.9v-160.31c0-37.8,30.75-68.54,68.54-68.54h.42c6.24,0,12.42.83,18.36,2.48l12.53-45.19Z',
      },
      {
        d: 'M1217.16,302.75h-.42c-37.8,0-68.54-30.75-68.54-68.54v-86.47h52.35l-19.85-46.9h-32.5v-26.77h-46.9v160.15c0,63.66,51.79,115.44,115.44,115.44h.42c10.48,0,20.87-1.41,30.89-4.18l-12.53-45.19c-5.94,1.64-12.11,2.48-18.36,2.48Z',
      },
      {
        d: 'M631.74,69.24c-77.57,0-140.67,63.11-140.67,140.67s63.11,140.67,140.67,140.67c55.36,0,103.33-32.16,126.28-78.77h-55.97c-17.19,19.51-42.32,31.87-70.31,31.87-51.71,0-93.77-42.07-93.77-93.77s42.07-93.77,93.77-93.77c43.61,0,80.37,29.93,90.8,70.32h-111.02l20.22,46.9,138.66.13c1.3-7.67,2.01-15.54,2.01-23.58,0-77.57-63.11-140.67-140.67-140.67Z',
      },
    ],
  },
};

/* ── The bundled manifest ────────────────────────────────────────────── */
/**
 * The three tables above as ONE manifest document — the same shape a
 * backend override arrives in, so the registry has exactly one merge and
 * one resolver for both.
 */
export const UI_BUNDLED_ICON_MANIFEST: UiIconManifest = {
  schemaVersion: UI_ICON_MANIFEST_SCHEMA_VERSION,
  icons: {
    ...Object.fromEntries(
      Object.entries(UI_ICON_REGISTRY).map(([key, glyph]) => [
        key,
        normalizeIconEntry(glyph),
      ]),
    ),
    ...UI_ICON_VECTORS,
    ...Object.fromEntries(
      Object.entries(UI_ICON_ALIASES).map(([key, alias]) => [key, { alias }]),
    ),
  },
  logo: UI_LOGO,
};

/** Every key the vocabulary knows — what a remote manifest may speak about. */
export const UI_ICON_NAMES: ReadonlySet<string> = new Set(
  Object.keys(UI_BUNDLED_ICON_MANIFEST.icons),
);
