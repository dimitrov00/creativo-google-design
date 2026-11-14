import { TestBed } from '@angular/core/testing';
import { Role } from '@core/components';
import { PipelineError } from '@core/errors';
import { AccessScope, StaffCapability } from '@core/primitives';
import { PermissionsStore } from '../permissions.store';
import { type TeamBedOptions, teamBed } from '../team-bed.spec-support';
import { TEAM } from '../team.fixtures.spec-support';
import { AdminPermissions } from './admin-permissions';

/*
 * «Права» — the levels the owner edits: who holds each, how far it departs
 * from the standard, and the save that travels with the draft.
 */

async function render(options: TeamBedOptions = {}) {
  const bed = teamBed({ members: TEAM, ...options });
  await TestBed.configureTestingModule({
    imports: [AdminPermissions],
    providers: bed.providers,
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminPermissions);
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
    (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  /** The runs of text an element holds, one per text node that says something. */
  const lines = (element: Element | null | undefined): string[] => {
    if (!element) return [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const out: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const run = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (run) out.push(run);
    }
    return out;
  };
  return {
    fixture,
    root,
    piece,
    text,
    lines,
    settle,
    store: TestBed.inject(PermissionsStore),
    ...bed,
  };
}

describe('AdminPermissions — «Права»', () => {
  it('lists the three levels, each leading to its page, with who holds it and how it stands', async () => {
    const { piece, text, lines } = await render({
      stored: {
        barberTimeOffScope: AccessScope.All,
        barberTeamOfferingsScope: AccessScope.Own,
      },
    });

    expect(text(piece('admin-permissions-title'))).toBe('Права');
    const barber = piece('permissions-level-barber');
    expect(barber?.getAttribute('href')).toBe('/admin/team/permissions/barber');
    // The name, who holds it, how it stands: three runs of one row.
    expect(lines(barber)).toEqual([
      'Бръснар',
      'Иван, Георги, Мартин',
      '2 промени',
    ]);
    expect(lines(piece('permissions-level-receptionist'))).toEqual([
      'Рецепция',
      'Елена',
      'Стандартни',
    ]);
    expect(
      piece('permissions-level-content_manager')?.getAttribute('href'),
    ).toBe('/admin/team/permissions/content_manager');
  });

  it('shows «Администратор» as one line that leads nowhere', async () => {
    const { piece, lines } = await render();
    const admin = piece('permissions-level-admin');
    expect(lines(admin)).toEqual(['Администратор', 'Може всичко, винаги']);
    expect(admin?.tagName).toBe('UI-LIST-ROW');
    expect(admin?.hasAttribute('href')).toBe(false);
  });

  it('holds no dock on a saved shop; a draft made on a level’s page brings «Запази» here and marks its level', async () => {
    const { piece, text, lines, store, settle } = await render();
    expect(piece('admin-permissions-save')).toBeNull();

    store.set(Role.Receptionist, StaffCapability.Hours, AccessScope.None);
    await settle();

    expect(text(piece('admin-permissions-save'))).toBe('Запази');
    const level = piece('permissions-level-receptionist');
    expect(level?.hasAttribute('data-unsaved')).toBe(true);
    expect(lines(level)).toEqual([
      'Незапазено.',
      'Рецепция',
      'Елена',
      '1 промяна',
    ]);
    expect(
      piece('permissions-level-barber')?.hasAttribute('data-unsaved'),
    ).toBe(false);
  });

  it('«Запази» sends the draft once; the dock goes and the receipt says so', async () => {
    const { piece, store, saves, settle } = await render();
    store.set(Role.Receptionist, StaffCapability.Hours, AccessScope.None);
    await settle();

    piece('admin-permissions-save')?.click();
    await settle();

    expect(saves).toEqual([
      {
        changes: [
          {
            staffCapability: StaffCapability.Hours,
            role: Role.Receptionist,
            accessScope: AccessScope.None,
          },
        ],
      },
    ]);
    expect(piece('admin-permissions-save')).toBeNull();
    expect(store.receipt()).toBe(true);
    expect(piece('permissions-level-receptionist')?.textContent).toContain(
      '1 промяна',
    );
  });

  it('a refused save is said in the catalogue’s words and keeps the draft', async () => {
    const { piece, text, store, settle } = await render({
      saveRefusal: PipelineError.fromWire('functions/permission-denied', {
        errorCode: 'GOVERNANCE_PERMISSIONS_FORBIDDEN',
      }),
    });
    store.set(Role.Receptionist, StaffCapability.Hours, AccessScope.None);
    await settle();

    piece('admin-permissions-save')?.click();
    await settle();

    expect(text(piece('admin-permissions-refusal'))).toBe(
      'Само собственикът може да променя правата.',
    );
    expect(piece('admin-permissions-save')).not.toBeNull();
  });

  it('names the holders once the team has loaded, and says nothing of them when it cannot', async () => {
    const { piece, lines } = await render({
      listRefusal: PipelineError.fromWire('functions/unavailable', {}),
    });
    expect(lines(piece('permissions-level-barber'))).toEqual([
      'Бръснар',
      'Стандартни',
    ]);
  });
});
