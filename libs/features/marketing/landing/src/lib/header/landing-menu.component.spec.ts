import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTestI18n } from '../test-i18n.providers';
import { LandingMenuComponent } from './landing-menu.component';

describe('LandingMenuComponent', () => {
  async function render(inputs: { open: boolean; isAuthed?: boolean }) {
    await TestBed.configureTestingModule({
      imports: [LandingMenuComponent],
      providers: [provideRouter([]), ...provideTestI18n()],
    }).compileComponents();

    const fixture = TestBed.createComponent(LandingMenuComponent);
    fixture.componentRef.setInput('open', inputs.open);
    if (inputs.isAuthed !== undefined) {
      fixture.componentRef.setInput('isAuthed', inputs.isAuthed);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('renders the book CTA as a PROMINENT list row anchor with a LEADING calendar glyph', async () => {
    const fixture = await render({ open: true });
    const host: HTMLElement = fixture.nativeElement;

    const cta = host.querySelector<HTMLAnchorElement>(
      '[data-testid="menu-book"]',
    );
    expect(cta).not.toBeNull();
    // The CTA IS a list row (owner ruling: same shape as the rows below,
    // filled with primary): ui-list-row stamps data-variant="prominent"
    // (primary fill + on-primary ink + standalone radius, list-row.css)
    // and the 52px prominent row box; the anchor row form is full-width
    // by contract (a.ui-list-row { inline-size: 100% }).
    expect(cta!.classList.contains('ui-list-row')).toBe(true);
    expect(cta!.getAttribute('data-variant')).toBe('prominent');
    expect(cta!.getAttribute('data-size')).toBe('prominent');
    // Hover/press ride the ONE shared interactive grammar, not a local one.
    expect(cta!.hasAttribute('data-interactive')).toBe(true);
    // SwiftUI Label semantics — the icon LEADS the title text, in the
    // leading slot at the same ladder step as the row glyphs below.
    const glyph = cta!.firstElementChild;
    expect(glyph?.tagName.toLowerCase()).toBe('ui-icon');
    expect(glyph?.hasAttribute('uileading')).toBe(true);
    expect(glyph?.getAttribute('data-scale')).toBe('medium');
    expect(cta!.textContent).toContain('Запази час');
    // No CTA-local styling classes — the row variant owns the look.
    expect(cta!.querySelector('.cr-menu__glyph')).toBeNull();
  });

  it('keeps every menu glyph on exactly two icon-ladder rungs: leading = medium (20px), trailing lock = small (16px) + slot ink', async () => {
    const fixture = await render({ open: true, isAuthed: false });
    const host: HTMLElement = fixture.nativeElement;

    // The px-sized local classes are gone entirely.
    expect(host.querySelector('.cr-menu__glyph')).toBeNull();
    expect(host.querySelector('.cr-menu__trail')).toBeNull();

    // Leading glyphs (rows AND the book CTA) sit on the list-row leading
    // step of the fixed ladder: uiScale="medium" → 20px.
    const leading = host.querySelectorAll('.ui-list-row ui-icon[uileading]');
    expect(leading.length).toBeGreaterThan(0);
    for (const icon of Array.from(leading)) {
      expect(icon.getAttribute('data-scale')).toBe('medium');
    }

    // Guest trailing locks are status accessories: uiScale="small" → 16px;
    // secondary ink comes from the list-row [uiTrailing] slot contract.
    const trails = host.querySelectorAll('.ui-list-row ui-icon[uitrailing]');
    expect(trails.length).toBe(2);
    for (const icon of Array.from(trails)) {
      expect(icon.getAttribute('data-scale')).toBe('small');
    }
  });

  it('keeps list-row labels on regular foreground ink via the data-interactive anchor contract', async () => {
    const fixture = await render({ open: true });
    const host: HTMLElement = fixture.nativeElement;

    // The global bare-anchor accent rule (apps/web/src/styles.css) excludes
    // a[data-interactive] and a.ui-button — every menu anchor must fall in
    // one of those buckets so labels render at --sys-color-foreground.
    const anchors = host.querySelectorAll<HTMLAnchorElement>('.cr-menu a');
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of Array.from(anchors)) {
      const excluded =
        a.hasAttribute('data-interactive') || a.classList.contains('ui-button');
      expect(excluded).toBe(true);
    }
  });

  it('hides the trailing locks once authed', async () => {
    const fixture = await render({ open: true, isAuthed: true });
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelectorAll('ui-icon[uitrailing]').length).toBe(0);
  });
});
