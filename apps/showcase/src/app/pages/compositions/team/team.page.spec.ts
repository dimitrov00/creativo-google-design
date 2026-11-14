import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TeamCompositionPage } from './team.page';

/**
 * THE TEAM SCREENS, COMPOSED (staff permissions, stage T: the prototype
 * pass). The page is the owner's first look at «Екип» and «Права», so the
 * spec holds what the page PROMISES to show, and that its two level pages
 * are the real cells: the grid, the standards and the counts follow the
 * engine, and a change travels from a row to the dock to the list.
 */

async function render() {
  const fixture = TestBed.createComponent(TeamCompositionPage);
  fixture.detectChanges();
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const piece = (id: string): HTMLElement => {
    const found = root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!found) throw new Error(`no piece «${id}»`);
    return found;
  };
  const has = (id: string): boolean =>
    root.querySelector(`[data-testid="${id}"]`) !== null;
  const all = (selector: string, within: ParentNode = root): HTMLElement[] =>
    Array.from(within.querySelectorAll<HTMLElement>(selector));
  const text = (element: HTMLElement): string =>
    (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  const press = async (id: string): Promise<void> => {
    piece(id).click();
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { fixture, root, piece, has, all, text, press };
}

describe('TeamCompositionPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TeamCompositionPage],
      // The page's shell holds the way back: a router link.
      providers: [provideRouter([])],
    }).compileComponents();
  });

  // ── what the page shows ───────────────────────────────────────────────
  it('what the page shows: eight stand-in screens under four named plates', async () => {
    const { piece, all } = await render();
    for (const id of [
      'composition-team-owner',
      'composition-team-editor',
      'composition-member-draft',
      'composition-member-live',
      'composition-team-add-sheet',
      'composition-permissions',
      'composition-level-page-barber',
      'composition-level-page-receptionist',
    ]) {
      expect(piece(id).classList.contains('team__screen')).toBe(true);
    }
    const plates = all('section.team__plate');
    expect(plates).toHaveLength(4);
    for (const plate of plates) {
      const id = plate.getAttribute('aria-labelledby') ?? '';
      expect(plate.querySelector(`h2#${id}`)?.textContent?.trim()).not.toBe('');
    }
  });

  it('what the page shows: the owner’s list has the people, the way to add and «Права»; a content editor’s has the records only', async () => {
    const { piece, all, text } = await render();
    const owner = piece('composition-team-owner');
    expect(
      all('[data-testid^="composition-team-member-"]', owner),
    ).toHaveLength(8);
    expect(
      owner.querySelector('[data-testid="composition-team-add"]'),
    ).not.toBe(null);
    expect(text(piece('composition-team-access'))).toBe('Права 2 промени');

    const editor = piece('composition-team-editor');
    expect(
      all('[data-testid^="composition-team-member-"]', editor),
    ).toHaveLength(5);
    expect(editor.querySelector('[data-testid="composition-team-add"]')).toBe(
      null,
    );
    expect(text(editor)).not.toContain('Права');
    // No accounts are read for this person: no row speaks of one.
    expect(text(editor)).not.toContain('Без профил');
    expect(text(owner)).toContain('Без профил в приложението');
  });

  it('what the page shows: a member in preparation leads with the five items, three of them done', async () => {
    const { piece, all, text } = await render();
    const rows = all('button', piece('composition-member-setup'));
    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.hasAttribute('data-done'))).toHaveLength(3);
    expect(text(piece('composition-member-draft'))).toContain(
      'Подготовка · 3 от 5',
    );
    // «Изтрий» exists only on the record in preparation.
    expect(text(piece('composition-member-draft'))).toContain('Изтрий');
    expect(text(piece('composition-member-live'))).not.toContain('Изтрий');
  });

  // ── the owner's own chair ─────────────────────────────────────────────
  it('«Това съм аз» leaves the owner’s own row and «Не съм аз», which takes it back', async () => {
    const { piece, has, text, press } = await render();
    expect(has('composition-member-linked')).toBe(false);
    await press('composition-member-is-me');
    expect(has('composition-member-unlinked')).toBe(false);
    expect(text(piece('composition-member-linked'))).toContain('Твоят профил');
    await press('composition-member-not-me');
    expect(has('composition-member-unlinked')).toBe(true);
    expect(has('composition-member-linked')).toBe(false);
  });

  // ── the permissions are the engine's ──────────────────────────────────
  it('a level’s page asks the six capabilities that exist: values where «own» is offered, a switch where it is not', async () => {
    const { piece, all } = await render();
    const barber = piece('composition-level-page-barber');
    expect(
      all('[data-testid^="composition-permission-barber-"]', barber),
    ).toHaveLength(6);
    expect(
      all('[data-testid^="composition-permission-value-barber-"]', barber),
    ).toHaveLength(5);
    // The team switch has no «own», even on the barber level.
    expect(
      all('[data-testid^="composition-permission-switch-barber-"]', barber).map(
        (control) => control.dataset['testid'],
      ),
    ).toEqual(['composition-permission-switch-barber-TEAM_MANAGE']);

    const reception = piece('composition-level-page-receptionist');
    expect(
      all(
        '[data-testid^="composition-permission-switch-receptionist-"]',
        reception,
      ),
    ).toHaveLength(6);
    expect(
      all(
        '[data-testid^="composition-permission-value-receptionist-"]',
        reception,
      ),
    ).toHaveLength(0);
  });

  it('a changed row is marked and says what the standard was; an unchanged one says nothing', async () => {
    const { piece, all, text } = await render();
    const barber = piece('composition-level-page-barber');
    expect(
      all('[data-changed]', barber).map((row) => row.dataset['testid']),
    ).toEqual([
      'composition-permission-barber-TIME_OFF',
      'composition-permission-barber-TEAM_OFFERINGS',
    ]);
    expect(text(piece('composition-permission-barber-TIME_OFF'))).toContain(
      'Стандартно: Само своите',
    );
    expect(
      text(piece('composition-permission-barber-TEAM_OFFERINGS')),
    ).toContain('Стандартно: Не');
    expect(text(piece('composition-permission-barber-HOURS'))).not.toContain(
      'Стандартно',
    );
    // The mark is a shape with its word for a reader.
    const marked = piece('composition-permission-barber-TIME_OFF');
    expect(marked.querySelector('.team__changed')).not.toBe(null);
    expect(text(marked)).toContain('Променено.');
  });

  it('a change brings «Запази» into the dock; the save takes it away, leaves the receipt and moves the counts', async () => {
    const { piece, has, text, press } = await render();
    expect(has('composition-level-save-receptionist')).toBe(false);
    expect(text(piece('composition-level-receptionist'))).toContain(
      'Стандартни',
    );

    // The front desk's hours are on by default: off is a change.
    await press('composition-permission-switch-receptionist-HOURS');
    expect(text(piece('composition-permission-receptionist-HOURS'))).toContain(
      'Стандартно: включено',
    );
    expect(has('composition-level-save-receptionist')).toBe(true);
    // Nothing is saved yet: the list still says what the shop has.
    expect(text(piece('composition-level-receptionist'))).toContain(
      'Стандартни',
    );

    await press('composition-level-save-receptionist');
    expect(has('composition-level-save-receptionist')).toBe(false);
    expect(has('composition-level-receipt-receptionist')).toBe(true);
    expect(text(piece('composition-level-receptionist'))).toContain(
      '1 промяна',
    );
    expect(text(piece('composition-team-access'))).toBe('Права 3 промени');
  });

  it('«Върни стандартните» puts every row of the level back, and has nothing to do on a standard level', async () => {
    const { piece, all, press } = await render();
    const restoreReception = piece(
      'composition-level-restore-receptionist',
    ) as HTMLButtonElement;
    expect(restoreReception.disabled).toBe(true);

    const restoreBarber = piece(
      'composition-level-restore-barber',
    ) as HTMLButtonElement;
    expect(restoreBarber.disabled).toBe(false);
    await press('composition-level-restore-barber');
    expect(
      all('[data-changed]', piece('composition-level-page-barber')),
    ).toHaveLength(0);
    expect(restoreBarber.disabled).toBe(true);
    // Back to the standard is itself a change to save.
    expect(piece('composition-level-save-barber').textContent?.trim()).toBe(
      'Запази',
    );
  });

  // ── the laws a composition keeps ──────────────────────────────────────
  it('every control is named: a switch by its row, a value by its row and its answer', async () => {
    const { all } = await render();
    for (const control of all('button[uiswitch]')) {
      expect(control.getAttribute('aria-label')?.trim()).toBeTruthy();
    }
    for (const trigger of all(
      '[data-testid^="composition-permission-value-"]',
    )) {
      expect(trigger.getAttribute('aria-label')).toMatch(/.+: .+/);
    }
  });
});
