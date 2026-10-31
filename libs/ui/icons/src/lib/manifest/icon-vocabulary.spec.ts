import { MATERIAL_GLYPHS } from '../material/material-glyphs.generated';
import { hasMaterialGlyph } from '../material/material';
import { parseUiIconManifest } from './icon-manifest-parser';
import {
  UI_BUNDLED_ICON_MANIFEST,
  UI_ICON_ALIASES,
  UI_ICON_KEY_PATTERN,
  UI_ICON_NAMES,
  UI_ICON_REGISTRY,
  UI_ICON_VECTORS,
  UI_LOGO,
} from './icon-vocabulary';

describe('the bundled vocabulary', () => {
  it('names every key in the domain.action grammar', () => {
    for (const key of UI_ICON_NAMES) {
      expect(key, key).toMatch(UI_ICON_KEY_PATTERN);
    }
  });

  it('keeps every registry value a plain glyph name (dots mark semantic keys)', () => {
    for (const [key, glyph] of Object.entries(UI_ICON_REGISTRY)) {
      expect(glyph, key).toMatch(/^[a-z0-9_]+$/);
    }
  });

  /**
   * Every Material glyph the vocabulary names must be in the GENERATED
   * table. This replaces the old check against the icon font's `index.d.ts`
   * and catches the same class of defect — `staff.day` once shipped as
   * `contact_calendar`, a name newer than the pinned font, and the menu row
   * rendered "CONTACT_CALENDAR" in capitals. Now the generator refuses an
   * unknown name and this test refuses a stale table.
   */
  it('has generated path data for every Material glyph it names', () => {
    // Guard the guard: an empty table would pass vacuously.
    expect(Object.keys(MATERIAL_GLYPHS).length).toBeGreaterThan(50);
    const missing = Object.entries(UI_ICON_REGISTRY)
      .filter(([, glyph]) => !hasMaterialGlyph(glyph))
      .map(([key, glyph]) => `${key} → ${glyph}`);
    expect(missing).toEqual([]);
  });

  it('carries no glyph the vocabulary stopped naming (table not stale the other way)', () => {
    const named = new Set(Object.values(UI_ICON_REGISTRY));
    const orphaned = Object.keys(MATERIAL_GLYPHS).filter(
      (glyph) => !named.has(glyph as never),
    );
    expect(orphaned).toEqual([]);
  });

  it('points every alias at a concrete (non-alias) key, and no key lives in two tables', () => {
    for (const [key, target] of Object.entries(UI_ICON_ALIASES)) {
      expect(target in UI_ICON_REGISTRY || target in UI_ICON_VECTORS, key).toBe(
        true,
      );
      expect(target in UI_ICON_ALIASES, key).toBe(false);
      expect(key in UI_ICON_REGISTRY, key).toBe(false);
      expect(key in UI_ICON_VECTORS, key).toBe(false);
    }
    for (const key of Object.keys(UI_ICON_VECTORS)) {
      expect(key in UI_ICON_REGISTRY, key).toBe(false);
    }
  });

  it('is itself a valid manifest under the remote validator', () => {
    const { manifest, issues } = parseUiIconManifest(UI_BUNDLED_ICON_MANIFEST, {
      knownKeys: UI_ICON_NAMES,
      hasGlyph: hasMaterialGlyph,
    });
    expect(issues).toEqual([]);
    expect(Object.keys(manifest?.icons ?? {}).length).toBe(UI_ICON_NAMES.size);
    expect(manifest?.logo).toEqual(UI_LOGO);
  });
});

/**
 * The staff client card's keys, pinned one by one
 * (docs/design-research/client-card-redesign.md §8.2).
 *
 * The card lib maps two closed domain unions onto this table with no
 * fallback — `BadgeEmblem` onto `loyalty.badge.*`, `BadgeCategoryKind` onto
 * `loyalty.category.*` — so a key renamed, dropped or added here has to fail
 * in this file, not as a blank medal on a client's card. The unions live in
 * the engagement domain, which this library may not import; the two lists
 * below are their mirror and move with them.
 */
