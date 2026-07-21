import { TestBed } from '@angular/core/testing';
import { AboutPage } from './about.page';

describe('AboutPage', () => {
  it('renders a heading', async () => {
    await TestBed.configureTestingModule({
      imports: [AboutPage],
    }).compileComponents();
    const fixture = TestBed.createComponent(AboutPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('h1')?.textContent).toContain('Creativo');
  });
});
