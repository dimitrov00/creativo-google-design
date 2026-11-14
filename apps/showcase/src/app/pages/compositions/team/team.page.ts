import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { Role, type StaffLevel, StaffPermissions } from '@core/components';
import { AccessScope, StaffCapability } from '@core/primitives';
import {
  UiAvatar,
  UiAvatarGroup,
  UiButton,
  UiChoiceMenu,
  UiChoiceTiles,
  UiSwitch,
  UiTextField,
  type UiChoiceOption,
  type UiChoiceTile,
} from '@creativo/ui/controls';
import { UiIcon, type UiIconName } from '@creativo/ui/icons';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
} from '@creativo/ui/modifiers';
import {
  UI_SHEET_HEADLINE,
  UiListGroup,
  UiListRow,
  UiMenuTrigger,
  UiNotice,
  UiSectionHeader,
  UiSheetHeader,
} from '@creativo/ui/patterns';
import { ScPage } from '@showcase/shared/page';

/*
 * THE TEAM SCREENS, COMPOSED (staff permissions, stage T: "a prototype pass
 * first, with design-system elements only"). Seven stand-in screens at a
 * phone's width: the team list as the owner and as a content editor see it,
 * a member in preparation, the owner's own record, the add sheet, «Права»
 * and two of its level pages.
 *
 * The people are samples. The permissions are not: the level pages read and
 * write the real cells (`StaffPermissions` of `@core/components`), so the
 * grid, the defaults, which rows offer «Само своите» and how many changes a
 * level counts are the engine's own answers, not a drawing of them.
 */

/** One row of the team list. */
interface Member {
  readonly id: string;
  readonly name: string;
  readonly src: string | null;
  /** The quiet line under the name: the standing, then the one note. */
  readonly line: string;
}

/** One item a barber needs before anyone can book them. */
interface SetupItem {
  readonly id: string;
  readonly label: string;
  /** What is there, or the word that says nothing is. */
  readonly value: string;
  readonly done: boolean;
}

/** One permission row of a level's page. */
interface PermissionRow {
  readonly capability: StaffCapability;
  readonly label: string;
  /** The row is a switch: the cell offers no «Само своите». */
  readonly isSwitch: boolean;
  /** A switch's answer: the cell grants something. */
  readonly on: boolean;
  readonly scope: AccessScope;
  readonly scopeWord: string;
  readonly options: readonly UiChoiceOption[];
  /** The cell departs from the standard. */
  readonly changed: boolean;
  /** «Стандартно: Само своите» — said only under a changed row. */
  readonly standard: string;
  readonly menuId: string;
}

/** A group of permission rows, under its heading. */
interface PermissionGroup {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly PermissionRow[];
}

/** One row of «Права»: a level, who holds it, how far it departs. */
interface LevelRow {
  readonly level: StaffLevel;
  readonly name: string;
  readonly holders: string;
  readonly value: string;
}

const { None, Own, All } = AccessScope;

/**
 * The no-break space: inside a fact («31 дек.», «3 от 5») so it is one word
 * to the line breaker, and BEFORE a separator, so a quiet line that wraps
 * ends its first line on the «·».
 */
const NBSP = '\u00a0';

/** A quiet line of facts: each one word to the line breaker, «·» between. */
const lineOf = (...facts: readonly string[]): string =>
  facts.map((fact) => fact.replaceAll(' ', NBSP)).join(`${NBSP}· `);

/** The level's word, as «Роли» already words the roles. */
const LEVEL_WORDS: ReadonlyMap<StaffLevel, string> = new Map([
  [Role.Barber, 'Бръснар'],
  [Role.Receptionist, 'Рецепция'],
  [Role.ContentManager, 'Съдържание'],
]);

/** Who holds each level in the sample shop. */
const LEVEL_HOLDERS: ReadonlyMap<StaffLevel, string> = new Map([
  [Role.Barber, 'Иван, Георги, Мартин и още 1'],
  [Role.Receptionist, 'Елена'],
  [Role.ContentManager, 'Мария'],
]);

/** The three answers of a value row (P10). */
const SCOPE_WORDS: ReadonlyMap<AccessScope, string> = new Map([
  [None, 'Не'],
  [Own, 'Само своите'],
  [All, 'Всички'],
]);

