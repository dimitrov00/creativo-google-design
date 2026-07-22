import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTestI18n } from '../../test-i18n.providers';
import { HomePage } from './home.page';

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
      providers: [...provideTestI18n(), provideRouter([])],
    })
      .overrideComponent(HomePage, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('[data-page-shell]')).not.toBeNull();
    expect(host.querySelector('cr-landing-header')).not.toBeNull();
    expect(host.querySelector('cr-landing-hero')).not.toBeNull();

    const anchors = [...host.querySelectorAll('.cr-landing__anchor')].map(
      (anchor) => anchor.id,
    );
    expect(anchors).toEqual(['work', 'team', 'services', 'hiring', 'visit']);

    const main = host.querySelector('main');
    expect(main?.querySelector('#work cr-work-gallery')).not.toBeNull();
    expect(main?.querySelector('#team cr-team-showcase')).not.toBeNull();
    expect(main?.querySelector('#services cr-services-section')).not.toBeNull();
    expect(main?.querySelector('#hiring cr-hiring-section')).not.toBeNull();
    expect(main?.querySelector('#visit')).not.toBeNull();
    expect(main?.querySelector('cr-closing-cta')).not.toBeNull();

    expect(host.querySelector('cr-landing-footer')).not.toBeNull();
  });
});
