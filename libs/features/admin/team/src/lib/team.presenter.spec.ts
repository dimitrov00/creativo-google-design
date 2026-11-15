import { describe, expect, it } from 'vitest';
import { Role, type StaffLevel, StaffPermissions } from '@core/components';
import {
  AccessScope,
  BarberId,
  Locale,
  StaffCapability,
} from '@core/primitives';
import { TeamRosterSystem } from '@core/systems';
import { deepFreeze, localDate } from '@core/testing';
import { catalogueTranslate } from './catalogue.spec-support';
import {
  ELENA,
  GEORGI,
  IVAN,
  MARIA,
  NIKOLAY,
  OWNER,
  RECORDS,
  STEFAN,
  TEAM,
} from './team.fixtures.spec-support';
import {
  levelPageVm,
  levelsVm,
  teamAddMenuVm,
  teamPageVm,
} from './team.presenter';
import { TeamRun } from './team.vm';
import { teamWordsOf } from './team.words';

/*
 * The Team screens' presenters (Law 10): their words, pinned in both
 * languages from fixed inputs and the app's real catalogue.
 */

const BG = teamWordsOf(catalogueTranslate('bg'));
const EN = teamWordsOf(catalogueTranslate('en'));
const TODAY = localDate('2026-11-14');
const NBSP = ' ';
const { None, Own, All } = AccessScope;

/** A quiet line as it is read: the no-break spaces as plain ones. */
const read = (line: string): string => line.replaceAll(NBSP, ' ');

const page = (
  members = TEAM,
  over: Partial<Parameters<typeof teamPageVm>[0]> = {},
) =>
  teamPageVm({
    sections: TeamRosterSystem.sectionsOf(members),
    managesTeam: true,
    avatars: new Map([[BarberId.of('ivan'), 'https://example.test/ivan.jpg']]),
    words: BG,
    locale: Locale.Bg,
    today: TODAY,
    ...over,
  });