/** A switch's two answers, said under a changed switch. */
const SWITCH_WORDS: ReadonlyMap<AccessScope, string> = new Map([
  [None, 'изключено'],
  [Own, 'изключено'],
  [All, 'включено'],
]);

/** The row label of each capability that exists (P10's table). */
const CAPABILITY_WORDS: ReadonlyMap<StaffCapability, string> = new Map([
  [StaffCapability.TimeOff, 'Блокира време'],
  [StaffCapability.Hours, 'Променя работното време'],
  [StaffCapability.Analytics, 'Вижда анализи'],
  [StaffCapability.TeamProfiles, 'Редактира профил на бръснар'],
  [StaffCapability.TeamOfferings, 'Определя услуги и цени'],
  [StaffCapability.TeamManage, 'Управлява екипа'],
]);

/** P2's groups, in the order a level's page reads. */
const GROUPS: readonly {
  readonly id: string;
  readonly title: string;
  readonly capabilities: readonly StaffCapability[];
}[] = [
  {
    id: 'schedule',
    title: 'График',
    capabilities: [StaffCapability.TimeOff, StaffCapability.Hours],
  },
  {
    id: 'analytics',
    title: 'Анализи',
    capabilities: [StaffCapability.Analytics],
  },
  {
    id: 'team',
    title: 'Екип',
    capabilities: [
      StaffCapability.TeamProfiles,
      StaffCapability.TeamOfferings,
      StaffCapability.TeamManage,
    ],
  },
];

const SCOPES: readonly AccessScope[] = [None, Own, All];

/** A word of one of the tables above; every key of a table has one. */
const wordOf = <K>(words: ReadonlyMap<K, string>, key: K): string =>
  words.get(key) ?? '';

/** What a cell grants when the owner has changed nothing. */
const standardOf = (
  level: StaffLevel,
  capability: StaffCapability,
): AccessScope =>
  StaffPermissions.scopeOf(StaffPermissions.UNSET, level, capability);

/** A sample portrait, by its number in the showcase's stock set. */
const face = (portrait: number): string =>
  `https://i.pravatar.cc/160?img=${portrait}`;

/** The barber whose page stands for one that takes bookings. */
const IVAN: Member = {
  id: 'ivan',
  name: 'Иван Петров',
  src: face(12),
  line: 'Приема записи',
};

/** The owner: an admin with no barber record, until «Това съм аз». */
const OWNER: Member = {
  id: 'owner',
  name: 'Александър Тодоров',
  src: face(11),
  line: 'Администратор',
};

