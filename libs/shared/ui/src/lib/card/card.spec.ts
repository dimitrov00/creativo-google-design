import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Card } from './card';

describe('Card', () => {
  let fixture: ComponentFixture<Card>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Card],
    }).compileComponents();

    fixture = TestBed.createComponent(Card);
    await fixture.whenStable();
  });

  it('does not render a media image when imageUrl is unset', () => {
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.cr-card__media')).toBeNull();
  });

  it('renders a media image with the given src/alt when imageUrl is set', () => {
    fixture.componentRef.setInput('imageUrl', '/booking-cover.jpg');
    fixture.componentRef.setInput(
      'imageAlt',
      'A styling chair in a bright salon',
    );
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector(
      '.cr-card__media',
    ) as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('/booking-cover.jpg');
    expect(img.getAttribute('alt')).toBe('A styling chair in a bright salon');
  });

  it('defaults to elevation 1 and padded body', () => {
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-elevation')).toBe('1');
    expect(host.hasAttribute('data-padded')).toBe(true);
  });

  it('has no data-interactive by default, and reflects it once opted in', () => {
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.hasAttribute('data-interactive')).toBe(false);

    fixture.componentRef.setInput('interactive', true);
    fixture.detectChanges();
    expect(host.hasAttribute('data-interactive')).toBe(true);
  });
});
