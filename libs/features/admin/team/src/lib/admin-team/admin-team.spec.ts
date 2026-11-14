import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Role } from '@core/components';
import { PipelineError } from '@core/errors';
import { AccessScope } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import { FIXTURE_NOW_UTC_MS, FIXTURE_TIME_ZONE } from '@core/testing';
import { type TeamBedOptions, teamBed } from '../team-bed.spec-support';
import { RECORDS, TEAM } from '../team.fixtures.spec-support';
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
  return { fixture, root, piece, text, settle, ...bed };
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

  it('a barber record’s row leads to its page; an account with no record is read', async () => {
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
    const account = piece('team-member-u-elena');
    expect(account?.tagName).not.toBe('A');
    expect(account?.hasAttribute('href')).toBe(false);
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

    piece('admin-team-add')?.click();
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
