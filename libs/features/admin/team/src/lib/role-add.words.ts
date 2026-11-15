import { Role } from '@core/components';
import type { Translate } from './team.words';

/**
 * The words «Добави в екипа» prints from values (`admin.team.roleAdd.*`):
 * the lines that name the role or the account. What it shares with
 * «Свържи профил» — the heading over the team's own accounts, the empty
 * lookup, the failed one, «Отказ» — it reads from that sheet's keys
 * (`admin.team.link.*`), so the two never drift. The sheet's fixed labels
 * are read by its template.
 */
export type RoleAddWords = {
  /** «Избери чий профил получава роля „Рецепция“…» */
  readonly lede: (role: string) => string;
  readonly team: string;
  /** What the sheet says before a lookup, with nobody of the team's to offer. */
  readonly hint: string;
  readonly noneTitle: string;
  readonly none: string;
  readonly failed: string;
  /** «Да дам ли на Елена Василева роля „Рецепция“?» */
  readonly questionTitle: (account: string, role: string) => string;
  /** «Елена ще трябва да влезе отново в приложението.» */
  readonly message: (name: string) => string;
  /** What a role costs beyond a new sign-in, by the role that has such a line. */
  readonly messages: ReadonlyMap<Role, (name: string) => string>;
  readonly addLabel: string;
  readonly cancel: string;
};

/** The role sheet's words in one language. */
export function roleAddWordsOf(translate: Translate): RoleAddWords {
  const at = (key: string, params?: Readonly<Record<string, unknown>>) =>
    translate(`admin.team.roleAdd.${key}`, params);
  const shared = (key: string, params?: Readonly<Record<string, unknown>>) =>
    translate(`admin.team.link.${key}`, params);
  return {
    lede: (role) => at('lede', { role }),
    team: shared('team'),
    hint: at('hint'),
    noneTitle: shared('noneTitle'),
    none: at('none'),
    failed: shared('failed'),
    questionTitle: (account, role) => at('questionTitle', { account, role }),
    message: (name) => shared('linkMessage', { name }),
    messages: new Map([
      [Role.Admin, (name: string) => at('adminMessage', { name })],
    ]),
    addLabel: at('addLabel'),
    cancel: shared('cancel'),
  };
}
