import {
  AccessScope,
  StaffCapability,
  StoredFields,
  Tag,
} from '@core/primitives';
import { Role } from './role.data';

/**
 * A staff level whose cells the owner edits (staff permissions P1): the
 * barbers, the front desk and the content editors. `admin` has everything,
 * always, and `sysadmin` — the vendor's support role — a fixed column, so
 * neither has a cell; `client` is a role and no level.
 */
export type StaffLevel =
  typeof Role.Barber | typeof Role.Receptionist | typeof Role.ContentManager;

/**
 * WHAT EACH STAFF LEVEL MAY DO, AS THE OWNER SET IT
 * (`docs/designs/staff-permissions.md`, P5) — the cells of
 * `settings/staffPermissions`: one root field per editable level and
 * capability, `<level><Capability>Scope`, holding how far that capability
 * reaches for the level, or `null` when the cell follows the code's
 * default ({@link StaffPermissions.DEFAULT}).
 *
 * A pattern and its departures (Law 5): the defaults are code, the
 * document holds only what the owner changed. Every name is fixed at
 * design time — no dynamic keys, no arrays. A capability enters with the
 * stage that enforces it (P13), which adds its three fields; a document
 * written before has no such field, and that reads as `null`.
 */
export type StaffPermissions = {
  readonly barberTimeOffScope: AccessScope | null;
  readonly barberHoursScope: AccessScope | null;
  readonly barberAnalyticsScope: AccessScope | null;
  readonly barberTeamProfilesScope: AccessScope | null;
  readonly barberTeamOfferingsScope: AccessScope | null;
  readonly barberTeamManageScope: AccessScope | null;
  readonly receptionistTimeOffScope: AccessScope | null;
  readonly receptionistHoursScope: AccessScope | null;
  readonly receptionistAnalyticsScope: AccessScope | null;
  readonly receptionistTeamProfilesScope: AccessScope | null;
  readonly receptionistTeamOfferingsScope: AccessScope | null;
  readonly receptionistTeamManageScope: AccessScope | null;
  readonly contentManagerTimeOffScope: AccessScope | null;
  readonly contentManagerHoursScope: AccessScope | null;
  readonly contentManagerAnalyticsScope: AccessScope | null;
  readonly contentManagerTeamProfilesScope: AccessScope | null;
  readonly contentManagerTeamOfferingsScope: AccessScope | null;
  readonly contentManagerTeamManageScope: AccessScope | null;
};

/** One value per level and capability — a table total over both dictionaries. */
type CellTable<V> = {
  readonly [L in StaffLevel]: { readonly [C in StaffCapability]: V };
};

const { Barber, Receptionist, ContentManager } = Role;
const { TimeOff, Hours, Analytics, TeamProfiles, TeamOfferings, TeamManage } =
  StaffCapability;
const { None, Own, All } = AccessScope;

/** The editable levels, in the editor's order. */
const LEVELS: readonly StaffLevel[] = [Barber, Receptionist, ContentManager];

/** THE FIELD NAMES, spelled once: which root field holds a level's cell for a capability. */
const FIELDS: CellTable<keyof StaffPermissions> = {
  [Barber]: {
    [TimeOff]: 'barberTimeOffScope',
    [Hours]: 'barberHoursScope',
    [Analytics]: 'barberAnalyticsScope',
    [TeamProfiles]: 'barberTeamProfilesScope',
    [TeamOfferings]: 'barberTeamOfferingsScope',
    [TeamManage]: 'barberTeamManageScope',
  },
  [Receptionist]: {
    [TimeOff]: 'receptionistTimeOffScope',
    [Hours]: 'receptionistHoursScope',
    [Analytics]: 'receptionistAnalyticsScope',
    [TeamProfiles]: 'receptionistTeamProfilesScope',
    [TeamOfferings]: 'receptionistTeamOfferingsScope',
    [TeamManage]: 'receptionistTeamManageScope',
  },
  [ContentManager]: {
    [TimeOff]: 'contentManagerTimeOffScope',
    [Hours]: 'contentManagerHoursScope',
    [Analytics]: 'contentManagerAnalyticsScope',
    [TeamProfiles]: 'contentManagerTeamProfilesScope',
    [TeamOfferings]: 'contentManagerTeamOfferingsScope',
    [TeamManage]: 'contentManagerTeamManageScope',
  },
};

/**
 * THE DEFAULTS (P2) — what each level may do until the owner says
 * otherwise. They keep the behaviour the fixed role lists gave before the
 * cells existed (O1): a barber edits their own hours, days and profile and
 * reads their own numbers; the front desk edits anyone's hours and days;
 * the content editor edits anyone's profile; nobody but the owner sets
 * prices or manages the team.
 */
const DEFAULT: CellTable<AccessScope> = {
  [Barber]: {
    [TimeOff]: Own,
    [Hours]: Own,
    [Analytics]: Own,
    [TeamProfiles]: Own,
    [TeamOfferings]: None,
    [TeamManage]: None,
  },
  [Receptionist]: {
    [TimeOff]: All,
    [Hours]: All,
    [Analytics]: None,
    [TeamProfiles]: None,
    [TeamOfferings]: None,
    [TeamManage]: None,
  },
  [ContentManager]: {
    [TimeOff]: None,
    [Hours]: None,
    [Analytics]: None,
    [TeamProfiles]: All,
    [TeamOfferings]: None,
    [TeamManage]: None,
  },
};