describe('the client card vocabulary', () => {
  const registry = new Map<string, string>(Object.entries(UI_ICON_REGISTRY));

  const BADGE_EMBLEM_GLYPHS = {
    visits: 'flag',
    streak: 'event_repeat',
    referral: 'group_add',
    selfService: 'touch_app',
    birthday: 'cake',
    welcome: 'waving_hand',
    service: 'content_cut',
    barber: 'person_heart',
    shop: 'storefront',
    anniversary: 'hotel_class',
    earlyBird: 'wb_twilight',
    weekend: 'weekend',
    onTime: 'alarm_on',
    waitlist: 'notifications_active',
    profile: 'person_check',
    party: 'group',
    explorer: 'explore',
    yearRound: 'cycle',
    comeback: 'u_turn_left',
    event: 'celebration',
    summer: 'sunny',
    autumn: 'eco',
    vacation: 'luggage',
    sailing: 'sailing',
    icecream: 'icecream',
    umbrella: 'umbrella',
    fog: 'foggy',
    handshake: 'handshake',
    grooming: 'self_care',
    beardOil: 'health_and_beauty',
    spa: 'spa',
  } as const;

  const CATEGORY_GLYPHS = {
    milestones: 'signpost',
    mastery: 'design_services',
    barbers: 'groups',
    rhythm: 'timeline',
    special: 'star_shine',
    records: 'trophy',
  } as const;

  const GLYPHS: Readonly<Record<string, string>> = {
    'contact.phone': 'call',
    'contact.sms': 'sms',
    'contact.viber': 'forum',
    'client.remove': 'person_remove',
    'client.photos': 'photo_library',
    'client.export': 'receipt_long',
    'client.erase': 'delete',
    'connection.offline': 'cloud_off',
    'loyalty.program': 'loyalty',
    'loyalty.points': 'stars',
    'loyalty.freeze': 'ac_unit',
    'loyalty.tier': 'workspace_premium',
    'loyalty.reward': 'redeem',
    'loyalty.locked': 'lock',
    'loyalty.stampCard': 'approval',
    'loyalty.ledger': 'receipt_long',
    'loyalty.badge': 'military_tech',
    'loyalty.soon': 'hourglass_top',
    'loyalty.latest': 'history',
    'loyalty.season': 'calendar_clock',
    'loyalty.event': 'festival',
    'loyalty.archive': 'inventory_2',
    ...Object.fromEntries(
      Object.entries(CATEGORY_GLYPHS).map(([kind, glyph]) => [
        `loyalty.category.${kind}`,
        glyph,
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(BADGE_EMBLEM_GLYPHS).map(([emblem, glyph]) => [
        `loyalty.badge.${emblem}`,
        glyph,
      ]),
    ),
  };

  const keysUnder = (prefix: string) =>
    [...registry.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort();

  it('registers every key with the glyph the design settled on', () => {
    const drift = Object.entries(GLYPHS)
      .filter(([key, glyph]) => registry.get(key) !== glyph)
      .map(
        ([key, glyph]) =>
          `${key}: expected ${glyph}, got ${registry.get(key) ?? 'nothing'}`,
      );
    expect(drift).toEqual([]);
  });

  it('keeps exactly one emblem key per BadgeEmblem and one shelf key per BadgeCategoryKind', () => {
    expect(keysUnder('loyalty.badge.')).toEqual(
      Object.keys(BADGE_EMBLEM_GLYPHS).sort(),
    );
    expect(keysUnder('loyalty.category.')).toEqual(
      Object.keys(CATEGORY_GLYPHS).sort(),
    );
  });

  /**
   * One face per emblem (wave D r6): two emblems on one glyph would put
   * two families on one disc whatever the catalogue does — the seasons of
   * the year and the seasonal families' own emblems included.
   */
  it('draws every emblem with a glyph of its own', () => {
    const glyphs = [...registry]
      .filter(([key]) => key.startsWith('loyalty.badge.'))
      .map(([, glyph]) => glyph);
    expect(glyphs.length).toBe(Object.keys(BADGE_EMBLEM_GLYPHS).length);
    expect(glyphs.filter((glyph, i) => glyphs.indexOf(glyph) !== i)).toEqual(
      [],
    );
  });

  /**
   * A shelf heading never wears a medal's face. When `category.milestones`
   * and `badge.visits` were both `flag` (and rhythm/streak, barbers/barber,
   * mastery/service likewise), each heading cloned the first medal under it
   * and every art-less medal of that family on other shelves. Read from the
   * live registry, not the mirror above, so a later edit cannot slip past.
   */
  it('gives the shelf headings glyphs no medal emblem uses, one per shelf', () => {
    const glyphsUnder = (prefix: string) =>
      [...registry]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, glyph]) => glyph);
    const shelves = glyphsUnder('loyalty.category.');
    const emblems = new Set(glyphsUnder('loyalty.badge.'));
    // Guard the guard: empty sets would pass vacuously.
    expect(shelves.length).toBe(Object.keys(CATEGORY_GLYPHS).length);
    expect(emblems.size).toBeGreaterThan(10);
    expect(shelves.filter((glyph) => emblems.has(glyph))).toEqual([]);
    expect(new Set(shelves).size).toBe(shelves.length);
  });

  /**
   * Nor does any other heading of the achievements and loyalty pages
   * (wave D r4): «Есен 2026» wore `award_star` over the season track medal
   * drawn with it, «Събития» the event medals' `celebration`, and the
   * «Лоялност» page's «Ритъм» the «В ритъм» medal's `event_repeat` — while
   * the achievements «Ритъм» shelf wore `timeline`, two glyphs for one name.
   */
  it('keeps every page heading off the medal emblems, and «Ритъм» to one glyph', () => {
    const emblems = new Set(
      [...registry]
        .filter(([key]) => key.startsWith('loyalty.badge.'))
        .map(([, glyph]) => glyph),
    );
    const headings = [
      'loyalty.soon',
      'loyalty.latest',
      'loyalty.season',
      'loyalty.event',
      'loyalty.archive',
      ...Object.keys(CATEGORY_GLYPHS).map((kind) => `loyalty.category.${kind}`),
    ].map((key) => [key, registry.get(key)] as const);
    expect(headings.every(([, glyph]) => glyph !== undefined)).toBe(true);
    expect(
      headings.filter(([, glyph]) => glyph !== undefined && emblems.has(glyph)),
    ).toEqual([]);
    expect(new Set(headings.map(([, glyph]) => glyph)).size).toBe(
      headings.length,
    );
    for (const season of ['summer', 'autumn']) {
      expect(registry.get('loyalty.season')).not.toBe(
        registry.get(`loyalty.badge.${season}`),
      );
    }
    expect(registry.get('loyalty.event')).not.toBe(
      registry.get('loyalty.badge.event'),
    );
    // The rhythm programme has no heading key of its own: its section is
    // the rhythm shelf's (`loyalty.category.rhythm`).
    expect(registry.has('loyalty.streak')).toBe(false);
  });

  it("defines a client's visits AS their reservations (an alias, not a copy)", () => {
    expect(UI_ICON_ALIASES['client.visits']).toBe('account.reservations');
    expect(registry.has('client.visits')).toBe(false);
  });

  it('tells SMS and Viber apart by shape, not by caption', () => {
    expect(registry.get('contact.sms')).not.toBe(registry.get('contact.viber'));
  });

  it('never reaches for a banned mark: no padlock on a medal, no flame, no crown', () => {
    const loyalty = [...registry].filter(([key]) => key.startsWith('loyalty.'));
    const padlockedMedals = loyalty
      .filter(
        ([key, glyph]) => key.startsWith('loyalty.badge.') && glyph === 'lock',
      )
      .map(([key]) => key);
    expect(padlockedMedals).toEqual([]);
    const banned = new Set(['local_fire_department', 'crown', 'auto_awesome']);
    expect(loyalty.filter(([, glyph]) => banned.has(glyph))).toEqual([]);
  });
});
