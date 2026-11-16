import { BarberLifecycle, StaffSetupItem } from '@core/components';
import { Tag } from '@core/primitives';
import type { Translate } from './team.words';

/**
 * The words a team member's page prints from values (`admin.team.member.*`):
 * a setup item's name, what a row holds, the lines that name the person.
 * The page's fixed labels are read by its template.
 */
export type MemberWords = {
  /** A setup item's row label; an item with no row has no word here. */
  readonly items: ReadonlyMap<StaffSetupItem, string>;
  readonly setupDone: string;
  readonly setupMissing: string;
  readonly none: string;
  readonly hoursSet: string;
  /** «1 услуга · 12 услуги» */
  readonly services: (count: number) => string;
  readonly allShops: string;
  /** «Николай започва да приема записи, щом всичко тук е готово.» */
  readonly goesLive: (name: string) => string;
  readonly profileRow: string;
  readonly photoAdd: string;
  readonly photoChange: string;
  readonly periodRow: string;
  /** «от 1 дек.» */
  readonly periodFrom: (date: string) => string;
  /** «3 март – 31 дек.» */
  readonly periodRange: (from: string, to: string) => string;
  /** «Николай напуска екипа след 31.12» — the notice's title for a last day still ahead. */
  readonly periodEndsTitle: (name: string, date: string) => string;
  /** «След този ден не приема записи и губи достъпа си до графика.» */
  readonly periodEndsBody: string;
  /** «Николай напуска екипа веднага» — the notice's title for a last day already passed. */
  readonly periodEndedTitle: (name: string) => string;
  /** «31.12 вече мина. Със запазването спира да приема записи…» */
  readonly periodEndedBody: (date: string) => string;
  /** «Николай напуска екипа сега?» */
  readonly leaveTitle: (name: string) => string;
  /** «Последният ден вече мина. Николай спира да приема записи…» */
  readonly leaveMessage: (name: string) => string;
  readonly leaveLabel: string;
  readonly leaveCancel: string;
  /** «3 записа след последния ден» — the warning's title, for one and for several. */
  readonly leftoverTitle: (count: number) => string;
  /** «След 31.12 Николай напуска екипа, а записите остават в графика. Дай ги…» — a last day still ahead. */
  readonly leftoverStays: (name: string, date: string, count: number) => string;
  /** «Със запазването Николай напуска екипа веднага, а записите остават…» — a last day already passed. */
  readonly leftoverNow: (name: string, count: number) => string;
  readonly leftoverFailed: string;
  /** «Стефан още има 3 записа» — the title on the page of a barber who has left. */
  readonly departedLeftoverTitle: (name: string, count: number) => string;
  /** «Записите са след последния ден. Дай ги на друг бръснар, премести ги или ги откажи.» */
  readonly departedLeftoverBody: (count: number) => string;
  /** Who may book a record, by the live status that says it. */
  readonly bookedBy: ReadonlyMap<BarberLifecycle.LiveStatus, string>;
  readonly mine: string;
  /** «Без профил Николай не влиза в приложението…» */
  readonly accountNone: (name: string) => string;
  /** «Стефан напусна екипа и вече няма достъп до графика.» */
  readonly accountDeparted: (name: string) => string;
  /** The same, for someone who links accounts: «…Помоли Николай да влезе веднъж…» */
  readonly accountLink: (name: string) => string;
  readonly accountMine: string;
  /** «Права на „Бръснар“» */
  readonly levelRow: (level: string) => string;
  /** «Да изтрия ли Николай Стоянов?» */
  readonly deleteTitle: (name: string) => string;
  readonly deleteLabel: string;
  readonly deleteCancel: string;
  /** «Николай вече приема записи.» */
  readonly live: (name: string) => string;
  /** «Стефан се връща със същия профил, цени и работно време…» */
  readonly returnLede: (name: string) => string;
};

/** The setup items a member's page gives a row: what bookings need. */
const ROW_ITEMS: readonly StaffSetupItem[] = [
  StaffSetupItem.Name,
  StaffSetupItem.StartDay,
  StaffSetupItem.Shops,
  StaffSetupItem.Services,
  StaffSetupItem.Hours,
];

/** The member page's words in one language. */
export function memberWordsOf(translate: Translate): MemberWords {
  const at = (key: string, params?: Readonly<Record<string, unknown>>) =>
    translate(`admin.team.member.${key}`, params);
  return {
    items: new Map(
      Tag.values(StaffSetupItem)
        .filter((item) => ROW_ITEMS.includes(item))
        .map((item) => [item, at(`items.${item}`)]),
    ),
    setupDone: at('setupDone'),
    setupMissing: at('setupMissing'),
    none: at('none'),
    hoursSet: at('hoursSet'),
    services: (count) =>
      count === 1 ? at('servicesOne') : at('servicesMany', { count }),
    allShops: at('allShops'),
    goesLive: (name) => at('goesLive', { name }),
    profileRow: at('profileRow'),
    photoAdd: at('photoAdd'),
    photoChange: at('photoChange'),
    periodRow: at('periodRow'),
    periodFrom: (date) => at('periodFrom', { date }),
    periodRange: (from, to) => at('periodRange', { from, to }),
    periodEndsTitle: (name, date) =>
      translate('admin.team.period.endsTitle', { name, date }),
    periodEndsBody: translate('admin.team.period.endsBody'),
    periodEndedTitle: (name) =>
      translate('admin.team.period.endedTitle', { name }),
    periodEndedBody: (date) =>
      translate('admin.team.period.endedBody', { date }),
    leaveTitle: (name) => translate('admin.team.period.leaveTitle', { name }),
    leaveMessage: (name) =>
      translate('admin.team.period.leaveMessage', { name }),
    leaveLabel: translate('admin.team.period.leaveLabel'),
    leaveCancel: translate('admin.team.link.cancel'),
    leftoverTitle: (count) =>
      count === 1
        ? translate('admin.team.period.leftoverTitleOne')
        : translate('admin.team.period.leftoverTitleMany', { count }),
    leftoverStays: (name, date, count) =>
      translate(
        count === 1
          ? 'admin.team.period.leftoverStaysOne'
          : 'admin.team.period.leftoverStaysMany',
        { name, date },
      ),
    leftoverNow: (name, count) =>
      translate(
        count === 1
          ? 'admin.team.period.leftoverNowOne'
          : 'admin.team.period.leftoverNowMany',
        { name },
      ),
    leftoverFailed: translate('admin.team.period.leftoverFailed'),
    departedLeftoverTitle: (name, count) =>
      count === 1
        ? at('leftoverTitleOne', { name })
        : at('leftoverTitleMany', { name, count }),
    departedLeftoverBody: (count) =>
      at(count === 1 ? 'leftoverBodyOne' : 'leftoverBodyMany'),
    bookedBy: new Map(
      BarberLifecycle.LIVE_STATUSES.map((status) => [
        status,
        at(`bookedBy.${status}`),
      ]),
    ),
    mine: at('mine'),
    accountNone: (name) => at('accountNone', { name }),
    accountDeparted: (name) => at('accountDeparted', { name }),
    accountLink: (name) => at('accountLink', { name }),
    accountMine: at('accountMine'),
    levelRow: (level) => at('levelRow', { level }),
    deleteTitle: (name) => at('deleteTitle', { name }),
    deleteLabel: at('delete'),
    deleteCancel: at('deleteCancel'),
    live: (name) => at('live', { name }),
    returnLede: (name) => translate('admin.team.return.lede', { name }),
  };
}