/**
 * The vendor's `sysadmin`, FIXED per capability and never editable (P1):
 * a support role works the book — hours and days — and has no business in
 * the shop's numbers, its public pages or its team.
 */
const SYSADMIN: { readonly [C in StaffCapability]: AccessScope } = {
  [TimeOff]: All,
  [Hours]: All,
  [Analytics]: None,
  [TeamProfiles]: None,
  [TeamOfferings]: None,
  [TeamManage]: None,
};

/**
 * Whether a capability can be held for one's own barber record only (P2,
 * "Values"): hours, days, numbers, a profile and a price list each belong
 * to a barber; managing the team is a plain switch.
 */
const OWNABLE: { readonly [C in StaffCapability]: boolean } = {
  [TimeOff]: true,
  [Hours]: true,
  [Analytics]: true,
  [TeamProfiles]: true,
  [TeamOfferings]: true,
  [TeamManage]: false,
};

/** Every cell, built from one answer per level and capability — the ONE place a whole struct is assembled. */
function cellsOf(
  cell: (level: StaffLevel, capability: StaffCapability) => AccessScope | null,
): StaffPermissions {
  return {
    barberTimeOffScope: cell(Barber, TimeOff),
    barberHoursScope: cell(Barber, Hours),
    barberAnalyticsScope: cell(Barber, Analytics),
    barberTeamProfilesScope: cell(Barber, TeamProfiles),
    barberTeamOfferingsScope: cell(Barber, TeamOfferings),
    barberTeamManageScope: cell(Barber, TeamManage),
    receptionistTimeOffScope: cell(Receptionist, TimeOff),
    receptionistHoursScope: cell(Receptionist, Hours),
    receptionistAnalyticsScope: cell(Receptionist, Analytics),
    receptionistTeamProfilesScope: cell(Receptionist, TeamProfiles),
    receptionistTeamOfferingsScope: cell(Receptionist, TeamOfferings),
    receptionistTeamManageScope: cell(Receptionist, TeamManage),
    contentManagerTimeOffScope: cell(ContentManager, TimeOff),
    contentManagerHoursScope: cell(ContentManager, Hours),
    contentManagerAnalyticsScope: cell(ContentManager, Analytics),
    contentManagerTeamProfilesScope: cell(ContentManager, TeamProfiles),
    contentManagerTeamOfferingsScope: cell(ContentManager, TeamOfferings),
    contentManagerTeamManageScope: cell(ContentManager, TeamManage),
  };
}

/** Every cell following its default — what no document reads as. */
const UNSET: StaffPermissions = cellsOf(() => null);

/** Whether a cell offers a scope: nobody and everyone always; "own" on the barber level, for a capability a barber can own. */
function offers(
  level: StaffLevel,
  capability: StaffCapability,
  accessScope: AccessScope,
): boolean {
  return accessScope !== Own || (level === Barber && OWNABLE[capability]);
}

export const StaffPermissions = {
  /** The editable levels, in the editor's order. */
  LEVELS,
  /** Every capability, dictionary order — derived, never a second source. */
  CAPABILITIES: Tag.values(StaffCapability),
  DEFAULT,
  SYSADMIN,
  /** Every cell following its default — no document, or one the owner never changed. */
  UNSET,

  /** The edge guard for an untrusted level — a wire scalar, a stored role. */
  isLevel(value: unknown): value is StaffLevel {
    return (
      value === Barber || value === Receptionist || value === ContentManager
    );
  },

  /** The root field that holds a level's cell for a capability. */
  fieldOf(
    level: StaffLevel,
    capability: StaffCapability,
  ): keyof StaffPermissions {
    return FIELDS[level][capability];
  },

  offers,

  /**
   * THE READING GUARD (P5) — a stored `settings/staffPermissions` body as
   * cells. It never fails, and `firestore.rules` gives the same answers:
   *
   * - no document, no such field, or `null` → `null`: the cell follows the
   *   default;
   * - a scope the cell offers → that scope;
   * - anything else — an unknown string, a number, a list, "own" where it
   *   is not offered — → `NONE`. A value the system cannot read grants
   *   nothing (O11); falling back to the default would quietly hand back
   *   what an owner had taken away. Only a hand edit can produce one.
   */
  read(raw: unknown): StaffPermissions {
    return cellsOf((level, capability) => {
      const stored = StoredFields.field(raw, FIELDS[level][capability]);
      if (stored === undefined || stored === null) return null;
      return Tag.has(AccessScope, stored) && offers(level, capability, stored)
        ? stored
        : None;
    });
  },

  /** How far a capability reaches for one level: the owner's cell, or the default it follows. */
  scopeOf(
    permissions: StaffPermissions,
    level: StaffLevel,
    capability: StaffCapability,
  ): AccessScope {
    return permissions[FIELDS[level][capability]] ?? DEFAULT[level][capability];
  },

  /**
   * The cells after a save: each cell `wanted` names takes its scope and
   * every other stays as it was — and any cell that then equals its
   * default is stored as `null`, so the document holds only what departs
   * from the code (P5), a hand-written redundant value included.
   */
  saved(
    permissions: StaffPermissions,
    wanted: ReadonlyMap<keyof StaffPermissions, AccessScope>,
  ): StaffPermissions {
    return cellsOf((level, capability) => {
      const field = FIELDS[level][capability];
      const scope = wanted.get(field) ?? permissions[field];
      return scope === DEFAULT[level][capability] ? null : scope;
    });
  },
} as const;
