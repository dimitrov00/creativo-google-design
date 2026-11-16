import { describe, expect, it } from 'vitest';
import {
  BarberStatus,
  RecordClaim,
  Role,
  StaffPermissions,
  StaffSetupItem,
  type TeamMember,
} from '@core/components';
import type { Barber, BarberSchedule, Service } from '@core/entities';
import { AccessScope, Locale, StaffCapability } from '@core/primitives';
import {
  OfferingPriceSystem,
  StaffSetupSystem,
  TeamSystem,
} from '@core/systems';
import { deepFreeze, localDate, locationFixture } from '@core/testing';
import { catalogueTranslate } from './catalogue.spec-support';
import { LinkAnswer } from './link.vm';
import { linkWordsOf } from './link.words';
import { type MemberPageInput, memberPageVm } from './member.presenter';
import { DeleteAnswer, MemberEditor } from './member.vm';
import { memberWordsOf } from './member.words';
import {
  IVAN,
  IVAN_RECORD,
  NIKOLAY,
  NIKOLAY_RECORD,
  STEFAN,
  STEFAN_RECORD,
  rosterOf,
  serviceOf,
} from './team.fixtures.spec-support';
import { teamWordsOf } from './team.words';

/*
 * A team member's page, worded (Law 10): its rows pinned in both languages
 * from fixed inputs and the app's real catalogue. Every decision is handed
 * in the way the page's store hands it — asked of the same systems.
 */

const TODAY = localDate('2026-11-14');
const NBSP = ' ';

/** A quiet line as it is read: the no-break spaces as plain ones. */
const read = (line: string): string => line.replaceAll(NBSP, ' ');

/** The page's input for a record, its services and roster — the owner looking, unless told. */
function inputOf(
  barber: Barber,
  facts: {
    readonly services?: readonly Service[];
    readonly schedule?: BarberSchedule | null;
    readonly member?: TeamMember.OfBarber | null;
    readonly lang?: 'bg' | 'en';
  } = {},
  over: Partial<MemberPageInput> = {},
): MemberPageInput {
  const services = facts.services ?? [];
  const checklist = StaffSetupSystem.checklistOf(
    barber,
    services,
    facts.schedule ?? null,
  );
  const lang = facts.lang ?? 'bg';
  const editable = TeamSystem.editable(barber).ok;
  return deepFreeze({
    barber,
    checklist,
    doneCount: StaffSetupSystem.doneCountOf(checklist),
    servicesCount: OfferingPriceSystem.performedCount(services, barber.id),
    bookedBy: TeamSystem.accessOf(barber),
    shops: [],
    everyShop: true,
    multiShop: false,
    member: facts.member ?? null,
    recordClaim: RecordClaim.None,
    managesTeam: true,
    mayEditProfile: editable,
    mayManage: editable,
    mayEditHours: editable,
    mayEditOfferings: editable,
    deletable: TeamSystem.removable(barber).ok,
    returnable: TeamSystem.returnable(barber).ok,
    leftover: null,
    linksAccount: false,
    releasesAccount: false,
    editsPermissions: true,
    permissions: StaffPermissions.UNSET,
    avatarSrc: null,
    words: teamWordsOf(catalogueTranslate(lang)),
    memberWords: memberWordsOf(catalogueTranslate(lang)),
    linkWords: linkWordsOf(catalogueTranslate(lang)),
    locale: lang === 'bg' ? Locale.Bg : Locale.En,
    today: TODAY,
    ...over,
  });
}

