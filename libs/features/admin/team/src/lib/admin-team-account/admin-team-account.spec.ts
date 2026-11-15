import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  BarberLinkChange,
  Role,
  type TeamMember,
  TeamMemberStatus,
} from '@core/components';
import { GovernanceErrorCode, PipelineError } from '@core/errors';
import { UserId } from '@core/primitives';
import { type TeamBedOptions, teamBed } from '../team-bed.spec-support';
import { ELENA, RECORDS, TEAM } from '../team.fixtures.spec-support';
import { AdminTeamAccount } from './admin-team-account';

/*
 * A staff account's page: what it draws for whoever is looking, and the
 * calls its rows make — the real template over scripted calls.
 */

const NBSP = ' ';

const REFUSED = PipelineError.fromWire('functions/permission-denied', {
  errorCode: GovernanceErrorCode.RolesForbidden,
});

async function render(userId: string, options: TeamBedOptions = {}) {
  const bed = teamBed({ members: TEAM, ...options });
  await TestBed.configureTestingModule({
    imports: [AdminTeamAccount],
    providers: bed.providers,
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminTeamAccount);
  fixture.componentRef.setInput('userId', userId);
  /**
   * The page at rest: a call in flight answers and the list is read again
   * behind it — a chain of promises `whenStable` does not wait for, so the
   * turn is given up once and everything queued runs.
   */
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
  };
  await settle();
  const root = fixture.nativeElement as HTMLElement;
  const piece = (id: string) =>
    root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const pieces = (id: string) => [
    ...root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
  ];
  const text = (element: Element | null | undefined) =>
    (element?.textContent ?? '')
      .replaceAll(NBSP, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const press = async (id: string): Promise<void> => {
    piece(id)?.click();
    await settle();
  };
  return { fixture, root, piece, pieces, text, press, settle, ...bed };
}

describe('AdminTeamAccount — someone else’s account, to the owner', () => {
  it('heads the page with the person, ticks the roles they hold, and leads to the level', async () => {
    const { piece, pieces, text } = await render('u-elena');

    expect(text(piece('account-name'))).toBe('Елена Василева');
    expect(text(piece('account-line'))).toBe('Рецепция');
    expect(
      piece('account-role-receptionist')?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      piece('account-role-content_manager')?.getAttribute('aria-checked'),
    ).toBe('false');
    expect(piece('account-role-admin')?.getAttribute('aria-checked')).toBe(
      'false',
    );
    // «Бръснар» is given from a barber's page: no tick, and a line that says so.
    expect(piece('account-role-barber')).toBeNull();
    expect(pieces('account-note').map(text)).toEqual([
      'След промяна Елена ще трябва да влезе отново.',
      '„Бръснар“ се дава от страницата на бръснаря, със „Свържи профил“.',
    ]);
    expect(piece('account-level-receptionist')?.getAttribute('href')).toBe(
      '/admin/team/permissions/receptionist',
    );
    // Nothing is drafted: no dock.
    expect(piece('account-dock')).toBeNull();
  });

  it('a tick turned raises «Запази»; saved, the whole set is sent, the page says so and the dock leaves', async () => {
    const { piece, press, text, calls, listAnswers } = await render('u-elena');

    await press('account-role-content_manager');
    expect(
      piece('account-role-content_manager')?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(text(piece('account-save'))).toBe('Запази');

    listAnswers(
      TEAM.map((member) =>
        member === ELENA
          ? { ...ELENA, memberRoles: [Role.Receptionist, Role.ContentManager] }
          : member,
      ),
    );
    await press('account-save');

    expect(calls.roles).toEqual([
      expect.objectContaining({
        targetUserId: 'u-elena',
        roles: [Role.Receptionist, Role.ContentManager],
        barberLinkChange: BarberLinkChange.Keep,
      }),
    ]);
    expect(piece('account-dock')).toBeNull();
    expect(text(piece('account-line'))).toBe('Рецепция, Съдържание');
    expect(piece('account-saved-toast')?.hasAttribute('data-presented')).toBe(
      true,
    );
    // A second level held: a second way to «Права».
    expect(piece('account-level-content_manager')).not.toBeNull();
  });

  it('with the last tick off there is no save, and the page says how the account leaves the team', async () => {
    const { piece, pieces, press, text } = await render('u-elena');

    await press('account-role-receptionist');

    expect(piece('account-dock')).toBeNull();
    expect(text(pieces('account-note')[0])).toBe(
      'Без роля профилът напуска екипа. Използвай „Махни от екипа“.',
    );
  });

  it('a refused save is said on the page, and the draft stays', async () => {
    const { piece, press, text, rolesRefuse } = await render('u-elena');
    rolesRefuse(REFUSED);

    await press('account-role-admin');
    await press('account-save');

    expect(text(piece('account-refusal')).length).toBeGreaterThan(0);
    expect(piece('account-role-admin')?.getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(piece('account-save')).not.toBeNull();
  });

  it('«Махни от екипа» asks first, sends the account as a client and goes back to the list', async () => {
    const { piece, press, text, calls, listAnswers } = await render('u-elena');
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    await press('account-remove');
    expect(text(piece('account-remove-question'))).toContain(
      'Да махна ли Елена Василева от екипа?',
    );
    expect(text(piece('account-remove-question'))).toContain(
      'Елена остава клиент и ще трябва да влезе отново.',
    );
    expect(calls.roles).toEqual([]);

    listAnswers(TEAM.filter((member) => member !== ELENA));
    await press('account-remove-confirm');

    expect(calls.roles).toEqual([
      expect.objectContaining({
        targetUserId: 'u-elena',
        roles: [Role.Client],
      }),
    ]);
    expect(navigate).toHaveBeenCalledWith(['/admin/team']);
  });

  it('«Отказ» sends nothing and the account stays', async () => {
    const { piece, press, calls } = await render('u-elena');

    await press('account-remove');
    await press('account-remove-cancel');

    expect(calls.roles).toEqual([]);
    expect(piece('account-name')).not.toBeNull();
  });

  it('a change written without ending the sessions is said with its retry', async () => {
    const { piece, press, text, calls, rolesRefuse } = await render('u-elena');
    rolesRefuse(
      PipelineError.fromWire('functions/aborted', {
        errorCode: GovernanceErrorCode.RolesSessionsNotRevoked,
      }),
    );
    await press('account-role-admin');
    await press('account-save');

    expect(text(piece('account-sessions-pending'))).toContain(
      'Промяната е запазена, но старите сесии на профила не бяха прекратени.',
    );
    expect(piece('account-refusal')).toBeNull();

    rolesRefuse(null);
    await press('account-sessions-retry');

    expect(calls.roles).toHaveLength(2);
    expect(piece('account-sessions-pending')).toBeNull();
  });
});

describe('AdminTeamAccount — an account that is read', () => {
  it('the owner’s own: the role held, why it is read, and no way off the team', async () => {
    const { piece, pieces, text } = await render('u-owner');

    expect(text(piece('account-name'))).toBe('Александър Тодоров');
    expect(piece('account-role-admin')?.tagName).not.toBe('BUTTON');
    expect(piece('account-role-receptionist')).toBeNull();
    expect(pieces('account-note').map(text)).toEqual([
      'Това е твоят профил. Ролите му не се променят оттук.',
    ]);
    expect(piece('account-remove')).toBeNull();
    expect(piece('account-levels')).toBeNull();
  });

  it('to someone who manages the team and assigns no roles: read, with no way to «Права»', async () => {
    const { piece, pieces, text } = await render('u-maria', {
      roles: [Role.Receptionist],
      userId: UserId.of('u-other'),
    });

    expect(text(piece('account-line'))).toBe('Съдържание');
    expect(piece('account-role-content_manager')?.tagName).not.toBe('BUTTON');
    expect(pieces('account-note').map(text)).toEqual([
      'Ролите променя само администраторът.',
    ]);
    expect(piece('account-levels')).toBeNull();
    expect(piece('account-remove')).toBeNull();
  });

  it('the vendor’s support account: named, nothing to change', async () => {
    const vendor: TeamMember.RoleOnly = {
      teamMemberStatus: TeamMemberStatus.RoleOnly,
      memberUserId: UserId.of('u-vendor'),
      memberAccountName: 'Вера Димова',
      memberRoles: [Role.Sysadmin],
    };
    const { piece, pieces, text } = await render('u-vendor', {
      members: [...TEAM, vendor],
    });

    expect(text(piece('account-line'))).toBe('Поддръжка');
    expect(piece('account-roles')).toBeNull();
    expect(pieces('account-note').map(text)).toEqual([
      'Профил на поддръжката. Ролите му не се променят.',
    ]);
  });
});

describe('AdminTeamAccount — the edges', () => {
  it('says an account the team does not hold in words', async () => {
    const { piece, text } = await render('u-nobody');
    expect(text(piece('admin-team-account-missing'))).toBe(
      'Не намерихме този профил в екипа.',
    );
  });

  it('finds no account when the list answered the records alone', async () => {
    const { piece } = await render('u-elena', {
      roles: [Role.ContentManager],
      members: RECORDS,
    });
    expect(piece('admin-team-account-missing')).not.toBeNull();
  });

  it('reads the Team list on arrival, and the back chip leads to it', async () => {
    const { piece, listed } = await render('u-elena');
    expect(listed.length).toBeGreaterThan(0);
    expect(piece('admin-team-account-back')?.getAttribute('href')).toBe(
      '/admin/team',
    );
  });
});
