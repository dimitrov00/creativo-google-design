import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiAsyncImage } from './async-image';

@Component({
  imports: [UiAsyncImage],
  template: `<ui-async-image
    [uiSrc]="src()"
    [uiAlt]="'Fade cut'"
    [uiRatio]="'4 / 5'"
    [uiRing]="true"
  />`,
})
class HostComponent {
  readonly src = signal<string | null>(null);
}

describe('UiAsyncImage', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  const host = (): HTMLElement =>
    fixture.nativeElement.querySelector('ui-async-image');

  it('renders the skeleton placeholder permanently when src is null', () => {
    fixture.detectChanges();
    const el = host();
    expect(el.classList.contains('ui-async-image')).toBe(true);
    expect(el.getAttribute('data-state')).toBe('idle');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.ui-async-image__skeleton')).not.toBeNull();
  });

  it('writes ratio as an inline style and ring as a data-* attribute', () => {
    fixture.detectChanges();
    const el = host();
    expect(el.style.aspectRatio).toBe('4 / 5');
    expect(el.hasAttribute('data-ring')).toBe(true);
  });

  it('stamps data-state="loaded" once the image loads', async () => {
    fixture.detectChanges();
    fixture.componentInstance.src.set('https://example.com/cut.jpg');
    fixture.detectChanges();
    await fixture.whenStable();
    const img = host().querySelector<HTMLImageElement>(
      '.ui-async-image__image',
    );
    expect(img).not.toBeNull();
    expect(img?.getAttribute('alt')).toBe('Fade cut');
    expect(img?.getAttribute('loading')).toBe('lazy');

    img?.dispatchEvent(new Event('load'));
    fixture.detectChanges();
    expect(host().getAttribute('data-state')).toBe('loaded');
  });

  it('stamps data-state="error" and resets to idle when src changes', async () => {
    fixture.detectChanges();
    fixture.componentInstance.src.set('https://example.com/missing.jpg');
    fixture.detectChanges();
    await fixture.whenStable();
    host()
      .querySelector('.ui-async-image__image')
      ?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(host().getAttribute('data-state')).toBe('error');

    fixture.componentInstance.src.set('https://example.com/retry.jpg');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host().getAttribute('data-state')).toBe('idle');
  });
});