describe('memberPageVm — a record in preparation', () => {
  const vm = memberPageVm(
    inputOf(
      NIKOLAY_RECORD,
      { member: NIKOLAY },
      { recordClaim: RecordClaim.Open },
    ),
  );

  it('heads the page with the name and how far the record is', () => {
    expect(vm.name).toBe('Николай Стоянов');
    expect(read(vm.standing)).toBe('Подготовка · 3 от 5');
  });

  it('leads with what bookings need: each row done or missing, and each a way into its editor', () => {
    expect(
      vm.setup.map((row) => [
        row.staffSetupItem,
        row.label,
        row.value,
        row.done,
        row.state,
        row.memberEditor,
      ]),
    ).toEqual([
      [
        StaffSetupItem.Name,
        'Име',
        'Николай Стоянов',
        true,
        'готово',
        MemberEditor.Profile,
      ],
      [
        StaffSetupItem.StartDay,
        'Начална дата',
        '1.12',
        true,
        'готово',
        MemberEditor.Period,
      ],
      [
        StaffSetupItem.Services,
        'Услуги и цени',
        'Няма',
        false,
        'липсва',
        MemberEditor.Offerings,
      ],
      [
        StaffSetupItem.Hours,
        'Работно време',
        'Няма',
        false,
        'липсва',
        MemberEditor.Hours,
      ],
    ]);
    expect(vm.goesLive).toBe(
      'Николай започва да приема записи, щом всичко тук е готово.',
    );
  });

  it('keeps the profile rows at rest under it, without the hours and services the checklist already lists', () => {
    expect(
      vm.profile.map((row) => [row.label, row.value, row.memberEditor]),
    ).toEqual([
      ['Име и описание', 'Няма', MemberEditor.Profile],
      ['Период на работа', 'от 1.12', MemberEditor.Period],
    ]);
  });

  it('offers whoever edits the profile the photo: «Добави» with none, «Смени» with one; nobody else', () => {
    expect(vm.photoLabel).toBe('Добави снимка');
    expect(
      memberPageVm(
        inputOf({
          ...NIKOLAY_RECORD,
          avatarMediaPath: 'media/barbers/nikolay/operation-photo-0123456',
        }),
      ).photoLabel,
    ).toBe('Смени снимката');
    expect(
      memberPageVm(inputOf(NIKOLAY_RECORD, {}, { mayEditProfile: false }))
        .photoLabel,
    ).toBeNull();
    expect(
      memberPageVm(inputOf(NIKOLAY_RECORD, { lang: 'en' })).photoLabel,
    ).toBe('Add a photo');
  });

  it('says who may book the record once it goes live, and the answers offered', () => {
    expect(vm.bookedBy?.id).toBe(BarberStatus.Public);
    expect(vm.bookedBy?.word).toBe('Всички');
    expect(vm.bookedBy?.options.map((option) => option.label)).toEqual([
      'Само екипът',
      'Всички',
    ]);
  });

  it('offers the owner the record as their own, and says what no account means', () => {
    expect(vm.account).toEqual({
      isMine: false,
      isOpen: true,
      linkable: false,
      release: null,
      name: null,
      line: '',
      footnote:
        'Без профил Николай не влиза в приложението. Часовете се записват от екипа.',
    });
    expect(vm.levels).toEqual([]);
  });

  it('offers «Свържи профил» to someone who links accounts, and says how the person gets an account', () => {
    const linking = memberPageVm(
      inputOf(NIKOLAY_RECORD, { member: NIKOLAY }, { linksAccount: true }),
    );
    expect(linking.account?.linkable).toBe(true);
    expect(linking.account?.release).toBeNull();
    expect(linking.account?.footnote).toBe(
      'Без профил Николай не влиза в приложението. Помоли Николай да влезе веднъж, после натисни „Свържи профил“.',
    );
  });

  it('may be deleted, and asks first by name', () => {
    expect(vm.deletable).toBe(true);
    expect(vm.deleteTitle).toBe('Да изтрия ли Николай Стоянов?');
    expect(
      vm.deleteActions.map((action) => [action.id, action.label, action.role]),
    ).toEqual([
      [DeleteAnswer.Delete, 'Изтрий', 'destructive'],
      [DeleteAnswer.Cancel, 'Отказ', 'cancel'],
    ]);
  });

  it('shows what is there as the checklist fills: the services counted, the hours set', () => {
    const filled = memberPageVm(
      inputOf(NIKOLAY_RECORD, {
        services: [serviceOf(NIKOLAY.barberId)],
        schedule: rosterOf(NIKOLAY.barberId),
      }),
    );
    expect(read(filled.standing)).toBe('Подготовка · 5 от 5');
    expect(filled.setup.map((row) => [row.value, row.done])).toEqual([
      ['Николай Стоянов', true],
      ['1.12', true],
      ['1 услуга', true],
      ['Зададено', true],
    ]);
  });

  it('gives a business with several shops the shops row: every shop, or the ones named', () => {
    const center = locationFixture();
    const everywhere = memberPageVm(
      inputOf(NIKOLAY_RECORD, {}, { multiShop: true, shops: [center] }),
    );
    expect(
      everywhere.setup.find(
        (row) => row.staffSetupItem === StaffSetupItem.Shops,
      )?.value,
    ).toBe('Всички');
    const named = memberPageVm(
      inputOf(
        NIKOLAY_RECORD,
        {},
        { multiShop: true, shops: [center], everyShop: false },
      ),
    );
    const shopsRow = named.setup.find(
      (row) => row.staffSetupItem === StaffSetupItem.Shops,
    );
    expect(shopsRow?.value).not.toBe('Всички');
    // The row is the way into «Салони» for whoever manages the team.
    expect(shopsRow?.memberEditor).toBe(MemberEditor.Shops);
    expect(
      memberPageVm(
        inputOf(
          NIKOLAY_RECORD,
          {},
          { multiShop: true, shops: [center], mayManage: false },
        ),
      ).setup.find((row) => row.staffSetupItem === StaffSetupItem.Shops)
        ?.memberEditor,
    ).toBeNull();
  });
});

