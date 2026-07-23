import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiAvatar } from './avatar';

@Component({
  imports: [UiAvatar],
  template: `<ui-avatar
    [uiSrc]="src()"
    [uiName]="name()"
    [uiControlSize]="'large'"
  />`,
})
class HostComponent {
  readonly src = signal<string | null>(null);
  readonly name = signal('Ada Lovelace');
}

describe('UiAvatar', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes size as a data-* attribute', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('ui-avatar');
    expect(el.classList.contains('ui-avatar')).toBe(true);
    expect(el.getAttribute('data-control-size')).toBe('large');
  });

  it('renders the uppercased first initial when there is no src', () => {
    fixture.detectChanges();
    const fallback: HTMLElement = fixture.nativeElement.querySelector(
      '.ui-avatar__fallback',
    );
    expect(fallback.textContent?.trim()).toBe('A');
  });

  it('renders the AsyncImage img when a src is provided', async () => {
    fixture.detectChanges();
    fixture.componentInstance.src.set('https://example.com/a.png');
    fixture.detectChanges();
    await fixture.whenStable();
    const img: HTMLImageElement | null = fixture.nativeElement.querySelector(
      '.ui-avatar .ui-async-image__image',
    );
    expect(img).not.toBeNull();
    expect(img?.getAttribute('alt')).toBe('Ada Lovelace');
    // AsyncImage parity: the monogram stays in the DOM as the placeholder —
    // it cross-fades out once the image loads and persists on error.
    expect(
      fixture.nativeElement.querySelector('.ui-avatar__fallback'),
    ).not.toBeNull();
  });
});
