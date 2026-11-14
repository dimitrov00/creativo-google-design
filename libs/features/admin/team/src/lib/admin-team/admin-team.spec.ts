import { TestBed } from '@angular/core/testing';
import { Role } from '@core/components';
import { PipelineError } from '@core/errors';
import { AccessScope } from '@core/primitives';
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

  it('a row is read, not pressed: no member leads anywhere yet', async () => {
    const { root } = await render({ members: TEAM });
    const rows = [
      ...root.querySelectorAll<HTMLElement>('[data-testid^="team-member-"]'),
    ];
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.tagName).toBe('LI');
      expect(row.hasAttribute('data-interactive')).toBe(false);
    }
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