@Component({
  selector: 'sc-team-composition-page',
  imports: [
    NgTemplateOutlet,
    ScPage,
    UiAvatar,
    UiAvatarGroup,
    UiButton,
    UiChoiceMenu,
    UiChoiceTiles,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiMenuTrigger,
    UiNotice,
    UiRadiusDirective,
    UiSectionHeader,
    UiSheetHeader,
    UiStack,
    UiSwitch,
    UiTextDirective,
    UiTextField,
    UiVisuallyHiddenDirective,
    ...UI_SHEET_HEADLINE,
  ],
  templateUrl: './team.page.html',
  styleUrl: './team.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeamCompositionPage {
  protected readonly Role = Role;
  protected readonly ivan = IVAN;
  protected readonly owner = OWNER;

  // ── the people ────────────────────────────────────────────────────────

  /** Barber records, in the shop's own order; a new one goes last. */
  protected readonly barbers: readonly Member[] = [
    IVAN,
    {
      id: 'georgi',
      name: 'Георги Димов',
      src: face(14),
      line: lineOf('Приема записи', 'Последен ден: 31 дек.'),
    },
    {
      id: 'martin',
      name: 'Мартин Колев',
      src: face(13),
      line: 'Само за екипа',
    },
    {
      id: 'nikolay',
      name: 'Николай Стоянов',
      src: null,
      line: lineOf('Подготовка', '3 от 5', 'Без профил в приложението'),
    },
  ];

  /** Accounts with a staff role and no barber record. */
  protected readonly others: readonly Member[] = [
    OWNER,
    { id: 'elena', name: 'Елена Василева', src: face(5), line: 'Рецепция' },
    { id: 'maria', name: 'Мария Ангелова', src: null, line: 'Съдържание' },
  ];

  /** Who holds «Рецепция»: the level page's faces. */
  protected readonly reception: readonly Member[] = this.others.filter(
    (member) => member.id === 'elena',
  );

  protected readonly departed: readonly Member[] = [
    {
      id: 'stefan',
      name: 'Стефан Илиев',
      src: face(15),
      line: lineOf('Напусна на 30 септ.'),
    },
  ];

  /**
   * What a content editor's list holds: the records, and no account — the
   * accounts are never read for that caller, so no row says «Без профил».
   */
  protected readonly records: readonly Member[] = this.barbers.map((member) =>
    member.id === 'nikolay'
      ? { ...member, line: lineOf('Подготовка', '3 от 5') }
      : member,
  );

  // ── a member in preparation ───────────────────────────────────────────

  /** The five items a barber needs before anyone can book them. */
  protected readonly setup: readonly SetupItem[] = [
    { id: 'name', label: 'Име', value: 'Николай Стоянов', done: true },
    { id: 'start', label: 'Начална дата', value: '1 дек.', done: true },
    { id: 'shops', label: 'Салон', value: 'Център', done: true },
    { id: 'offerings', label: 'Услуги и цени', value: 'Няма', done: false },
    { id: 'hours', label: 'Работно време', value: 'Няма', done: false },
  ];

  protected setupGlyph(item: SetupItem): UiIconName {
    return item.done ? 'checklist.done' : 'checklist.pending';
  }

  /** «Това съм аз»: the owner links their own account to a record. */
  protected readonly isMe = signal(false);

  /** «Приема „Който и да е“» on the owner's own record. */
  protected readonly inPool = signal(true);

  // ── the add sheet ─────────────────────────────────────────────────────

  protected readonly presets: readonly UiChoiceTile[] = [
    { id: 'barber', label: 'Бръснар', detail: 'Приема записи' },
    { id: 'student', label: 'Курсист', detail: 'Само за екипа' },
    { id: 'guest', label: 'Гост', detail: 'За няколко дни' },
  ];
  protected readonly preset = signal('barber');

  protected readonly copyOptions: readonly UiChoiceOption[] = [
    { id: 'none', label: 'Без' },
    { id: 'ivan', label: 'Иван Петров', avatarSrc: face(12) },
    { id: 'georgi', label: 'Георги Димов', avatarSrc: face(14) },
    { id: 'martin', label: 'Мартин Колев', avatarSrc: face(13) },
  ];
  protected readonly copyFrom = signal('none');
  protected readonly copyLabel = computed(
    () =>
      this.copyOptions.find((option) => option.id === this.copyFrom())?.label ??
      '',
  );

  // ── the permissions: the real cells ───────────────────────────────────

  /** What the shop has saved: two departures on «Бръснар». */
  protected readonly stored = signal(
    StaffPermissions.read({
      barberTimeOffScope: All,
      barberTeamOfferingsScope: Own,
    }),
  );

  /** What the owner is editing; «Запази» makes it the saved one. */
  protected readonly draft = signal(this.stored());

  /** The one open menu: a level and a capability, or none. */
  protected readonly openMenu = signal<string | null>(null);

  /** «Правата са запазени» — the receipt, in the stand-in's own place. */
  protected readonly receipt = signal(false);

  protected readonly levels = computed<readonly LevelRow[]>(() =>
    StaffPermissions.LEVELS.map((level) => {
      const changes = this.changesOf(this.stored(), level);
      return {
        level,
        name: wordOf(LEVEL_WORDS, level),
        holders: wordOf(LEVEL_HOLDERS, level),
        value: changes === 0 ? 'Стандартни' : this.changesWord(changes),
      };
    }),
  );

  /** The «Права» row of the team list: how far the shop is from the standard. */
  protected readonly accessValue = computed(() => {
    const cells = this.stored();
    const changes = StaffPermissions.LEVELS.reduce(
      (sum, level) => sum + this.changesOf(cells, level),
      0,
    );
    return changes === 0 ? 'Стандартни' : this.changesWord(changes);
  });

  /** How far «Бръснар» departs: the live member's way to their level. */
  protected readonly barberValue = computed(() => {
    const changes = this.changesOf(this.stored(), Role.Barber);
    return changes === 0 ? 'Стандартни' : this.changesWord(changes);
  });

  protected readonly barberGroups = computed(() =>
    this.groupsOf(Role.Barber, this.draft()),
  );
  protected readonly receptionGroups = computed(() =>
    this.groupsOf(Role.Receptionist, this.draft()),
  );

  /** The draft differs from the saved cells: the dock holds «Запази». */
  protected readonly dirty = computed(() => {
    const draft = this.draft();
    const stored = this.stored();
    return StaffPermissions.LEVELS.some((level) =>
      StaffPermissions.CAPABILITIES.some(
        (capability) =>
          StaffPermissions.scopeOf(draft, level, capability) !==
          StaffPermissions.scopeOf(stored, level, capability),
      ),
    );
  });

  protected levelName(level: StaffLevel): string {
    return wordOf(LEVEL_WORDS, level);
  }

  /** A level departs from the standard: «Върни стандартните» has work to do. */
  protected departs(level: StaffLevel): boolean {
    return this.changesOf(this.draft(), level) > 0;
  }

  protected pick(
    level: StaffLevel,
    capability: StaffCapability,
    scope: string,
  ): void {
    const accessScope = SCOPES.find((candidate) => candidate === scope);
    if (accessScope === undefined) return;
    if (!StaffPermissions.offers(level, capability, accessScope)) return;
    this.receipt.set(false);
    this.draft.update((cells) =>
      StaffPermissions.saved(
        cells,
        new Map([[StaffPermissions.fieldOf(level, capability), accessScope]]),
      ),
    );
  }

  protected toggle(
    level: StaffLevel,
    capability: StaffCapability,
    on: boolean,
  ): void {
    this.pick(level, capability, on ? All : None);
  }

  /** «Върни стандартните»: every cell of the level back to its default. */
  protected restore(level: StaffLevel): void {
    this.receipt.set(false);
    this.draft.update((cells) =>
      StaffPermissions.saved(
        cells,
        new Map(
          StaffPermissions.CAPABILITIES.map((capability) => [
            StaffPermissions.fieldOf(level, capability),
            standardOf(level, capability),
          ]),
        ),
      ),
    );
  }

  protected save(): void {
    this.stored.set(this.draft());
    this.receipt.set(true);
  }

  private changesOf(cells: StaffPermissions, level: StaffLevel): number {
    return StaffPermissions.CAPABILITIES.filter(
      (capability) =>
        StaffPermissions.scopeOf(cells, level, capability) !==
        standardOf(level, capability),
    ).length;
  }

  /** «1 промяна · 2 промени» — the count a level's row carries. */
  private changesWord(count: number): string {
    return count === 1 ? '1 промяна' : `${count} промени`;
  }

  private groupsOf(
    level: StaffLevel,
    cells: StaffPermissions,
  ): readonly PermissionGroup[] {
    return GROUPS.map((group) => ({
      id: group.id,
      title: group.title,
      rows: group.capabilities.map((capability): PermissionRow => {
        const scope = StaffPermissions.scopeOf(cells, level, capability);
        const standard = standardOf(level, capability);
        const offered = SCOPES.filter((candidate) =>
          StaffPermissions.offers(level, capability, candidate),
        );
        const isSwitch = !offered.includes(Own);
        return {
          capability,
          label: wordOf(CAPABILITY_WORDS, capability),
          isSwitch,
          on: scope !== None,
          scope,
          scopeWord: wordOf(SCOPE_WORDS, scope),
          options: offered.map((candidate) => ({
            id: candidate,
            label: wordOf(SCOPE_WORDS, candidate),
            testId: `composition-scope-${level}-${capability}-${candidate}`,
          })),
          changed: scope !== standard,
          standard: `Стандартно: ${wordOf(
            isSwitch ? SWITCH_WORDS : SCOPE_WORDS,
            standard,
          )}`,
          menuId: `${level}-${capability}`,
        };
      }),
    }));
  }
}