describe('memberPageVm — a record at work', () => {
  const facts = {
    services: [serviceOf(IVAN.barberId)],
    schedule: rosterOf(IVAN.barberId),
    member: IVAN,
  };

  it('has no checklist: the same rows are at rest under the profile', () => {
    const vm = memberPageVm(inputOf(IVAN_RECORD, facts));
    expect(vm.standing).toBe('Приема записи');
    expect(vm.setup).toEqual([]);
    expect(vm.goesLive).toBeNull();
    expect(vm.profile.map((row) => [row.label, row.value])).toEqual([
      ['Име и описание', 'Старши бръснар'],
      ['Работно време', 'Зададено'],
      ['Услуги и цени', '1 услуга'],
      ['Период на работа', 'от 3.03.2024 г.'],
    ]);
    expect(vm.profile.map((row) => row.memberEditor)).toEqual([
      MemberEditor.Profile,
      MemberEditor.Hours,
      MemberEditor.Offerings,
      MemberEditor.Period,
    ]);
    expect(vm.deletable).toBe(false);
  });

  it('gives a business with several shops the shops row, before the period', () => {
    const vm = memberPageVm(
      inputOf(IVAN_RECORD, facts, {
        multiShop: true,
        shops: [locationFixture()],
      }),
    );
    expect(
      vm.profile.map((row) => [row.id, row.value, row.memberEditor]),
    ).toEqual([
      ['profile', 'Старши бръснар', MemberEditor.Profile],
      ['hours', 'Зададено', MemberEditor.Hours],
      ['services', '1 услуга', MemberEditor.Offerings],
      ['shops', 'Всички', MemberEditor.Shops],
      ['period', 'от 3.03.2024 г.', MemberEditor.Period],
    ]);
  });

  it('names the linked account and its roles, and leads the owner to the level it holds', () => {
    const vm = memberPageVm(inputOf(IVAN_RECORD, facts));
    expect(vm.account).toEqual({
      isMine: false,
      isOpen: false,
      linkable: false,
      release: null,
      name: 'Иван Петров',
      line: 'Бръснар',
      footnote: null,
    });
    expect(
      vm.levels.map((link) => [link.level, link.label, link.value]),
    ).toEqual([[Role.Barber, 'Права на „Бръснар“', 'Стандартни']]);
  });

  it('asks before someone else’s account is released, and says what it costs them', () => {
    const vm = memberPageVm(
      inputOf(IVAN_RECORD, facts, { releasesAccount: true }),
    );
    expect(vm.account?.release).toEqual({
      title: 'Да разкача ли профила на Иван Петров?',
      message:
        'Иван вече няма да влиза като бръснар и ще трябва да влезе отново.',
      actions: [
        {
          id: LinkAnswer.Confirm,
          label: 'Разкачи',
          role: 'default',
          testId: 'member-release-confirm',
        },
        {
          id: LinkAnswer.Cancel,
          label: 'Отказ',
          role: 'cancel',
          testId: 'member-release-cancel',
        },
      ],
    });
    const english = memberPageVm(
      inputOf(IVAN_RECORD, { ...facts, lang: 'en' }, { releasesAccount: true }),
    );
    expect(english.account?.release?.title).toBe(
      'Unlink Иван Петров’s account?',
    );
    expect(english.account?.release?.message).toBe(
      'Иван will no longer sign in as a barber and will have to sign in again.',
    );
  });

  it('counts how far the level departs from the standard', () => {
    const cut = StaffPermissions.read({
      [StaffPermissions.fieldOf(Role.Barber, StaffCapability.Analytics)]:
        AccessScope.None,
    });
    const vm = memberPageVm(inputOf(IVAN_RECORD, facts, { permissions: cut }));
    expect(vm.levels[0]?.value).toBe('1 промяна');
  });

  it('says the record is the viewer’s own, and what that changes', () => {
    const mine: TeamMember.OfBarber = {
      ...IVAN,
      memberAccountName: 'Александър Тодоров',
      memberRoles: [Role.Barber, Role.Admin],
    };
    const vm = memberPageVm(
      inputOf(
        IVAN_RECORD,
        { ...facts, member: mine },
        { recordClaim: RecordClaim.Mine },
      ),
    );
    expect(vm.account?.isMine).toBe(true);
    expect(vm.account?.line).toBe('Твоят профил · Администратор, Бръснар');
    expect(vm.account?.footnote).toBe(
      'Работиш и на стола: графикът ти е в «График», а всичко друго остава както е.',
    );
  });

  it('offers «Върни в екипа» only as the store says: for a record that has left, to someone who manages the team', () => {
    expect(memberPageVm(inputOf(STEFAN_RECORD, facts)).returnable).toBe(true);
    expect(memberPageVm(inputOf(IVAN_RECORD, facts)).returnable).toBe(false);
    expect(
      memberPageVm(inputOf(STEFAN_RECORD, facts, { returnable: false }))
        .returnable,
    ).toBe(false);
  });

  it('counts the bookings a leaver still holds as the warning’s title — one, several — with what to do under it, and says nothing with none', () => {
    const left = (leftoverCount: number, days: readonly string[]) =>
      memberPageVm(
        inputOf(STEFAN_RECORD, facts, {
          leftover: {
            leftoverCount,
            leftoverLocalDates: days.map((day) => localDate(day)),
          },
        }),
      ).leftover;
    expect(left(1, ['2026-10-02'])).toEqual({
      title: 'Стефан още има 1 запис',
      body: 'След последния работен ден. Отвори го, за да го дадеш на друг бръснар, да го преместиш или да го откажеш.',
    });
    expect(left(4, ['2026-10-02', '2026-10-05', '2026-10-20'])).toEqual({
      title: 'Стефан още има 4 записа',
      body: 'След последния работен ден. Отвори запис, за да го дадеш на друг бръснар, да го преместиш или да го откажеш.',
    });
    expect(memberPageVm(inputOf(STEFAN_RECORD, facts)).leftover).toBeNull();
    expect(
      memberPageVm(
        inputOf(STEFAN_RECORD, facts, {
          leftover: { leftoverCount: 0, leftoverLocalDates: [] },
        }),
      ).leftover,
    ).toBeNull();
  });

  it('for someone who edits profiles and does not manage the team: the profile opens, the rest is read, and no account is shown', () => {
    const vm = memberPageVm(
      inputOf(IVAN_RECORD, facts, {
        managesTeam: false,
        mayManage: false,
        mayEditHours: false,
        mayEditOfferings: false,
        deletable: false,
        editsPermissions: false,
      }),
    );
    expect(vm.profile.map((row) => row.memberEditor)).toEqual([
      MemberEditor.Profile,
      null,
      null,
      null,
    ]);
    expect(vm.manageable).toBe(false);
    expect(vm.account).toBeNull();
    expect(vm.levels).toEqual([]);
  });

  it('words the page in English', () => {
    const vm = memberPageVm(inputOf(IVAN_RECORD, { ...facts, lang: 'en' }));
    expect(vm.name).toBe('Ivan Petrov');
    expect(vm.standing).toBe('Taking bookings');
    expect(vm.profile.map((row) => [row.label, row.value])).toEqual([
      ['Name and description', 'Senior barber'],
      ['Working hours', 'Set'],
      ['Services and prices', '1 service'],
      ['Working period', 'from Mar 3, 2024'],
    ]);
    expect(vm.bookedBy?.word).toBe('Everyone');
    expect(vm.levels[0]?.label).toBe('Permissions of “Barber”');
  });
});

describe('memberPageVm — a record that has left', () => {
  const vm = memberPageVm(inputOf(STEFAN_RECORD, { member: STEFAN }));

  it('says when, and offers nothing to change', () => {
    expect(read(vm.standing)).toBe('Напусна на 30.09');
    expect(vm.bookedBy).toBeNull();
    expect(vm.profile.map((row) => row.memberEditor)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(read(vm.profile.at(-1)?.value ?? '')).toBe('3.03.2024 г. – 30.09');
    expect(vm.manageable).toBe(false);
    expect(vm.deletable).toBe(false);
  });
});

describe('memberPageVm — purity', () => {
  it('same input → same output, the input untouched', () => {
    const input = inputOf(NIKOLAY_RECORD, { member: NIKOLAY });
    const snapshot = JSON.stringify(input);
    expect(memberPageVm(input)).toEqual(memberPageVm(input));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
