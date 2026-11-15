import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BarberLinkChange, E164, Role } from '@core/components';
import { GovernanceErrorCode, PipelineError } from '@core/errors';
import { AccessScope, UserId } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  userFixture,
} from '@core/testing';
import { type TeamBedOptions, teamBed } from '../team-bed.spec-support';
import { IVAN, RECORDS, TEAM } from '../team.fixtures.spec-support';
import { AdminTeam } from './admin-team';

/*
 * «Екип» — the Team page: what it draws for whoever is looking, from the
 * rows `listTeam` answered.
 */

const NBSP = ' ';

async function render(options: TeamBedOptions = {}) {
  const bed = teamBed(options);
  await TestBed.configureTestingModule({
    imports: [AdminTeam],
    providers: bed.providers,
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminTeam);
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  await settle();
  const root = fixture.nativeElement as HTMLElement;
  const piece = (id: string) =>
    root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const text = (element: Element | null | undefined) =>
    (element?.textContent ?? '')
      .replaceAll(NBSP, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const type = async (id: string, value: string): Promise<void> => {
    const field = piece(id) as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  const press = async (id: string): Promise<void> => {
    piece(id)?.click();
    await settle();
  };
  /** A sheet's exit transition ends — no test browser runs it by itself. */
  const left = async (sheetId: string): Promise<void> => {
    const ended = new Event('transitionend');
    Object.defineProperty(ended, 'propertyName', { value: 'opacity' });
    document.getElementById(sheetId)?.dispatchEvent(ended);
    await settle();
  };
  return { fixture, root, piece, text, type, press, left, settle, ...bed };
}

describe('AdminTeam — «Екип»', () => {
  it('asks for the team once on arrival and draws the three runs, each person a name over one quiet line', async () => {
    const { root, piece, text, listed } = await render({ members: TEAM });

    expect(listed).toEqual([{}]);
    expect(piece('admin-team')?.getAttribute('data-load')).toBe('READY');
    expect(text(piece('admin-team-title'))).toBe('Екип');
    expect(text(piece('admin-team-lede'))).toBe(
      'Хората в екипа и как стои всеки.',
    );
    expect(
      [...root.querySelectorAll('h2')].map((heading) => text(heading)),
    ).toEqual(['Бръснари', 'Още в екипа', 'Напуснали', 'Достъп']);
    expect(text(piece('team-member-georgi'))).toContain('Георги Димов');
    expect(text(piece('team-member-georgi'))).toContain(
      'Приема записи · Последен ден: 31.12',
    );
    expect(text(piece('team-member-nikolay'))).toContain(
      'Подготовка · 3 от 5 · Без профил в приложението',
    );
    expect(text(piece('team-member-u-elena'))).toContain('Елена Василева');
    expect(text(piece('team-member-u-elena'))).toContain('Рецепция');
    expect(text(piece('team-member-stefan'))).toContain('Напусна на 30.09');
  });

  it('a barber record’s row leads to its page, and an account with no record to its own', async () => {
    const { root, piece } = await render({ members: TEAM });
    const rows = [
      ...root.querySelectorAll<HTMLElement>('[data-testid^="team-member-"]'),
    ];
    expect(rows).toHaveLength(8);
    expect(piece('team-member-nikolay')?.tagName).toBe('A');
    expect(piece('team-member-nikolay')?.getAttribute('href')).toBe(
      '/admin/team/member/nikolay',
    );
    expect(piece('team-member-stefan')?.getAttribute('href')).toBe(
      '/admin/team/member/stefan',
    );
    // A staff account with no record leads to its own page.
    expect(piece('team-member-u-elena')?.getAttribute('href')).toBe(
      '/admin/team/account/u-elena',
    );
  });

  it('whoever manages the team finds the ＋ in the bar; a content editor does not', async () => {
    const { piece, lookingAs, settle } = await render({ members: TEAM });
    expect(piece('admin-team-add')?.getAttribute('aria-label')).toBe(
      'Добави човек в екипа',
    );
    expect(piece('team-add-sheet')).toBeNull();

    lookingAs([Role.ContentManager]);
    await settle();
    expect(piece('admin-team-add')).toBeNull();
  });

  it('the ＋ opens the add sheet: a name and «Добави» create the record, starting today, and its page opens', async () => {
    const { piece, calls, settle } = await render({ members: TEAM });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    // The owner's ＋ is a menu: a barber is its first answer.
    piece('admin-team-add')?.click();
    await settle();
    expect(piece('team-add-sheet')).toBeNull();
    piece('admin-team-add-barber')?.click();
    await settle();
    expect(piece('team-add-sheet')).not.toBeNull();
    const save = piece('team-add-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    const name = piece('team-add-name') as HTMLInputElement;
    name.value = 'Николай Стоянов';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(save.disabled).toBe(false);

    save.click();
    await settle();
    await settle();

    expect(calls.adds).toHaveLength(1);
    expect(calls.adds[0]).toMatchObject({
      name: { bg: 'Николай Стоянов', en: null },
      // Today, on the shop's own clock.
      barberStartsLocalDate: ZonedTimeSystem.shopNow(
        FIXTURE_NOW_UTC_MS,
        FIXTURE_TIME_ZONE,
      ).localDate,
      barberLastWorkingLocalDate: null,
    });
    // Nobody's prices were asked for: nothing is copied.
    expect(calls.offerings).toEqual([]);
    // The sheet leaves — its exit transition ends, which no test browser
    // runs by itself — and then the new record's page opens: the act's name
    // is the record's id.
    expect(navigate).not.toHaveBeenCalled();
    const ended = new Event('transitionend');
    Object.defineProperty(ended, 'propertyName', { value: 'opacity' });
    document.getElementById('team-add-sheet')?.dispatchEvent(ended);
    await settle();
    expect(piece('team-add-sheet')).toBeNull();
    expect(navigate).toHaveBeenCalledWith([
      '/admin/team/member',
      calls.adds[0]?.operationId,
    ]);
  });

  it('gives the owner the way to «Права», saying how far the shop is from the standard', async () => {
    const { piece, text, liveCells, settle } = await render({ members: TEAM });
    const row = piece('admin-team-permissions');
    expect(row?.getAttribute('href')).toBe('/admin/team/permissions');
    expect(text(piece('admin-team-permissions-value'))).toBe('Стандартни');

    liveCells({
      barberTimeOffScope: AccessScope.All,
      receptionistHoursScope: AccessScope.None,
    });
    await settle();
    expect(text(piece('admin-team-permissions-value'))).toBe('2 промени');
  });

  it('for a content editor: the records alone, the profiles’ lede and no «Права»', async () => {
    const { root, piece, text } = await render({
      roles: [Role.ContentManager],
      members: RECORDS,
    });

    expect(text(piece('admin-team-lede'))).toBe('Профилите на бръснарите.');
    expect(
      [...root.querySelectorAll('h2')].map((heading) => text(heading)),
    ).toEqual(['Бръснари', 'Напуснали']);
    expect(piece('admin-team-permissions')).toBeNull();
    // No account was read for this person: no row speaks of one.
    expect(text(root)).not.toContain('Без профил');
  });

  it('says an empty shop in words', async () => {
    const { piece, text } = await render({ members: [] });
    expect(piece('admin-team')?.getAttribute('data-load')).toBe('EMPTY');
    expect(text(piece('admin-team-empty'))).toBe('Още няма никого в екипа.');
  });

  it('a refused read is said in the catalogue’s words, with a way to try again that reads once more', async () => {
    const refused = PipelineError.fromWire('functions/permission-denied', {
      errorCode: 'ACCESS_DENIED',
      staffCapability: 'TEAM_MANAGE',
    });
    const { piece, text, listed, listAnswers, settle } = await render({
      listRefusal: refused,
    });

    expect(piece('admin-team')?.getAttribute('data-load')).toBe('FAILED');
    expect(text(piece('admin-team-failed'))).toContain(
      'Нямаш право да управляваш екипа.',
    );

    listAnswers(TEAM);
    piece('admin-team-retry')?.click();
    await settle();
    expect(listed).toHaveLength(2);
    expect(piece('admin-team')?.getAttribute('data-load')).toBe('READY');
    expect(piece('admin-team-failed')).toBeNull();
  });
});

describe('AdminTeam — the ＋: a barber, or a role for a registered account («Добави в екипа»)', () => {
  /** A registered client the lookup finds. */
  const georgi = userFixture({
    id: UserId.of('u-georgi'),
    firstName: 'Георги',
    lastName: 'Иванов',
    phone: E164.of('+359881112233'),
  });
  /** The change was written; the person's sessions were not ended. */
  const UNREVOKED = PipelineError.fromWire('functions/aborted', {
    errorCode: GovernanceErrorCode.RolesSessionsNotRevoked,
  });
  /** The typing rests, and the index answers. */
  const rested = async (settle: () => Promise<void>): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 320));
    await settle();
  };

  it('is a menu for the owner: a barber, then the three roles an account can be given', async () => {
    const { root, piece, press, text } = await render({ members: TEAM });
    expect(piece('admin-team-add')?.getAttribute('aria-haspopup')).toBe('menu');

    await press('admin-team-add');

    expect(
      [
        ...root.querySelectorAll<HTMLElement>(
          '[data-testid^="admin-team-add-"]',
        ),
      ].map((option) => text(option)),
    ).toEqual(['Бръснар', 'Рецепция', 'Съдържание', 'Администратор']);
    // Nothing is open yet: the menu only asks which.
    expect(piece('team-add-sheet')).toBeNull();
    expect(piece('team-role-sheet')).toBeNull();
  });

  it('is the act itself for someone who manages the team and assigns no roles: no menu, the add sheet at once', async () => {
    const { root, piece, press } = await render({
      members: TEAM,
      roles: [Role.Receptionist],
      stored: { receptionistTeamManageScope: AccessScope.All },
    });
    expect(piece('admin-team-add')?.getAttribute('aria-haspopup')).toBeNull();
    expect(
      root.querySelectorAll('[data-testid^="admin-team-add-"]'),
    ).toHaveLength(0);

    await press('admin-team-add');

    expect(piece('team-add-sheet')).not.toBeNull();
  });

  it('a role opens on the team’s own people who do not hold it — a barber somebody signs in as, a colleague under another role — never the owner, a leaver or a record with no account', async () => {
    const { piece, press, text, settle, root } = await render({
      members: TEAM,
    });
    await press('admin-team-add');
    await press('admin-team-add-receptionist');
    await settle();

    expect(piece('team-role-sheet')).not.toBeNull();
    expect(text(root)).toContain(
      'Избери чий профил получава роля „Рецепция“. Човекът влиза в приложението с него.',
    );
    expect(text(root)).toContain('От екипа');
    expect(text(piece('team-role-u-ivan'))).toContain('Иван Петров');
    expect(text(piece('team-role-u-ivan'))).toContain('Бръснар');
    expect(text(piece('team-role-u-maria'))).toContain('Съдържание');
    // Holds it already; the viewer; a leaver; nobody signs in as Nikolay.
    expect(piece('team-role-u-elena')).toBeNull();
    expect(piece('team-role-u-owner')).toBeNull();
    expect(piece('team-role-u-stefan')).toBeNull();
    expect(piece('team-role-u-nikolay')).toBeNull();
  });

  it('a colleague picked is asked about first; «Добави» sends the role beside what they hold, the list is read again, and their page opens', async () => {
    const { piece, press, left, text, settle, calls, listed } = await render({
      members: TEAM,
    });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    await press('admin-team-add');
    await press('admin-team-add-receptionist');
    await settle();
    const before = listed.length;

    await press('team-role-u-maria');
    expect(text(piece('team-role-question'))).toContain(
      'Да дам ли на Мария Ангелова роля „Рецепция“?',
    );
    expect(text(piece('team-role-question'))).toContain(
      'Мария ще трябва да влезе отново в приложението.',
    );
    expect(calls.roles).toEqual([]);

    await press('team-role-confirm');
    await settle();

    expect(calls.roles).toEqual([
      expect.objectContaining({
        targetUserId: 'u-maria',
        roles: [Role.Client, Role.Receptionist, Role.ContentManager],
        barberLinkChange: BarberLinkChange.Keep,
      }),
    ]);
    expect(listed.length).toBeGreaterThan(before);
    // The sheet leaves, and then the account's own page opens.
    expect(navigate).not.toHaveBeenCalled();
    await left('team-role-sheet');
    expect(piece('team-role-sheet')).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/admin/team/account', 'u-maria']);
  });

  it('a barber made an admin keeps the chair: the question says what an admin may do, and the barber’s page opens', async () => {
    const { piece, press, left, text, settle, calls } = await render({
      members: TEAM,
    });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    await press('admin-team-add');
    await press('admin-team-add-admin');
    await settle();

    await press('team-role-u-ivan');
    expect(text(piece('team-role-question'))).toContain(
      'Да дам ли на Иван Петров роля „Администратор“?',
    );
    expect(text(piece('team-role-question'))).toContain(
      'Иван ще може да променя всичко в салона, включително ролите и правата',
    );
    await press('team-role-confirm');
    await settle();

    expect(calls.roles).toEqual([
      expect.objectContaining({
        targetUserId: 'u-ivan',
        roles: [Role.Barber, Role.Admin],
        barberLinkChange: BarberLinkChange.Keep,
      }),
    ]);
    await left('team-role-sheet');
    expect(navigate).toHaveBeenCalledWith([
      '/admin/team/member',
      IVAN.barberId,
    ]);
  });

  it('«Отказ» sends nothing and the sheet stays', async () => {
    const { piece, press, settle, calls } = await render({ members: TEAM });
    await press('admin-team-add');
    await press('admin-team-add-content_manager');
    await settle();
    await press('team-role-u-elena');
    await press('team-role-cancel');
    await settle();

    expect(calls.roles).toEqual([]);
    expect(piece('team-role-sheet')).not.toBeNull();
  });

  it('a lookup asks the index once the typing rests; a registered client found takes the role beside «client»', async () => {
    const { piece, press, left, type, text, settle, calls } = await render({
      members: TEAM,
      accounts: [georgi],
    });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    await press('admin-team-add');
    await press('admin-team-add-receptionist');
    await settle();

    await type('team-role-query', 'Георги');
    expect(calls.searched).toEqual([]);
    await rested(settle);

    expect(calls.searched).toEqual(['георги']);
    expect(text(piece('team-role-u-georgi'))).toContain('Георги Иванов');
    expect(text(piece('team-role-u-georgi'))).toContain('+359 88 111 2233');
    // The team's own people gave way to the lookup's answer.
    expect(piece('team-role-u-maria')).toBeNull();

    await press('team-role-u-georgi');
    await press('team-role-confirm');
    await settle();

    expect(calls.roles[0]).toMatchObject({
      targetUserId: 'u-georgi',
      roles: [Role.Client, Role.Receptionist],
      barberLinkChange: BarberLinkChange.Keep,
    });
    await left('team-role-sheet');
    expect(navigate).toHaveBeenCalledWith(['/admin/team/account', 'u-georgi']);
  });

  it('a refused change is said in the sheet, which stays; nothing opens', async () => {
    const { piece, press, text, settle, rolesRefuse } = await render({
      members: TEAM,
    });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    rolesRefuse(
      PipelineError.fromWire('functions/permission-denied', {
        errorCode: GovernanceErrorCode.RolesForbidden,
      }),
    );
    await press('admin-team-add');
    await press('admin-team-add-receptionist');
    await settle();
    await press('team-role-u-maria');
    await press('team-role-confirm');
    await settle();

    expect(piece('team-role-sheet')).not.toBeNull();
    expect(text(piece('team-role-refusal')).length).toBeGreaterThan(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a role that landed without ending the person’s sessions: the sheet leaves, the page says so and retries — and opens nothing', async () => {
    const { piece, press, left, text, settle, calls, rolesRefuse } =
      await render({ members: TEAM });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    rolesRefuse(UNREVOKED);
    await press('admin-team-add');
    await press('admin-team-add-receptionist');
    await settle();
    await press('team-role-u-maria');
    await press('team-role-confirm');
    await settle();
    await left('team-role-sheet');

    expect(piece('team-role-sheet')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(text(piece('admin-team-sessions-pending'))).toContain(
      'старите сесии на профила не бяха прекратени',
    );

    // «Опитай пак»: the same change again; the server ends them.
    rolesRefuse(null);
    await press('admin-team-sessions-retry');
    await settle();
    expect(calls.roles).toHaveLength(2);
    expect(calls.roles[1]).toMatchObject({
      targetUserId: 'u-maria',
      roles: [Role.Client, Role.Receptionist, Role.ContentManager],
      barberLinkChange: BarberLinkChange.Keep,
    });
    expect(piece('admin-team-sessions-pending')).toBeNull();
  });
});
