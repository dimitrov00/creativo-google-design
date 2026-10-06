import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { QuickActionsPage } from './quick-actions.page';

/**
 * THE QUICK ACTIONS' PAGE (revision 3 §3.1; the lead's ruling G1-1). The
 * fill is decided: a run is TINTED unasked, and the neutral fill stays
 * within reach through the run's custom properties. The page shows both,
 * the default first, and this spec holds that the second is asked for on
 * the RUN alone: no input, no class and no style on a verb.
 *
 * It reads the DOM and never a file (the app's runner bundles its specs).
 * What the properties paint is held by the pattern's own spec
 * (`quick-actions.spec.ts`) and, for the accent law, by the tokens' guard,
 * which reads this page's sheet.
 */

async function render() {
  const fixture = TestBed.createComponent(QuickActionsPage);
  fixture.detectChanges();
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const piece = (id: string): HTMLElement => {
    const found = root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!found) throw new Error(`no piece «${id}»`);
    return found;
  };
  const all = (selector: string, within: ParentNode = root): HTMLElement[] =>
    Array.from(within.querySelectorAll<HTMLElement>(selector));
  const words = (run: ParentNode): (string | undefined)[] =>
    all('.ui-quick-action__label', run).map((word) => word.textContent?.trim());
  return { fixture, root, piece, all, words };
}

describe('QuickActionsPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuickActionsPage],
      // The page's shell holds the way back: a router link.
      providers: [provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows both fills on one sheet, the tinted default first', async () => {
    const { piece, all } = await render();
    const sheet = piece('quick-actions-fills');
    expect(
      all('ui-quick-actions', sheet).map((run) => run.dataset['testid']),
    ).toEqual(['quick-actions-tinted', 'quick-actions-neutral']);
    expect(
      all('.quick-actions__caption', sheet).map((caption) =>
        caption.textContent?.trim(),
      ),
    ).toEqual(['Оцветени (по подразбиране)', 'Неутрални (през свойствата)']);
  });

  it('draws the same four verbs in both, one of them promoted through the DS', async () => {
    const { piece, all, words } = await render();
    const tinted = piece('quick-actions-tinted');
    const neutral = piece('quick-actions-neutral');
    expect(words(tinted)).toEqual(['Обади се', 'SMS', 'Viber', 'Повтори']);
    expect(words(neutral)).toEqual(words(tinted));
    for (const run of [tinted, neutral]) {
      expect(run.style.getPropertyValue('--ui-quick-actions-columns')).toBe(
        '4',
      );
      expect(
        all('.ui-quick-action', run).map((verb) => verb.dataset['prominence']),
      ).toEqual(['standard', 'standard', 'standard', 'accent']);
    }
  });

  it('draws the default with nothing of its own: no class on the run, none on a verb', async () => {
    const { piece, all } = await render();
    const tinted = piece('quick-actions-tinted');
    expect(tinted.className).toBe('ui-quick-actions');
    expect(tinted.style.length).toBe(1);
    for (const verb of all('.ui-quick-action', tinted)) {
      expect(verb.className).toBe('ui-quick-action');
      expect(verb.getAttribute('style')).toBeNull();
    }
  });

  it('draws the neutral fill through the run’s properties, never on a verb', async () => {
    const { piece, all } = await render();
    const neutral = piece('quick-actions-neutral');
    expect(neutral.classList.contains('quick-actions__neutral')).toBe(true);
    for (const verb of all('.ui-quick-action', neutral)) {
      expect(verb.className).toBe('ui-quick-action');
      expect(verb.getAttribute('style')).toBeNull();
    }
    // The one run of the page that asks for it.
    expect(all('.quick-actions__neutral')).toEqual([neutral]);
  });

  it('promotes ONE verb of a run, or none, on every run of the page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { all } = await render();
    const runs = all('ui-quick-actions');
    expect(runs.length).toBeGreaterThanOrEqual(7);
    for (const run of runs) {
      expect(
        all('.ui-quick-action[data-prominence="accent"]', run).length,
      ).toBeLessThanOrEqual(1);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('names every run, and every verb with a sentence that begins with its word', async () => {
    const { all } = await render();
    const names = all('ui-quick-actions').map((run) =>
      run.getAttribute('aria-label'),
    );
    expect(names.every((name) => (name ?? '').length > 0)).toBe(true);
    // Two runs on one sheet are told apart by their names.
    expect(names).toContain('Връзка, оцветени');
    expect(names).toContain('Връзка, неутрални');
    for (const verb of all('.ui-quick-action')) {
      const word =
        verb.querySelector('.ui-quick-action__label')?.textContent?.trim() ??
        '';
      expect(word).not.toBe('');
      expect(verb.getAttribute('aria-label')?.startsWith(word)).toBe(true);
    }
  });

  it('puts the count on the promoted disc’s corner, and says it in the verb’s name', async () => {
    const { all } = await render();
    const counted = all('.ui-quick-action').filter(
      (verb) => verb.querySelector('[uiquickactionbadge]') !== null,
    );
    expect(counted).toHaveLength(1);
    const [use] = counted;
    expect(use?.dataset['prominence']).toBe('accent');
    expect(
      use
        ?.querySelector('.ui-quick-action__disc > .ui-quick-action__badge')
        ?.textContent?.trim(),
    ).toBe('2');
    expect(use?.getAttribute('aria-label')).toBe('Използвай: 2 награди');
    // The badge is the primary fill: it reads on the solid orange.
    const badge = use?.querySelector('[uiquickactionbadge]');
    expect(badge?.getAttribute('data-tone')).toBe('accent');
    expect(badge?.getAttribute('data-prominence')).toBe('increased');
  });
});
