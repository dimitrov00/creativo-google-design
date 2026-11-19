import { NO_ERRORS_SCHEMA, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER } from 'rxjs';
import { CATALOG_PORTS } from '@creativo/infrastructure/firebase-app';
import type { FooterFlagshipLocation } from '@creativo/features/shared/shell';
import {
  provideEmptyCatalog,
  provideTestCatalog,
  provideTestI18n,
} from '@creativo/features/marketing/landing/testing';
import { HomePage } from './home.page';

/** The page, shallow (its sections stubbed), over the catalogue `catalog` provides. */
async function render(catalog: readonly Provider[]) {
  await TestBed.configureTestingModule({
    imports: [HomePage],
    providers: [...provideTestI18n(), ...catalog, provideRouter([])],
  })
    .overrideComponent(HomePage, {
      set: { imports: [], schemas: [NO_ERRORS_SCHEMA] },
    })
    .compileComponents();
  const fixture = TestBed.createComponent(HomePage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

/** The anchored sections the page draws, in order. */
function anchorsOf(host: HTMLElement): readonly string[] {
  return [...host.querySelectorAll('.cr-landing__anchor')].map(
    (anchor) => anchor.id,
  );
}

/** What the page hands the footer's Visit column. */
function flagshipOf(
  fixture: Awaited<ReturnType<typeof render>>,
): FooterFlagshipLocation | null {
  return fixture.componentInstance['flagshipLocation']();
}

/**
 * Shallow composition test — the page is a thin shell over the section
 * components (each with its own spec), so this asserts the v2 page order:
 * header → hero → anchored section run → closing CTA → footer, with the
 * anchor ids the nav menu / footer deep-link to.
 */
describe('HomePage', () => {
  it('composes the v2 landing shell in order', async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        ...provideTestI18n(),
        ...provideTestCatalog(),
        provideRouter([]),
      ],
    })
      .overrideComponent(HomePage, {
        // NO_ERRORS_SCHEMA (not CUSTOM_ELEMENTS_SCHEMA): with imports
        // stripped, the shell's DS modifier bindings ([uiFrameMaxWidth] on
        // <main>) would otherwise fail on a non-dashed element.
        set: { imports: [], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('[data-page-shell]')).not.toBeNull();
    expect(host.querySelector('cr-site-header')).not.toBeNull();
    expect(host.querySelector('cr-landing-hero')).not.toBeNull();

    const anchors = [...host.querySelectorAll('.cr-landing__anchor')].map(
      (anchor) => anchor.id,
    );
    // Funnel order (owner call, 2026-07-23): proof leads (work gallery
    // right under the hero) → offer → team → logistics, with the two
    // "join us" pitches (courses, then hiring) demoted to the very end.
    expect(anchors).toEqual([
      'work',
      'services',
      'team',
      'visit',
      'courses',
      'hiring',
    ]);

    const main = host.querySelector('main');
    expect(main?.querySelector('#work cr-work-gallery')).not.toBeNull();
    expect(main?.querySelector('#team cr-team-showcase')).not.toBeNull();
    expect(main?.querySelector('#services cr-services-section')).not.toBeNull();
    expect(main?.querySelector('#courses cr-courses-section')).not.toBeNull();
    expect(main?.querySelector('#hiring cr-hiring-section')).not.toBeNull();
    expect(main?.querySelector('#visit')).not.toBeNull();

    expect(host.querySelector('cr-site-footer')).not.toBeNull();
  });

  it('hands the footer the flagship shop — the first stored by sortOrder — with its map and number', async () => {
    const fixture = await render(provideTestCatalog());

    expect(flagshipOf(fixture)).toEqual({
      mapUrl:
        'https://www.google.com/maps/dir/?api=1&destination=42.4271,25.6366',
      phoneE164: '+359881234567',
    });
  });

  it('draws none of the shop’s own sections for a fresh project — no work, services, team or shops, and no flagship', async () => {
    const fixture = await render(provideEmptyCatalog());
    const host: HTMLElement = fixture.nativeElement;

    expect(anchorsOf(host)).toEqual(['courses', 'hiring']);
    expect(host.querySelector('cr-team-showcase')).toBeNull();
    expect(host.querySelector('cr-services-section')).toBeNull();
    expect(host.querySelector('cr-work-gallery')).toBeNull();
    expect(flagshipOf(fixture)).toBeNull();
  });

  it('draws no catalogue section before its read answers — a slow read never flashes an empty one', async () => {
    const fixture = await render([
      ...provideEmptyCatalog(),
      {
        provide: CATALOG_PORTS,
        useValue: {
          observeServices: () => NEVER,
          observeBarbers: () => NEVER,
          observeCategories: () => NEVER,
          observeLocations: () => NEVER,
        },
      },
    ]);

    expect(anchorsOf(fixture.nativeElement)).toEqual(['courses', 'hiring']);
  });
});