describe('teamPageVm — the Team list', () => {
  it('words the three runs in the list’s order, each row a name over one quiet line', () => {
    const vm = page();
    expect(vm.lede).toBe('Хората в екипа и как стои всеки.');
    expect(vm.runs.map((run) => [run.teamRun, run.title])).toEqual([
      [TeamRun.Barbers, 'Бръснари'],
      [TeamRun.Others, 'Още в екипа'],
      [TeamRun.Departed, 'Напуснали'],
    ]);
    const lines = vm.runs.map((run) =>
      run.rows.map((row) => [row.name, read(row.line)]),
    );
    expect(lines).toEqual([
      [
        ['Иван Петров', 'Приема записи'],
        ['Георги Димов', 'Приема записи · Последен ден: 31.12'],
        ['Мартин Колев', 'Само за екипа'],
        ['Николай Стоянов', 'Подготовка · 3 от 5 · Без профил в приложението'],
      ],
      [
        ['Александър Тодоров', 'Администратор'],
        ['Елена Василева', 'Рецепция'],
        // A client's role is no staff level: it is not named.
        ['Мария Ангелова', 'Съдържание'],
      ],
      [['Стефан Илиев', 'Напусна на 30.09']],
    ]);
  });

  it('keeps each fact one word to the line breaker, the «·» on the line it ends', () => {
    const row = page().runs[0]?.rows[1];
    expect(row?.line).toBe(
      `Приема${NBSP}записи${NBSP}· Последен${NBSP}ден:${NBSP}31.12`,
    );
  });

  it('says a day’s year only outside the shop’s today’s, and always while today is unknown', () => {
    const leaver = (today: Parameters<typeof teamPageVm>[0]['today']) =>
      read(page([STEFAN], { today }).runs[0]?.rows[0]?.line ?? '');
    expect(leaver(TODAY)).toBe('Напусна на 30.09');
    expect(leaver(localDate('2027-01-02'))).toBe('Напусна на 30.09.2026 г.');
    expect(leaver(null)).toBe('Напусна на 30.09.2026 г.');
  });

  it('a leaver with no last day on record says only that they left', () => {
    const vm = page([{ ...STEFAN, barberLastWorkingLocalDate: null }]);
    expect(vm.runs[0]?.rows[0]?.line).toBe('Напусна');
  });

  it('gives a record its portrait where the catalogue has one, and a row its test id', () => {
    const rows = page().runs[0]?.rows ?? [];
    expect(rows[0]?.avatarSrc).toBe('https://example.test/ivan.jpg');
    expect(rows[1]?.avatarSrc).toBeNull();
    expect(rows[0]?.testId).toBe('team-member-ivan');
    expect(page().runs[1]?.rows[0]?.testId).toBe('team-member-u-owner');
    // A row leads to a record's page or to an account's, never both.
    expect([rows[0]?.barberId, rows[0]?.accountUserId]).toEqual(['ivan', null]);
    expect([
      page().runs[1]?.rows[0]?.barberId,
      page().runs[1]?.rows[0]?.accountUserId,
    ]).toEqual([null, 'u-owner']);
  });

  it('for someone who reaches the records alone: the profiles’ lede, no accounts and no note about one', () => {
    const vm = page(RECORDS, { managesTeam: false });
    expect(vm.lede).toBe('Профилите на бръснарите.');
    expect(vm.runs.map((run) => run.teamRun)).toEqual([
      TeamRun.Barbers,
      TeamRun.Departed,
    ]);
    expect(read(vm.runs[0]?.rows[3]?.line ?? '')).toBe('Подготовка · 3 от 5');
  });

  it('leaves an empty run out — an empty shop has no runs at all', () => {
    expect(page([IVAN, ELENA]).runs.map((run) => run.teamRun)).toEqual([
      TeamRun.Barbers,
      TeamRun.Others,
    ]);
    expect(page([]).runs).toEqual([]);
  });

  it('words the same rows in English', () => {
    const vm = page(TEAM, { words: EN, locale: Locale.En });
    expect(vm.lede).toBe('Everyone on the team and where each one stands.');
    expect(vm.runs.map((run) => run.title)).toEqual([
      'Barbers',
      'Also on the team',
      'Left',
    ]);
    expect(vm.runs[0]?.rows.map((row) => [row.name, read(row.line)])).toEqual([
      ['Ivan Petrov', 'Taking bookings'],
      ['Georgi Dimov', 'Taking bookings · Last day: Dec 31'],
      ['Martin Kolev', 'Team only'],
      ['Nikolay Stoyanov', 'Setting up · 3 of 5 · No account in the app'],
    ]);
    expect(vm.runs[1]?.rows.map((row) => row.line)).toEqual([
      'Admin',
      'Front desk',
      'Content',
    ]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const input = deepFreeze({
      sections: TeamRosterSystem.sectionsOf(TEAM),
      managesTeam: true,
      avatars: new Map<BarberId, string | null>(),
      words: BG,
      locale: Locale.Bg,
      today: TODAY,
    });
    expect(teamPageVm(input)).toEqual(teamPageVm(input));
  });
});

const holders = (members = TEAM) =>
  new Map(
    StaffPermissions.LEVELS.map((level) => [
      level,
      TeamRosterSystem.holdersOf(members, level),
    ]),
  );

describe('teamAddMenuVm — what the ＋ adds', () => {
  it('words each offer by its role’s own name, in the order it was handed', () => {
    expect(
      teamAddMenuVm(
        [Role.Barber, Role.Receptionist, Role.ContentManager, Role.Admin],
        BG,
      ),
    ).toEqual([
      { role: Role.Barber, label: 'Бръснар', testId: 'admin-team-add-barber' },
      {
        role: Role.Receptionist,
        label: 'Рецепция',
        testId: 'admin-team-add-receptionist',
      },
      {
        role: Role.ContentManager,
        label: 'Съдържание',
        testId: 'admin-team-add-content_manager',
      },
      {
        role: Role.Admin,
        label: 'Администратор',
        testId: 'admin-team-add-admin',
      },
    ]);
    expect(teamAddMenuVm([], BG)).toEqual([]);
  });

  it('words them in English', () => {
    expect(
      teamAddMenuVm([Role.Barber, Role.Admin], EN).map(
        (option) => option.label,
      ),
    ).toEqual(['Barber', 'Admin']);
  });
});

describe('levelsVm — «Права»', () => {
  it('an untouched shop: every level on the standard, with who holds it', () => {
    const vm = levelsVm({
      next: StaffPermissions.UNSET,
      unsaved: new Set(),
      holders: holders(),
      words: BG,
      locale: Locale.Bg,
    });
    expect(
      vm.levels.map((row) => [row.name, row.holders, row.value, row.unsaved]),
    ).toEqual([
      ['Бръснар', 'Иван, Георги, Мартин', 'Стандартни', false],
      ['Рецепция', 'Елена', 'Стандартни', false],
      ['Съдържание', 'Мария', 'Стандартни', false],
    ]);
    expect([vm.adminTitle, vm.adminLine]).toEqual([
      'Администратор',
      'Може всичко, винаги',
    ]);
    expect(vm.levels.map((row) => row.testId)).toEqual([
      'permissions-level-barber',
      'permissions-level-receptionist',
      'permissions-level-content_manager',
    ]);
  });

  it('counts a level’s departures as the page would save them, and marks the levels not saved yet', () => {
    const vm = levelsVm({
      next: StaffPermissions.read({
        barberTimeOffScope: All,
        barberTeamOfferingsScope: Own,
        receptionistHoursScope: None,
      }),
      unsaved: new Set<StaffLevel>([Role.Receptionist]),
      holders: holders(),
      words: BG,
      locale: Locale.Bg,
    });
    expect(vm.levels.map((row) => [row.value, row.unsaved])).toEqual([
      ['2 промени', false],
      ['1 промяна', true],
      ['Стандартни', false],
    ]);
  });

  it('names three holders and counts the rest; the word for nobody; nothing while the team has not loaded', () => {
    const many = [
      IVAN,
      GEORGI,
      { ...NIKOLAY, memberRoles: [Role.Barber] },
      { ...OWNER, memberRoles: [Role.Admin, Role.Barber] },
      { ...ELENA, memberRoles: [Role.Receptionist, Role.Barber] },
    ];
    const row = (members: typeof TEAM | null) =>
      levelsVm({
        next: StaffPermissions.UNSET,
        unsaved: new Set(),
        holders: members === null ? null : holders(members),
        words: BG,
        locale: Locale.Bg,
      }).levels;
    expect(row(many)[0]?.holders).toBe('Иван, Георги, Николай и още 2');
    expect(row([IVAN])[1]?.holders).toBe('Никой засега');
    expect(row(null).map((level) => level.holders)).toEqual(['', '', '']);
  });

  it('words the list in English', () => {
    const vm = levelsVm({
      next: StaffPermissions.read({ barberTimeOffScope: All }),
      unsaved: new Set(),
      holders: holders([IVAN, GEORGI, MARIA]),
      words: EN,
      locale: Locale.En,
    });
    expect(vm.levels.map((row) => [row.name, row.holders, row.value])).toEqual([
      ['Barber', 'Ivan, Georgi', '1 change'],
      ['Front desk', 'Nobody yet', 'Standard'],
      ['Content', 'Мария', 'Standard'],
    ]);
    expect(vm.adminLine).toBe('May do everything, always');
  });
});

describe('levelPageVm — a level’s page', () => {
  const barberPage = (stored: Record<string, unknown> = {}, words = BG) =>
    levelPageVm({
      level: Role.Barber,
      next: StaffPermissions.read(stored),
      holderCount: 4,
      words,
    });

  it('groups the six capabilities as the catalogue does, each with its label', () => {
    const vm = barberPage();
    expect(vm.name).toBe('Бръснар');
    expect(vm.applies).toBe('Важи за 4 души');
    expect(
      vm.groups.map((group) => [
        group.title,
        group.rows.map((row) => row.label),
      ]),
    ).toEqual([
      ['График', ['Блокира време', 'Променя работното време']],
      ['Анализи', ['Вижда анализи']],
      [
        'Екип',
        [
          'Редактира профил на бръснар',
          'Определя услуги и цени',
          'Управлява екипа',
        ],
      ],
    ]);
  });

  it('a value where the cell offers «Само своите», a switch where it does not', () => {
    const rows = barberPage().groups.flatMap((group) => group.rows);
    const hours = rows.find(
      (row) => row.staffCapability === StaffCapability.Hours,
    );
    expect(hours).toMatchObject({
      isSwitch: false,
      accessScope: Own,
      scopeWord: 'Само своите',
      changed: false,
      key: 'barber-HOURS',
    });
    expect(hours?.options).toEqual([
      { id: None, label: 'Не', testId: 'permission-scope-barber-HOURS-NONE' },
      {
        id: Own,
        label: 'Само своите',
        testId: 'permission-scope-barber-HOURS-OWN',
      },
      {
        id: All,
        label: 'Всички',
        testId: 'permission-scope-barber-HOURS-ALL',
      },
    ]);
    const manage = rows.find(
      (row) => row.staffCapability === StaffCapability.TeamManage,
    );
    expect(manage).toMatchObject({ isSwitch: true, on: false });
    // The front desk has no «own»: every row a switch.
    const desk = levelPageVm({
      level: Role.Receptionist,
      next: StaffPermissions.UNSET,
      holderCount: 1,
      words: BG,
    });
    const deskRows = desk.groups.flatMap((group) => group.rows);
    expect(deskRows.every((row) => row.isSwitch)).toBe(true);
    expect(deskRows.map((row) => row.on)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(desk.applies).toBe('Важи за 1 човек');
  });

  it('a changed row is marked and says what the standard was — a value’s scope, a switch’s state', () => {
    const vm = barberPage({
      barberTimeOffScope: All,
      barberTeamOfferingsScope: Own,
      barberTeamManageScope: All,
    });
    const rows = vm.groups.flatMap((group) => group.rows);
    expect(
      rows
        .filter((row) => row.changed)
        .map((row) => [row.staffCapability, row.scopeWord, row.standardWas]),
    ).toEqual([
      [StaffCapability.TimeOff, 'Всички', 'Стандартно: Само своите'],
      [StaffCapability.TeamOfferings, 'Само своите', 'Стандартно: Не'],
      [StaffCapability.TeamManage, 'Всички', 'Стандартно: изключено'],
    ]);
    expect(vm.departs).toBe(true);
    expect(barberPage().departs).toBe(false);

    // A switch whose standard is on.
    const desk = levelPageVm({
      level: Role.Receptionist,
      next: StaffPermissions.read({ receptionistHoursScope: None }),
      holderCount: 0,
      words: BG,
    });
    const cut = desk.groups
      .flatMap((group) => group.rows)
      .find((row) => row.changed);
    expect(cut?.standardWas).toBe('Стандартно: включено');
    expect(cut?.on).toBe(false);
    expect(desk.applies).toBe('Никой няма това ниво засега');
  });

  it('says nothing of who it applies to while the team has not loaded', () => {
    expect(
      levelPageVm({
        level: Role.Barber,
        next: StaffPermissions.UNSET,
        holderCount: null,
        words: BG,
      }).applies,
    ).toBe('');
  });

  it('words the page in English', () => {
    const vm = barberPage({ barberTimeOffScope: All }, EN);
    expect(vm.name).toBe('Barber');
    expect(vm.applies).toBe('Applies to 4 people');
    expect(vm.groups.map((group) => group.title)).toEqual([
      'Schedule',
      'Analytics',
      'Team',
    ]);
    const blocked = vm.groups[0]?.rows[0];
    expect([blocked?.scopeWord, blocked?.standardWas]).toEqual([
      'Everyone',
      'Standard: Own only',
    ]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const input = deepFreeze({
      level: Role.Barber,
      next: StaffPermissions.read({ barberTimeOffScope: All }),
      holderCount: 2,
      words: BG,
    } as const);
    expect(levelPageVm(input)).toEqual(levelPageVm(input));
  });
});
