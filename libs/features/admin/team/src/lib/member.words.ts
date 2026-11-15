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
  readonly periodRow: string;
  /** «от 1 дек.» */
  readonly periodFrom: (date: string) => string;
  /** «3 март – 31 дек.» */
  readonly periodRange: (from: string, to: string) => string;
  /** Who may book a record, by the live status that says it. */
  readonly bookedBy: ReadonlyMap<BarberLifecycle.LiveStatus, string>;
  readonly mine: string;
  /** «Без профил Николай не влиза в приложението…» */
  readonly accountNone: (name: string) => string;
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
    periodRow: at('periodRow'),
    periodFrom: (date) => at('periodFrom', { date }),
    periodRange: (from, to) => at('periodRange', { from, to }),
    bookedBy: new Map(
      BarberLifecycle.LIVE_STATUSES.map((status) => [
        status,
        at(`bookedBy.${status}`),
      ]),
    ),
    mine: at('mine'),
    accountNone: (name) => at('accountNone', { name }),
    accountLink: (name) => at('accountLink', { name }),
    accountMine: at('accountMine'),
    levelRow: (level) => at('levelRow', { level }),
    deleteTitle: (name) => at('deleteTitle', { name }),
    deleteLabel: at('delete'),
    deleteCancel: at('deleteCancel'),
    live: (name) => at('live', { name }),
  };
}
